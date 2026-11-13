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
 *   Hey API (ADR 0027) writes v<major>/{sdk/**, core.ts, gated.ts} instead of schema.d.ts (see hey-api.ts).
 *   Each v<major>/ lists what it wrote in .openapi-versions-files.json; the next run removes, under the
 *   same lock, what it wrote before and not now (another generator, a file Hey API dropped).
 *   Files are replaced in place, never deleted first, so a concurrent reader (tsc, vitest, vite)
 *   never sees a missing file (ADR 0021). The write phase holds a lock file in outDir, so two runs
 *   on one outDir never interleave their writes, and stages every changed file before renaming any
 *   (ADR 0023).
 *
 * Library entry: build(config). The CLI lives in cli.ts.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { type BreakingResult, checkChain, probeOasdiff } from "./breaking";
import { type Config, DEFAULT_HEY_API_RUNTIME_IMPORT, DEFAULT_RUNTIME_IMPORT, type GateMode } from "./config";
import { loadGenerator } from "./generator";
import { checkOperations, HEY_API_SDK_DIR, heyApiClientSource, opIds, reexports } from "./hey-api";
import { withOutDirLock } from "./lock";
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
    const meta: {
      major: number;
      floor: string;
      newest: string;
      specs: string[];
      ops: string[];
      gatedOps: Record<string, string>;
      gatedFields: Record<string, string>;
      /** Hey API only: operation id (query key `_id`) -> op key, what gate() reads */
      opIds?: Record<string, string>;
    } = {
      major,
      floor,
      newest: group.at(-1)!.version,
      specs: group.map((g) => g.version),
      ops,
      gatedOps,
      gatedFields,
    };
    const majorWrites: [file: string, content: string][] = [];
    if (generator!.kind === "sdk") {
      const { files, operations } = await generator!.generate(merged);
      checkOperations(operations, ops);
      meta.opIds = opIds(operations);
      for (const [rel, content] of Object.entries(files)) majorWrites.push([path.join(out, HEY_API_SDK_DIR, ...rel.split("/")), content]);
      const gated = (o: (typeof operations)[number]) => o.opKey in gatedOps;
      majorWrites.push([
        path.join(out, "core.ts"),
        reexports(
          operations.filter((o) => !gated(o)),
          "Operations every supported backend has (floor and older): call them directly.",
          HEADER,
        ),
      ]);
      majorWrites.push([
        path.join(out, "gated.ts"),
        reexports(
          operations.filter(gated),
          "Operations added after the floor: queries go through gate(), mutations inside <Feature>.",
          HEADER,
        ),
      ]);
      majorWrites.push([path.join(out, "client.ts"), heyApiClientSource(config.runtimeImport ?? DEFAULT_HEY_API_RUNTIME_IMPORT, HEADER)]);
    } else {
      majorWrites.push([path.join(out, "schema.d.ts"), await generator!.generate(merged)]);
      majorWrites.push([path.join(out, "client.ts"), clientSource(config.runtimeImport ?? DEFAULT_RUNTIME_IMPORT)]);
    }
    // meta.ts first: its header marks the dir as codegen's (droppedMajors), even if a run dies after it
    writes.push([
      path.join(out, "meta.ts"),
      `${HEADER}\n` +
        `export const meta = ${JSON.stringify(meta, null, 2)} as const;\n\n` +
        `export type Op = (typeof meta.ops)[number];\n` +
        `export type GatedOp = keyof typeof meta.gatedOps;\n` +
        `export type GatedField = keyof typeof meta.gatedFields;\n`,
    ]);
    writes.push([path.join(out, "merged.openapi.json"), `${JSON.stringify(merged, null, 2)}\n`]);
    writes.push(...majorWrites);
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
        (generator!.kind === "schema"
          ? `${majors.map((m) => `export type { paths as PathsV${m} } from "./v${m}/schema";`).join("\n")}\n`
          : "") +
        majors.map((m) => `export type { GatedOp as GatedOpV${m}, GatedField as GatedFieldV${m} } from "./v${m}/meta";`).join("\n") +
        "\n",
    ]);
    // Nothing to change (same generation on disk, nothing to prune): skip the lock too, so a no-op
    // regen does not touch outDir at all. Otherwise serialize with other codegen runs on this
    // outDir, so the last one leaves one whole generation (ADR 0023).
    // Each v<n> records what it wrote; next time, what it wrote before and not now is removed (a `generator`
    // change, a file Hey API stopped emitting). Files codegen never wrote, the app's own included, are kept.
    const stale: string[] = [];
    for (const m of majors) {
      const dir = path.join(config.outDir, `v${m}`);
      const now = writes.map(([file]) => path.relative(dir, file).split(path.sep).join("/")).filter((rel) => !rel.startsWith("../"));
      stale.push(
        ...readManifest(dir)
          .filter((rel) => !now.includes(rel))
          .map((rel) => path.join(dir, ...rel.split("/"))),
      );
      writes.push([path.join(dir, MANIFEST), `${JSON.stringify(now.sort(), null, 2)}\n`]);
    }
    if (
      writes.some(([file, content]) => !isSame(file, Buffer.from(content))) ||
      droppedMajors(config.outDir, majors).length ||
      stale.some((file) => fs.existsSync(file))
    ) {
      await withOutDirLock(config.outDir, () => {
        for (const dir of new Set(writes.map(([file]) => path.dirname(file)))) {
          fs.mkdirSync(dir, { recursive: true });
          removeStaleTemps(dir);
        }
        writeChanged(writes);
        for (const file of stale) removeFileAndEmptyParents(file, config.outDir);
        for (const dir of droppedMajors(config.outDir, majors)) fs.rmSync(dir, { recursive: true, force: true });
      });
    }
  }
  return report;
}

