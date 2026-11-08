/**
 * Version-aware codegen around openapi-typescript or openapi-typesafe (ADR 0017).
 *
 *   specs/<semver>.json  ──►  per major:
 *     1. keep specs >= floor (from openapi-versions.config.json)
 *     2. oasdiff: every consecutive pair must be non-breaking  (fails the build otherwise)
 *     3. tolerant merge (union / required ∩ / enum ∪)
 *     4. since maps for operations and fields introduced after the floor
 *     5. the generator on the merged doc, with open enums
 *
 *   output: <outDir>/v<major>/{schema.d.ts, meta.ts, merged.openapi.json, client.ts} + <outDir>/index.ts
 *   Files are replaced in place, never deleted first, so a concurrent reader (tsc, vitest, vite)
 *   never sees a missing file (ADR 0021).
 *
 * Library entry: build(config). The CLI lives in cli.ts.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { type BreakingResult, checkChain, probeOasdiff } from "./breaking";
import { type Config, DEFAULT_RUNTIME_IMPORT, type GateMode } from "./config";
import { loadGenerator } from "./generator";
import { mergeAll } from "./merge";
import { computeSince, type VersionedDoc } from "./since";

/** One major in the codegen report: the specs merged and the oasdiff result for each consecutive pair. */
export interface MajorReport {
  major: number;
  specs: string[];
  breaking: BreakingResult[];
}

/** `gate` overrides config.gate (the CLI's --require-gate). */
export async function build(
  config: Config,
  { checkOnly = false, log = console.log, gate }: { checkOnly?: boolean; log?: (msg: string) => void; gate?: GateMode } = {},
): Promise<MajorReport[]> {
  const gateMode = gate ?? config.gate ?? "auto";
  let gateActive = gateMode !== "off";
  if (gateActive) {
    const probe = probeOasdiff();
    if (!probe.ok) {
      // --check-only exists to run the gate, so a missing oasdiff is an error there too
      if (gateMode === "required" || checkOnly) throw new Error(`Breaking-change gate cannot run: ${probe.reason}`);
      log(
        `WARN breaking-change gate skipped: ${probe.reason}\n     Specs are merged without checking they are non-breaking. Use "gate": "required" (or --require-gate) in CI.`,
      );
      gateActive = false;
    }
  } else if (checkOnly) {
    throw new Error(`--check-only needs the gate, but "gate" is "off"`);
  }

  // loaded up front so a missing generator fails before anything is written; --check-only does not need one
  const generator = checkOnly ? undefined : await loadGenerator(config.generator);

  const files = fs
    .readdirSync(config.specsDir)
    .filter((f) => f.endsWith(".json") && semver.valid(path.basename(f, ".json")))
    .map((f) => ({ version: path.basename(f, ".json"), file: path.join(config.specsDir, f) }))
    .sort((a, b) => semver.compare(a.version, b.version));

  const report: MajorReport[] = [];
  let failed = false;
  // everything is generated before anything is written, so a generator error leaves the old output whole
  const writes: [file: string, content: string][] = [];

  for (const [majorStr, { floor }] of Object.entries(config.majors)) {
    const major = Number(majorStr);
    const group = files.filter((f) => semver.major(f.version) === major && semver.gte(f.version, floor));
    if (!group.length) throw new Error(`No spec found for major ${major} at or above floor ${floor}`);
    if (group[0].version !== floor) throw new Error(`Floor ${floor} has no spec file (oldest found: ${group[0].version})`);

    const breaking = gateActive ? checkChain(group) : [];
    report.push({ major, specs: group.map((g) => g.version), breaking });
    for (const b of breaking) {
      log(`${b.ok ? "ok  " : "FAIL"} v${major}: ${b.from} -> ${b.to}`);
      if (!b.ok) {
        failed = true;
        log(
          b.report
            .split("\n")
            .map((l) => `     ${l}`)
            .join("\n"),
        );
      }
    }
    if (failed || checkOnly) continue;

    const docs: VersionedDoc[] = group.map((g) => ({ version: g.version, doc: JSON.parse(fs.readFileSync(g.file, "utf8")) }));
    const merged = mergeAll(docs.map((d) => d.doc));
    merged.info = { ...merged.info, version: `${floor} - ${group.at(-1)!.version}` };
    const { ops, gatedOps, gatedFields } = computeSince(docs, floor);

    const out = path.join(config.outDir, `v${major}`);
    const meta = { major, floor, newest: group.at(-1)!.version, specs: group.map((g) => g.version), ops, gatedOps, gatedFields };
    // meta.ts first: its header marks the dir as codegen's (pruneDroppedMajors), even if a run dies after it
    writes.push([
      path.join(out, "meta.ts"),
      `${HEADER}\n` +
        `export const meta = ${JSON.stringify(meta, null, 2)} as const;\n\n` +
        `export type Op = (typeof meta.ops)[number];\n` +
        `export type GatedOp = keyof typeof meta.gatedOps;\n` +
        `export type GatedField = keyof typeof meta.gatedFields;\n`,
    ]);
    writes.push([path.join(out, "merged.openapi.json"), `${JSON.stringify(merged, null, 2)}\n`]);
    writes.push([path.join(out, "schema.d.ts"), await generator!.generate(merged)]);
    writes.push([path.join(out, "client.ts"), clientSource(config.runtimeImport ?? DEFAULT_RUNTIME_IMPORT)]);
    log(
      `gen  v${major}: ${meta.specs.join(", ")} -> ${out} with ${generator!.name} (${Object.keys(gatedOps).length} gated ops, ${Object.keys(gatedFields).length} gated fields)`,
    );
  }

  if (failed) throw new BreakingChangeError(report);

  if (!checkOnly) {
    const majors = Object.keys(config.majors).map(Number);
    writes.push([
      path.join(config.outDir, "index.ts"),
      `${HEADER}\n` +
        majors.map((m) => `import { meta as v${m} } from "./v${m}/meta";`).join("\n") +
        `\n\nexport const majors = { ${majors.map((m) => `${m}: v${m}`).join(", ")} } as const;\n` +
        `export type SupportedMajor = keyof typeof majors;\n` +
        majors.map((m) => `export type { paths as PathsV${m} } from "./v${m}/schema";`).join("\n") +
        "\n" +
        majors.map((m) => `export type { GatedOp as GatedOpV${m}, GatedField as GatedFieldV${m} } from "./v${m}/meta";`).join("\n") +
        "\n",
    ]);
    for (const dir of new Set(writes.map(([file]) => path.dirname(file)))) {
      fs.mkdirSync(dir, { recursive: true });
      removeStaleTemps(dir);
    }
    for (const [file, content] of writes) writeIfChanged(file, content);
    pruneDroppedMajors(config.outDir, majors);
  }
  return report;
}

