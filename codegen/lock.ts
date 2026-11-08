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
    if (!held) continue; // released meanwhile
    if (isStale(held, staleMs)) {
      takeOver(file, held.raw);
      continue;
    }
    if (Date.now() > deadline) {
      const who = held.owner ? `pid ${held.owner.pid} on ${held.owner.host} since ${held.owner.since}` : "another codegen";
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
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
  try {
    const owner: Owner = { pid: process.pid, host: os.hostname(), token, since: new Date().toISOString() };
    fs.writeSync(fd, JSON.stringify(owner));
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

interface Held {
  raw: string;
  /** undefined while the holder has created the file but not written it yet, or if it is garbage */
  owner?: Owner;
  mtimeMs: number;
}

function readLock(file: string): Held | undefined {
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    const raw = fs.readFileSync(file, "utf8");
    let owner: Owner | undefined;
    try {
      owner = JSON.parse(raw);
    } catch {
      owner = undefined;
    }
    return { raw, owner, mtimeMs };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

function isStale({ owner, mtimeMs }: Held, staleMs: number): boolean {
  if (Date.now() - mtimeMs > staleMs) return true;
  return owner !== undefined && owner.host === os.hostname() && !isAlive(owner.pid);
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
 * Removes a stale lock without removing a fresh one that replaced it: the lock is moved aside
 * first, and if what was moved is not the lock judged stale (another waiter took over and a new
 * holder created it in between), it is put back with `link`, which fails rather than overwrite.
 */
function takeOver(file: string, staleRaw: string): void {
  const aside = `${file}.${randomUUID()}.stale`;
  try {
    fs.renameSync(file, aside);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  try {
    if (fs.readFileSync(aside, "utf8") !== staleRaw) {
      try {
        fs.linkSync(aside, file);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      }
    }
  } finally {
    fs.rmSync(aside, { force: true });
  }
}

/** Removes the lock only if it is still ours: a holder that ran past `staleMs` may have lost it. */
function release(file: string, token: string): void {
  const held = readLock(file);
  if (held?.owner?.token === token) fs.rmSync(file, { force: true });
}