const HEADER = "// generated by version-aware codegen — do not edit";
const TEMP = /^\..+\.[0-9a-f-]{36}\.tmp$/;
const STALE_TEMP_MS = 10 * 60 * 1000;

/** `v<n>` dirs this codegen wrote (their meta.ts has our header) for majors no longer in the config. */
function droppedMajors(outDir: string, majors: number[]): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(outDir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const dropped: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^v\d+$/.test(entry.name) || majors.includes(Number(entry.name.slice(1)))) continue;
    const dir = path.join(outDir, entry.name);
    let meta: string;
    try {
      meta = fs.readFileSync(path.join(dir, "meta.ts"), "utf8");
    } catch {
      continue;
    }
    if (meta.startsWith(HEADER)) dropped.push(dir);
  }
  return dropped;
}

/** v<n>/<MANIFEST>: the paths (relative to v<n>) the last generation wrote, so the next one can prune exactly those. */
const MANIFEST = ".openapi-versions-files.json";

function readManifest(dir: string): string[] {
  try {
    const list: unknown = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), "utf8"));
    // only plain relative paths inside v<n>: a hand-edited manifest cannot reach outside it
    return Array.isArray(list)
      ? list.filter(
          (rel): rel is string =>
            typeof rel === "string" && !!rel && !rel.split("/").some((p) => p === ".." || p === "") && rel !== MANIFEST,
        )
      : [];
  } catch {
    return [];
  }
}

/** Removes a file, then its parent folders while they are empty, up to (not including) `root`. */
function removeFileAndEmptyParents(file: string, root: string): void {
  fs.rmSync(file, { force: true });
  for (let dir = path.dirname(file); path.relative(root, dir) && !path.relative(root, dir).startsWith(".."); dir = path.dirname(dir)) {
    try {
      fs.rmdirSync(dir); // fails when not empty: stop there
    } catch {
      return;
    }
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
 * Replaces each changed file atomically (temp file + rename in the same dir), and leaves a file
 * untouched when its content is the same, so an unchanged regen does not wake file watchers.
 * Every changed file is staged as a temp before any is renamed: an error while staging (disk full,
 * EACCES) removes the temps and leaves the old output whole. Renames allocate no data, so a
 * failure among them is unlikely; if one does fail, the rest are not renamed and their temps removed.
 */
function writeChanged(writes: [file: string, content: string][]): void {
  const staged: { file: string; tmp: string; bytes: Buffer }[] = [];
  const dropTemps = (from: number) => {
    for (const { tmp } of staged.slice(from)) fs.rmSync(tmp, { force: true });
  };
  try {
    for (const [file, content] of writes) {
      const bytes = Buffer.from(content);
      if (isSame(file, bytes)) continue;
      // unique per write: concurrent runs (other processes, threads, containers) never share a temp
      const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
      staged.push({ file, tmp, bytes });
      fs.writeFileSync(tmp, bytes);
    }
  } catch (e) {
    dropTemps(0);
    throw e;
  }
  for (const [i, { file, tmp, bytes }] of staged.entries()) {
    try {
      replace(file, tmp, bytes);
    } catch (e) {
      dropTemps(i);
      throw e;
    }
  }
}

function isSame(file: string, bytes: Buffer): boolean {
  try {
    return fs.statSync(file).size === bytes.length && fs.readFileSync(file).equals(bytes);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw e;
  }
}

function replace(file: string, tmp: string, bytes: Buffer): void {
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows refuses to replace a file another process holds open; fall back to an in-place write.
    // Only here: a temp that cannot be created is a real error and fails while staging.
    const code = (e as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) throw e;
    fs.rmSync(tmp, { force: true });
    fs.writeFileSync(file, bytes);
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
