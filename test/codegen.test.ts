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

  // #98: 1.0.0 declares Pet.nickname, tag items and the Pet.owner reference nullable, 1.1.0 drops
  // that; oasdiff lets a response do so, and a backend still on 1.0.0 can send null
  const REF = { $ref: "#/components/schemas/User" };
  describe.each([
    ["test/fixtures/nullable-narrowing", { type: ["string", "null"] }, { anyOf: [REF, { type: "null" }] }],
    ["test/fixtures/nullable-narrowing-3.0", { type: "string", nullable: true }, { nullable: true, allOf: [REF] }],
  ])("keeps a field nullable if an older minor says so (%s)", (dir, nullableString, nullableRef) => {
    const docs = ["1.0.0", "1.1.0"].map((v) => load(v, dir).doc);

    it("in the merged spec, whichever order the minors come in", () => {
      for (const pet of [mergeAll(docs), mergeAll([...docs].reverse())].map((m) => m.components.schemas.Pet)) {
        expect(pet.properties.nickname).toEqual(nullableString);
        expect(pet.properties.tags.items).toEqual(nullableString);
        expect(pet.properties.owner).toEqual(nullableRef);
        expect(pet.properties.id).toEqual({ type: "string" });
        // a property named like a keyword is a property, not the keyword
        expect(pet.properties.required).toEqual({ type: "boolean" });
        expect(pet.required).toEqual(["id", "nickname", "owner", "required"]);
      }
    });

    it.skipIf(!hasOasdiff)("which the breaking-change gate lets through", () => {
      expect(checkChain(["1.0.0", "1.1.0"].map((version) => ({ version, file: `${dir}/${version}.json` })))[0].ok).toBe(true);
    });

    it.each(["openapi-typescript", "openapi-typesafe"] as const)("in the types generated with %s", async (generator) => {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
      try {
        await build({ specsDir: dir, outDir, majors: { 1: { floor: "1.0.0" } }, gate: "off", generator }, { log: () => {} });
        const schema = fs.readFileSync(path.join(outDir, "v1/schema.d.ts"), "utf8");
        expect(schema).toMatch(/nickname: string \| null;/);
        expect(schema).toMatch(/tags\?: \(string \| null\)\[\];/);
        expect(schema).toContain(`owner: components["schemas"]["User"] | null;`);
        expect(schema).toMatch(/required: boolean;/);
      } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
    });
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

describe("regenerating over existing output (ADR 0021)", () => {
  const cfg = (outDir: string) => ({ specsDir: "test/fixtures/specs", outDir, majors: { 1: { floor: "1.3.0" } }, gate: "off" as const });
  const files = (dir: string) => fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

  it("leaves unchanged files untouched, replaces changed ones, prunes dropped majors and dead temps", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
    try {
      await build(cfg(outDir), { log: () => {} });
      const listed = files(outDir);
      const meta = path.join(outDir, "v1", "meta.ts");
      const schema = path.join(outDir, "v1", "schema.d.ts");
      const old = new Date(2000, 0, 1);
      fs.utimesSync(schema, old, old);
      fs.writeFileSync(meta, "// stale\n");
      fs.mkdirSync(path.join(outDir, "v9"));
      fs.writeFileSync(path.join(outDir, "v9", "meta.ts"), "// generated by version-aware codegen — do not edit\n");
      const dead = path.join(outDir, "v1", `.meta.ts.${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.tmp`);
      fs.writeFileSync(dead, "left by a killed run");
      fs.utimesSync(dead, old, old);
      const own = path.join(outDir, "v8", "meta.ts"); // a v<n> dir codegen did not write
      fs.mkdirSync(path.dirname(own));
      fs.writeFileSync(own, "export const mine = 1;\n");

      await build(cfg(outDir), { log: () => {} });

      expect(files(outDir)).toEqual([...listed, "v8", path.join("v8", "meta.ts")].sort()); // v9 and the dead temp pruned
      expect(fs.statSync(schema).mtime).toEqual(old); // same content: not rewritten
      expect(fs.readFileSync(meta, "utf8")).toMatch(/^\/\/ generated/);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("writes nothing when a later major fails, so the previous output stays whole", async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
    try {
      await build(cfg(outDir), { log: () => {} });
      const old = new Date(2000, 0, 1);
      for (const f of files(outDir)) fs.utimesSync(path.join(outDir, f), old, old);
      const listed = files(outDir);
      const withV2 = { ...cfg(outDir), runtimeImport: "changed", majors: { 1: { floor: "1.3.0" }, 2: { floor: "2.0.0" } } };
      await expect(build(withV2, { log: () => {} })).rejects.toThrow(/major 2/);
      expect(files(outDir)).toEqual(listed);
      for (const f of listed) expect(fs.statSync(path.join(outDir, f)).mtime).toEqual(old);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });
});
