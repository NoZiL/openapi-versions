/**
 * Config shape of openapi-versions.config.json (JSON Schema: openapi-versions.schema.json)
 * and a loader that fails with messages that say what to fix.
 */
import fs from "node:fs";
import semver from "semver";

/** auto: run the oasdiff gate when oasdiff is installed, warn and skip otherwise. required: fail if it cannot run. off: never run it. */
export type GateMode = "auto" | "required" | "off";
export const GATE_MODES: GateMode[] = ["auto", "required", "off"];

export interface Config {
  specsDir: string;
  outDir: string;
  majors: Record<string, { floor: string }>;
  /** Module the generated client.ts imports the runtime from. Default: the package name. */
  runtimeImport?: string;
  /** Breaking-change gate. Default "auto". */
  gate?: GateMode;
}

export const DEFAULT_RUNTIME_IMPORT = "openapi-versions";

export function validateConfig(raw: unknown, source = "config"): Config {
  const fail = (msg: string): never => {
    throw new Error(`${source}: ${msg}`);
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("must be a JSON object");
  const c = raw as Record<string, unknown>;
  for (const key of Object.keys(c))
    if (!["$schema", "specsDir", "outDir", "majors", "runtimeImport", "gate"].includes(key)) fail(`unknown key "${key}"`);
  for (const key of ["specsDir", "outDir"] as const) {
    if (typeof c[key] !== "string" || !c[key]) fail(`"${key}" must be a non-empty string`);
  }
  if (c.runtimeImport !== undefined && (typeof c.runtimeImport !== "string" || !c.runtimeImport))
    fail(`"runtimeImport" must be a non-empty string`);
  if (c.gate !== undefined && !GATE_MODES.includes(c.gate as GateMode))
    fail(`"gate" must be one of ${GATE_MODES.map((m) => `"${m}"`).join(", ")}`);
  const majors = c.majors;
  if (!majors || typeof majors !== "object" || Array.isArray(majors) || !Object.keys(majors).length)
    fail(`"majors" must list at least one major, e.g. { "1": { "floor": "1.0.0" } }`);
  for (const [major, entry] of Object.entries(majors as Record<string, any>)) {
    if (!/^(0|[1-9]\d*)$/.test(major)) fail(`major "${major}" must be a number`);
    const floor = entry?.floor;
    if (typeof floor !== "string" || semver.valid(floor) !== floor)
      fail(`majors.${major}.floor must be a plain semver like "${major}.0.0" (got ${JSON.stringify(floor)})`);
    if (semver.major(floor) !== Number(major)) fail(`majors.${major}.floor ${floor} is not in major ${major}`);
  }
  return {
    specsDir: c.specsDir as string,
    outDir: c.outDir as string,
    majors: majors as Config["majors"],
    runtimeImport: c.runtimeImport as string | undefined,
    gate: c.gate as GateMode | undefined,
  };
}

export function loadConfig(path: string): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`Cannot read ${path}: ${(e as Error).message}`);
  }
  return validateConfig(raw, path);
}
