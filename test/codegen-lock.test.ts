import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "../codegen/build";
import { LOCK_FILE, PID_NS, withOutDirLock } from "../codegen/lock";

// Codegen's write phase is serialized by a lock file in outDir (ADR 0023).

const cfg = (outDir: string, floor = "1.3.0") => ({
  specsDir: "test/fixtures/specs",
  outDir,
  majors: { 1: { floor } },
  gate: "off" as const,
});
const quiet = { log: () => {} };
const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-lock-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.chmodSync(dir, 0o755);
    for (const sub of fs.readdirSync(dir, { withFileTypes: true })) if (sub.isDirectory()) fs.chmodSync(path.join(dir, sub.name), 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Every file under `dir` (recursive) with its content. */
const snapshot = (dir: string) =>
  Object.fromEntries(
    fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .sort()
      .map((f) => [f, fs.statSync(path.join(dir, f)).isDirectory() ? "<dir>" : fs.readFileSync(path.join(dir, f), "utf8")]),
  );
const writeLock = (outDir: string, owner: { pid: number; host?: string; ns?: string }, mtime?: Date) => {
  const file = path.join(outDir, LOCK_FILE);
  fs.writeFileSync(
    file,
    JSON.stringify({ host: os.hostname(), ns: PID_NS, token: "someone-else", since: new Date().toISOString(), ...owner }),
  );
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
};
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("codegen write lock (ADR 0023)", () => {
  it("waits for a live holder, then writes and removes its lock", async () => {
    const outDir = tmp();
    const lock = writeLock(outDir, { pid: process.pid });
    const logs: string[] = [];
    let done = false;
    const run = build(cfg(outDir), { log: (m) => logs.push(m) }).then(() => {
      done = true;
    });
    // generation is over (it logs "gen") well before the wait ends: only the lock holds the writes back
    while (!logs.some((m) => m.startsWith("gen"))) await sleep(10);
    await sleep(200);
    expect(done).toBe(false);
    expect(fs.existsSync(path.join(outDir, "v1"))).toBe(false);
    fs.rmSync(lock);
    await run;
    expect(fs.existsSync(path.join(outDir, "v1", "meta.ts"))).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("takes no lock when nothing would change, so a no-op regen touches nothing", async () => {
    const outDir = tmp();
    await build(cfg(outDir), quiet);
    writeLock(outDir, { pid: process.pid });
    await build(cfg(outDir), quiet); // would wait 60 s if it took the lock
  });

  it("takes over a lock whose process is dead", async () => {
    const outDir = tmp();
    const lock = writeLock(outDir, { pid: deadPid() });
    await build(cfg(outDir), quiet);
    expect(fs.existsSync(path.join(outDir, "v1", "meta.ts"))).toBe(true);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("takes over a lock older than staleMs even if its PID is alive (reused PID, other host)", async () => {
    const outDir = tmp();
    const lock = writeLock(outDir, { pid: process.pid, host: "elsewhere" }, new Date(2000, 0, 1));
    await build(cfg(outDir), quiet);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("treats a garbage lock as ownerless and takes it over once old", async () => {
    const outDir = tmp();
    const lock = path.join(outDir, LOCK_FILE);
    fs.writeFileSync(lock, "null");
    const old = new Date(2000, 0, 1);
    fs.utimesSync(lock, old, old);
    await withOutDirLock(outDir, () => 1);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("does not take over a fresh lock from another host", async () => {
    const outDir = tmp();
    writeLock(outDir, { pid: deadPid(), host: "elsewhere" });
    await expect(withOutDirLock(outDir, () => 1, { timeoutMs: 100 })).rejects.toThrow(/Timed out .* pid \d+ on elsewhere/);
  });

  it("does not judge a PID from another PID namespace (container with the same hostname) dead", async () => {
    const outDir = tmp();
    writeLock(outDir, { pid: deadPid(), ns: "pid:[1]" });
    await expect(withOutDirLock(outDir, () => 1, { timeoutMs: 100 })).rejects.toThrow(/Timed out/);
  });

  it("leaves a stale lock alone while another waiter is taking it over", async () => {
    const outDir = tmp();
    const lock = writeLock(outDir, { pid: deadPid() });
    fs.writeFileSync(`${lock}.takeover`, "");
    await expect(withOutDirLock(outDir, () => 1, { timeoutMs: 100 })).rejects.toThrow(/Timed out/);
    expect(fs.existsSync(lock)).toBe(true);
  });

  it("releases the lock when the write phase throws", async () => {
    const outDir = tmp();
    await expect(
      withOutDirLock(outDir, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(fs.readdirSync(outDir)).toEqual([]);

    fs.writeFileSync(path.join(outDir, "v1"), "a file where codegen wants a dir");
    await expect(build(cfg(outDir), quiet)).rejects.toThrow();
    expect(fs.readdirSync(outDir).sort()).toEqual(["v1"]);
  });

  it("leaves a lock it no longer owns", async () => {
    const outDir = tmp();
    const file = path.join(outDir, LOCK_FILE);
    await withOutDirLock(outDir, () => writeLock(outDir, { pid: process.pid })); // someone took over meanwhile
    expect(JSON.parse(fs.readFileSync(file, "utf8")).token).toBe("someone-else");
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "an I/O error while staging leaves the previous output whole and no temps",
    async () => {
      const specsDir = tmp();
      for (const f of fs.readdirSync("test/fixtures/specs")) fs.copyFileSync(path.join("test/fixtures/specs", f), path.join(specsDir, f));
      fs.copyFileSync("test/fixtures/next-major/2.0.0.json", path.join(specsDir, "2.0.0.json"));
      const outDir = tmp();
      const two = (floor: string, runtimeImport: string) => ({
        specsDir,
        outDir,
        runtimeImport,
        majors: { 1: { floor }, 2: { floor: "2.0.0" } },
        gate: "off" as const,
      });
      await build(two("1.3.0", "a"), quiet);
      const before = snapshot(outDir);
      fs.chmodSync(path.join(outDir, "v2"), 0o555); // v1's files stage fine, v2/client.ts cannot
      await expect(build(two("1.5.0", "b"), quiet)).rejects.toThrow(/EACCES/);
      fs.chmodSync(path.join(outDir, "v2"), 0o755);
      expect(snapshot(outDir)).toEqual(before);
    },
  );

  // Smoke test with real processes: the write phase lasts milliseconds, so this rarely hits the race
  // even without the lock; "waits for a live holder" above is the deterministic check.
  it("concurrent codegen processes on one outDir leave one whole generation", async () => {
    const [refA, refB, outDir, cfgDir] = [tmp(), tmp(), tmp(), tmp()];
    await build(cfg(refA, "1.3.0"), quiet);
    await build(cfg(refB, "1.5.0"), quiet);
    const [a, b] = [snapshot(refA), snapshot(refB)];
    expect(a["v1/schema.d.ts"]).not.toEqual(b["v1/schema.d.ts"]);

    const configs = ["1.3.0", "1.5.0"].map((floor) => {
      const file = path.join(cfgDir, `${floor}.json`);
      fs.writeFileSync(file, JSON.stringify({ ...cfg(outDir, floor), specsDir: path.resolve("test/fixtures/specs") }));
      return file;
    });
    const run = (config: string) =>
      new Promise<number | null>((resolve) => {
        const child = spawn(path.resolve("node_modules/.bin/tsx"), ["codegen/cli.ts", "--config", config], { stdio: "ignore" });
        child.on("exit", resolve);
      });
    for (let round = 0; round < 2; round++) {
      const codes = await Promise.all([0, 1, 0, 1].map((i) => run(configs[i])));
      expect(codes).toEqual([0, 0, 0, 0]);
      const out = snapshot(outDir);
      expect([a, b]).toContainEqual(out); // no lock file, no temps, no mix
    }
  }, 60_000);
});
