/**
 * Decide what this client can do against a given backend version.
 * Framework-free: used by the React provider, by mobile, by tests.
 */
import semver from "semver";

export interface MajorMeta {
  readonly major: number;
  readonly floor: string;
  readonly newest: string;
  readonly ops: readonly string[];
  readonly gatedOps: Readonly<Record<string, string>>;
  readonly gatedFields: Readonly<Record<string, string>>;
}

export type Compat =
  | {
      status: "ok";
      version: string;
      major: number;
      /** backend is newer than the newest spec this client was built with (forward compatibility) */
      backendAhead: boolean;
      supports(op: string): boolean;
      hasField(field: string): boolean;
    }
  | { status: "backend-too-old"; version: string; major: number; floor: string }
  | { status: "app-too-old"; version: string; major: number; supportedMajors: number[] }
  | { status: "invalid-version"; version: string };

export interface CompatOptions {
  /**
   * Treat `1.6.0-rc.1` as `1.6.0` (staging running a release candidate gets the new features).
   * Default false: an rc of 1.6.0 counts as 1.5.x, which is the safe reading of semver.
   */
  prereleaseAsRelease?: boolean;
}

export function resolveCompat(
  rawVersion: string,
  majors: Readonly<Record<number, MajorMeta>>,
  { prereleaseAsRelease = false }: CompatOptions = {},
): Compat {
  const parsed = semver.parse(rawVersion);
  if (!parsed) return { status: "invalid-version", version: rawVersion };
  const version = prereleaseAsRelease ? `${parsed.major}.${parsed.minor}.${parsed.patch}` : parsed.version;

  const meta = majors[parsed.major];
  if (!meta) return { status: "app-too-old", version, major: parsed.major, supportedMajors: Object.keys(majors).map(Number) };
  if (semver.lt(version, meta.floor)) return { status: "backend-too-old", version, major: parsed.major, floor: meta.floor };

  const atLeast = (since: string | undefined) => since === undefined || semver.gte(version, since);
  return {
    status: "ok",
    version,
    major: parsed.major,
    backendAhead: semver.gt(version, meta.newest),
    // an op must exist in this major; if it is not in the gated map it exists since the floor
    supports: (op) => meta.ops.includes(op) && atLeast(meta.gatedOps[op]),
    hasField: (field) => atLeast(meta.gatedFields[field]),
  };
}
