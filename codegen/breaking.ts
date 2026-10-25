/**
 * Within a major, every consecutive pair of specs must be non-breaking.
 * Uses the oasdiff CLI (https://github.com/oasdiff/oasdiff). Set OASDIFF_BIN if it is not on PATH.
 */
import { spawnSync } from "node:child_process";
import semver from "semver";

/** Oldest oasdiff the gate is documented for (tested with 1.34.1). */
export const MIN_OASDIFF_VERSION = "1.34.0";

export const OASDIFF_INSTALL_HINT =
  "Install it: `brew install oasdiff`, `go install github.com/oasdiff/oasdiff@latest`, or a release binary from https://github.com/oasdiff/oasdiff/releases (set OASDIFF_BIN if it is not on PATH).";

export type OasdiffProbe = { ok: true; bin: string; version: string } | { ok: false; bin: string; reason: string };

/** Looks for a usable oasdiff: present, and at least MIN_OASDIFF_VERSION. */
export function probeOasdiff(): OasdiffProbe {
  const bin = process.env.OASDIFF_BIN ?? "oasdiff";
  const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
  if (r.error) return { ok: false, bin, reason: `oasdiff not found (${bin}). ${OASDIFF_INSTALL_HINT}` };
  const version = semver.coerce(r.stdout)?.version;
  if (!version) return { ok: false, bin, reason: `could not read the version of ${bin} (got ${JSON.stringify(r.stdout.trim())})` };
  if (semver.lt(version, MIN_OASDIFF_VERSION))
    return { ok: false, bin, reason: `oasdiff ${version} is older than the minimum ${MIN_OASDIFF_VERSION}. ${OASDIFF_INSTALL_HINT}` };
  return { ok: true, bin, version };
}

export interface BreakingResult {
  from: string;
  to: string;
  ok: boolean;
  report: string;
}

export function checkPair(fromFile: string, toFile: string): Omit<BreakingResult, "from" | "to"> {
  const bin = process.env.OASDIFF_BIN ?? "oasdiff";
  const r = spawnSync(bin, ["breaking", fromFile, toFile, "--fail-on", "ERR"], { encoding: "utf8" });
  if (r.error) throw new Error(`Could not run oasdiff (${bin}): ${r.error.message}`);
  return { ok: r.status === 0, report: (r.stdout + r.stderr).trim() };
}

export function checkChain(files: { version: string; file: string }[]): BreakingResult[] {
  const results: BreakingResult[] = [];
  for (let i = 1; i < files.length; i++) {
    results.push({ from: files[i - 1].version, to: files[i].version, ...checkPair(files[i - 1].file, files[i].file) });
  }
  return results;
}
