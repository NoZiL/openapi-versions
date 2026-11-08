/**
 * A lock file in `outDir` that serializes codegen's write phase across processes (ADR 0023), so two
 * runs on one `outDir` never interleave their renames. No dependency: `open(O_CREAT | O_EXCL)` is
 * atomic on every local filesystem Node supports.
 *
 * The lock is held only while files are written (milliseconds), not while specs are merged and
 * generated, so a stale lock is one whose owner is dead (same host, PID gone) or that is older than
 * `staleMs` (another host or container sharing the dir, or a reused PID).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Dot file so tsc, vite and biome globs skip it; build() removes it before returning. */
export const LOCK_FILE = ".openapi-versions.lock";

interface Owner {
  pid: number;
  host: string;
  /** Linux PID namespace (`/proc/self/ns/pid`): containers sharing a hostname do not share PIDs */
  ns?: string;
  token: string;
  since: string;
}

export interface LockOptions {
  /** A lock older than this is taken over whoever holds it. */
  staleMs?: number;
  /** Give up waiting for a live holder after this long. */
  timeoutMs?: number;
  pollMs?: number;
}

const PID_NS = (() => {
  try {
    return fs.readlinkSync("/proc/self/ns/pid");
  } catch {
    return undefined;
  }
})();

/** Runs `fn` while holding `<outDir>/.openapi-versions.lock`, waiting for another holder first. */
export async function withOutDirLock<T>(
  outDir: string,
  fn: () => T,
  { staleMs = 30_000, timeoutMs = 60_000, pollMs = 25 }: LockOptions = {},
): Promise<T> {
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, LOCK_FILE);
  const token = randomUUID();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (tryCreate(file, token)) break;
    const held = readLock(file);
    // held is undefined if it was released meanwhile (or, on Windows, is being deleted): poll again
    if (held && isStale(held, staleMs) && takeOver(file, held.raw, staleMs)) continue;
    if (Date.now() > deadline) {
      const who = held?.owner ? `pid ${held.owner.pid} on ${held.owner.host} since ${held.owner.since}` : "another codegen";
      throw new Error(`Timed out waiting for ${file}, held by ${who}. Delete it if no codegen is running.`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  try {
    return fn();
  } finally {
    release(file, token);
  }
}

function tryCreate(file: string, token: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(file, "wx");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") return false;
    // Windows: a lock deleted while another process has it open stays "delete pending" for a moment
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) return false;
    throw e;
  }
  try {
    const owner: Owner = { pid: process.pid, host: os.hostname(), ns: PID_NS, token, since: new Date().toISOString() };
    fs.writeSync(fd, JSON.stringify(owner));
  } catch (e) {
    // an empty lock (disk full) would block every run for staleMs
    fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  return true;
}

interface Held {
  raw: string;
  /** undefined while the holder has created the file but not written it yet, or if it is garbage */
  owner?: Owner;
  mtimeMs: number;
}

/** Content and mtime through one fd, so they describe the same lock even if it is replaced meanwhile. */
function readLock(file: string): Held | undefined {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || (process.platform === "win32" && code === "EPERM")) return undefined;
    throw e;
  }
  try {
    const { mtimeMs } = fs.fstatSync(fd);
    const raw = fs.readFileSync(fd, "utf8");
    let owner: Owner | undefined;
    try {
      owner = JSON.parse(raw);
    } catch {
      owner = undefined;
    }
    return { raw, owner, mtimeMs };
  } finally {
    fs.closeSync(fd);
  }
}

function isStale({ owner, mtimeMs }: Held, staleMs: number): boolean {
  if (Date.now() - mtimeMs > staleMs) return true;
  return owner !== undefined && owner.host === os.hostname() && owner.ns === PID_NS && !isAlive(owner.pid);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by another user
  }
}

/**
 * Removes a stale lock without removing a fresh one that replaced it. Takers-over go one at a time
 * through `<lock>.takeover` (itself `O_EXCL`), and the one holding it deletes the lock only if it
 * still reads as the stale one. Returns false if another waiter is taking over.
 */
function takeOver(file: string, staleRaw: string, staleMs: number): boolean {
  const gate = `${file}.takeover`;
  try {
    fs.closeSync(fs.openSync(gate, "wx"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    // left by a waiter killed mid-takeover, which lasts microseconds
    try {
      if (Date.now() - fs.statSync(gate).mtimeMs > staleMs) fs.rmSync(gate, { force: true });
    } catch {
      // removed meanwhile
    }
    return false;
  }
  try {
    if (readLock(file)?.raw === staleRaw) fs.rmSync(file, { force: true });
  } finally {
    fs.rmSync(gate, { force: true });
  }
  return true;
}

/** Removes the lock only if it is still ours: a holder that ran past `staleMs` may have lost it. */
function release(file: string, token: string): void {
  if (readLock(file)?.owner?.token === token) fs.rmSync(file, { force: true });
}
