import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkChain, probeOasdiff } from "../codegen/breaking";
import { BreakingChangeError, build } from "../codegen/build";
import { validateConfig } from "../codegen/config";
import { mergeAll } from "../codegen/merge";
import { computeSince } from "../codegen/since";

const load = (v: string, dir = "test/fixtures/specs") => ({ version: v, doc: JSON.parse(fs.readFileSync(`${dir}/${v}.json`, "utf8")) });
const v1 = ["1.3.0", "1.4.0", "1.5.0", "1.6.0"].map((v) => load(v));
const hasOasdiff = !spawnSync(process.env.OASDIFF_BIN ?? "oasdiff", ["--version"]).error;

describe("tolerant merge", () => {
  const merged = mergeAll(v1.map((s) => s.doc));
  const user = merged.components.schemas.User;

  it("keeps fields required only if every minor requires them", () => {
    expect(user.required).toEqual(["id", "name", "status"]); // avatarUrl required since 1.4 only
    expect(Object.keys(user.properties)).toEqual(["id", "name", "status", "avatarUrl", "lastSeenAt"]);
  });
  it("unions extensible enum values", () => {
    expect(user.properties.status["x-extensible-enum"]).toEqual(["active", "invited", "archived"]);
  });
  it("unions paths and makes params added later optional", () => {
    expect(Object.keys(merged.paths)).toEqual(["/users", "/users/{id}", "/users/{id}/archive", "/users/{id}/activity"]);
    expect(merged.paths["/users"].get.parameters).toEqual([{ name: "search", in: "query", required: false, schema: { type: "string" } }]);
  });
});

describe("since maps", () => {
  it("gates only what was added after the floor", () => {
    const { gatedOps, gatedFields, ops } = computeSince(v1, "1.3.0");
    expect(gatedOps).toEqual({ "get /users/{id}/activity": "1.6.0", "post /users/{id}/archive": "1.5.0" });
    expect(gatedFields).toEqual({ "User.avatarUrl": "1.4.0", "User.lastSeenAt": "1.6.0" });
    expect(ops).toHaveLength(4);
  });
  it("raising the floor removes gates", () => {
    expect(computeSince(v1.slice(2), "1.5.0").gatedOps).toEqual({ "get /users/{id}/activity": "1.6.0" });
  });
});

describe.skipIf(!hasOasdiff)("breaking-change gate (oasdiff)", () => {
  it("accepts the additive 1.x chain", () => {
    const res = checkChain(v1.map((s) => ({ version: s.version, file: `test/fixtures/specs/${s.version}.json` })));
    expect(res.map((r) => r.ok)).toEqual([true, true, true]);
  });
  it("rejects a 1.7.0 that removes a field", () => {
    const [r] = checkChain([
      { version: "1.6.0", file: "test/fixtures/broken/1.6.0.json" },
      { version: "1.7.0", file: "test/fixtures/broken/1.7.0.json" },
    ]);
    expect(r.ok).toBe(false);
    expect(r.report).toMatch(/status/);
  });
  it("fails the build", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
    const run = build({ specsDir: "test/fixtures/broken", outDir, majors: { 1: { floor: "1.6.0" } } }, { log: () => {} });
    await expect(run).rejects.toBeInstanceOf(BreakingChangeError);
  });
  it("treats 1.6 -> 2.0 as breaking: a new major is a new app release", () => {
    const [r] = checkChain([
      { version: "1.6.0", file: "test/fixtures/specs/1.6.0.json" },
      { version: "2.0.0", file: "test/fixtures/next-major/2.0.0.json" },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("gate modes when oasdiff is unavailable", () => {
  const cfg = (outDir: string) => ({ specsDir: "test/fixtures/broken", outDir, majors: { 1: { floor: "1.6.0" } } });
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
  const withoutOasdiff = async (fn: () => Promise<void>) => {
    const prev = process.env.OASDIFF_BIN;
    process.env.OASDIFF_BIN = "/nonexistent/oasdiff";
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.OASDIFF_BIN;
      else process.env.OASDIFF_BIN = prev;
    }
  };

  it("probe explains how to install it", () =>
    withoutOasdiff(async () => {
      const p = probeOasdiff();
      expect(p.ok).toBe(false);
      expect(!p.ok && p.reason).toMatch(/brew install oasdiff/);
    }));
  it("auto: warns and still generates", () =>
    withoutOasdiff(async () => {
      const logs: string[] = [];
      await build(cfg(tmp()), { log: (m) => logs.push(m) });
      expect(logs.join("\n")).toMatch(/gate skipped/);
    }));
  it("required: fails", () =>
    withoutOasdiff(() => expect(build(cfg(tmp()), { log: () => {}, gate: "required" })).rejects.toThrow(/cannot run/)));
  it("config gate: required fails", () =>
    withoutOasdiff(() => expect(build({ ...cfg(tmp()), gate: "required" }, { log: () => {} })).rejects.toThrow(/cannot run/)));
  it("--check-only fails even in auto", () =>
    withoutOasdiff(() => expect(build(cfg(tmp()), { log: () => {}, checkOnly: true })).rejects.toThrow(/cannot run/)));
  it("off: never looks for it", () =>
    withoutOasdiff(async () => {
      const logs: string[] = [];
      await build({ ...cfg(tmp()), gate: "off" }, { log: (m) => logs.push(m) });
      expect(logs.join("\n")).not.toMatch(/WARN/);
    }));
  it("rejects an unknown gate value in the config", () => {
    expect(() => validateConfig({ specsDir: "s", outDir: "o", majors: { 1: { floor: "1.0.0" } }, gate: "maybe" })).toThrow(/gate/);
  });
});
