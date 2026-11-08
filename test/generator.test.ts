import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "../codegen/build";
import { validateConfig } from "../codegen/config";
import { type GeneratorName, isNotInstalled, loadGenerator, selectGenerator } from "../codegen/generator";
import { openEnums, openEnumsIr } from "../codegen/open-enums";

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});
const generate = async (generator: "openapi-typescript" | "openapi-typesafe", specsDir: string, floor: string) => {
  const outDir = tmp();
  await build({ specsDir, outDir, majors: { [floor.split(".")[0]]: { floor } }, generator, gate: "off" }, { log: () => {} });
  return fs.readFileSync(path.join(outDir, `v${floor.split(".")[0]}`, "schema.d.ts"), "utf8");
};
// openapi-typescript's printer escapes non-ASCII ("caf\u00E9"), openapi-typesafe's does not ("café"): same type
const normalize = (s: string) =>
  s.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

describe("generator parity", () => {
  it.each([
    ["test/fixtures/specs", "1.3.0"],
    ["playground/specs", "1.3.0"],
    // extensible enums inside arrays, allOf and nullable anyOf, nullable, and values that need escaping
    ["test/fixtures/enum-shapes", "1.0.0"],
    // OpenAPI 3.0 `nullable: true` open enums as properties, components, array items, allOf/anyOf members,
    // additionalProperties and a query parameter, next to closed nullable enums
    ["test/fixtures/enum-shapes-3.0", "1.0.0"],
  ])("openapi-typescript and openapi-typesafe write the same schema.d.ts for %s", async (specsDir, floor) => {
    const [a, b] = await Promise.all([generate("openapi-typescript", specsDir, floor), generate("openapi-typesafe", specsDir, floor)]);
    expect(a).toMatch(/\| \(string & \{\}\)/);
    expect(normalize(b)).toBe(normalize(a));
  });

  it("parenthesizes an open enum inside an array or intersection", async () => {
    const out = await generate("openapi-typesafe", "test/fixtures/enum-shapes", "1.0.0");
    expect(out).toContain(`list?: ("a" | "b" | (string & {}))[];`);
    expect(out).toContain(`composed?: ("a" | "b" | (string & {})) & unknown;`);
  });

  it.each(["openapi-typescript", "openapi-typesafe"] as const)(
    "keeps OpenAPI 3.0 `nullable: true` on an open enum with %s",
    async (generator) => {
      const out = await generate(generator, "test/fixtures/enum-shapes-3.0", "1.0.0");
      expect(out).toContain(`nullable?: "a" | (string & {}) | null;`);
      expect(out).toContain(`notNullable?: "a" | (string & {});`);
      expect(out).toContain(`NullableOpen: "a" | (string & {}) | null;`);
      expect(out).toContain(`ref?: components["schemas"]["NullableOpen"];`);
      expect(out).toContain(`closedNullable?: "a" | null;`);
      // elsewhere the generator may add its own `| null` around the transform's result: redundant, same type
      const line = (name: string) => out.split("\n").find((l) => l.trimStart().startsWith(name)) ?? "";
      for (const name of ["nullableItems?:", "q?:", "[key: string]:"]) {
        expect(line(name)).toMatch(/"a" \| \(string & \{\}\) \| null\b/);
      }
    },
  );

  it("leaves other schemas to the generator", async () => {
    const ir = openEnumsIr(await import("openapi-typesafe"));
    for (const schema of [{ type: "string", enum: ["a"] }, { type: "integer", "x-extensible-enum": [1] }, { type: "string" }]) {
      expect(ir(schema)).toBeUndefined();
      expect(openEnums(schema)).toBeUndefined();
    }
  });
});

describe("generator selection", () => {
  const fake = (installed: GeneratorName[]) => async (name: GeneratorName) =>
    installed.includes(name) ? { name, generate: async () => "" } : undefined;
  const notFound = (pkg: string) =>
    Object.assign(new Error(`Cannot find package '${pkg}' imported from /app/node_modules/openapi-versions/dist/codegen.js`), {
      code: "ERR_MODULE_NOT_FOUND",
    });

  it("defaults to openapi-typescript when both are installed", async () => {
    expect((await loadGenerator()).name).toBe("openapi-typescript");
  });
  it("uses the configured one", async () => {
    expect((await loadGenerator("openapi-typesafe")).name).toBe("openapi-typesafe");
  });
  it("falls back to openapi-typesafe when it is the only one installed", async () => {
    expect((await selectGenerator(undefined, fake(["openapi-typesafe"]))).name).toBe("openapi-typesafe");
  });
  it("explains what to install when neither is installed", async () => {
    await expect(selectGenerator(undefined, fake([]))).rejects.toThrow(
      /neither openapi-typescript nor openapi-typesafe is installed.*npm i -D/,
    );
  });
  it("fails when the configured one is not installed", async () => {
    await expect(selectGenerator("openapi-typesafe", fake(["openapi-typescript"]))).rejects.toThrow(
      /"generator" is "openapi-typesafe", but openapi-typesafe is not installed/,
    );
  });
  it("treats only the package itself as missing, not a broken install", () => {
    expect(isNotInstalled(notFound("openapi-typescript"), "openapi-typescript")).toBe(true);
    expect(isNotInstalled(notFound("openapi-typescript-helpers"), "openapi-typescript")).toBe(false);
    expect(isNotInstalled(new Error("Cannot find package 'openapi-typescript'"), "openapi-typescript")).toBe(false);
  });
  it("rejects an unknown generator in the config", () => {
    expect(() => validateConfig({ specsDir: "s", outDir: "o", majors: { 1: { floor: "1.0.0" } }, generator: "orval" })).toThrow(
      /generator/,
    );
  });
});