const HEADER = "// generated by version-aware codegen — do not edit";
const TEMP = /^\..+\.[0-9a-f-]{36}\.tmp$/;
const STALE_TEMP_MS = 10 * 60 * 1000;

/** `v<n>` dirs this codegen wrote (their meta.ts has our header) for majors no longer in the config. */
function pruneDroppedMajors(outDir: string, majors: number[]): void {
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^v\d+$/.test(entry.name) || majors.includes(Number(entry.name.slice(1)))) continue;
    const dir = path.join(outDir, entry.name);
    let meta: string;
    try {
      meta = fs.readFileSync(path.join(dir, "meta.ts"), "utf8");
    } catch {
      continue;
    }
    if (meta.startsWith(HEADER)) fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Temp files left by a codegen killed between write and rename; a live run's temp is seconds old. */
function removeStaleTemps(dir: string): void {
  for (const name of fs.readdirSync(dir)) {
    if (!TEMP.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > STALE_TEMP_MS) fs.rmSync(file, { force: true });
    } catch {
      // removed by another run meanwhile
    }
  }
}

/**
 * Replaces `file` atomically (temp file + rename in the same dir), and leaves it untouched when the
 * content is the same, so an unchanged regen does not wake file watchers.
 */
function writeIfChanged(file: string, content: string): void {
  const bytes = Buffer.from(content);
  try {
    if (fs.statSync(file).size === bytes.length && fs.readFileSync(file).equals(bytes)) return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  // unique per write: concurrent runs (other processes, threads, containers) never share a temp
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    // Windows refuses to replace a file another process holds open; fall back to an in-place write
    const code = (e as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EBUSY" || code === "EACCES")) fs.writeFileSync(file, bytes);
    else throw e;
  }
}

/** Binds the generic runtime to this major's generated types: apps import everything from here. */
function clientSource(runtimeImport: string): string {
  return (
    `${HEADER}\n` +
    `import { createVersionAware } from ${JSON.stringify(runtimeImport)};\n` +
    `import type { paths } from "./schema";\n` +
    `import { meta, type GatedOp, type GatedField } from "./meta";\n\n` +
    `const runtime = createVersionAware<paths, GatedOp, GatedField>(meta);\n\n` +
    `export const { ApiVersionProvider, useApi, useSupports, useHasField, useSunset, Feature, createApi, buildApi } = runtime;\n` +
    `export type Paths = paths;\n` +
    `export type { GatedOp, GatedField };\n` +
    `export type Api = ReturnType<typeof useApi>;\n`
  );
}

export class BreakingChangeError extends Error {
  constructor(public report: MajorReport[]) {
    super("Breaking change inside a major version: bump the major or fix the spec");
  }
}
