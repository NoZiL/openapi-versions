import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { build } from "../codegen/build";
import { validateConfig } from "../codegen/config";
import { type GeneratorName, isNotInstalled, loadGenerator, selectGenerator } from "../codegen/generator";
import { openEnums, openEnumsIr } from "../codegen/open-enums";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
const generate = async (generator: "openapi-typescript" | "openapi-typesafe", specsDir: string, floor: string) => {
  const outDir = tmp();
  await build({ specsDir, outDir, majors: { [floor.split(".")[0]]: { floor } }, generator, gate: "off" }, { log: () => {} });
  return fs.readFileSync(path.join(outDir, `v${floor.split(".")[0]}`, "schema.d.ts"), "utf8");
};
const withoutHeader = (s: string) => s.replace(/^\/\*\*[\s\S]*?\*\/\n/, "");

describe("generator parity", () => {
  it.each([
    ["test/fixtures/specs", "1.3.0"],
    ["playground/specs", "1.3.0"],
  ])("openapi-typescript and openapi-typesafe write the same schema.d.ts for %s", async (specsDir, floor) => {
    const [a, b] = await Promise.all([generate("openapi-typescript", specsDir, floor), generate("openapi-typesafe", specsDir, floor)]);
    expect(a).toMatch(/\| \(string & \{\}\)/);
    expect(withoutHeader(b)).toBe(withoutHeader(a));
  });

  it.each([
    { type: "string", "x-extensible-enum": ["active", "invited"] },
    { type: ["string", "null"], "x-extensible-enum": ["a"] },
    { type: "string", "x-extensible-enum": ['quo"te', "back\\slash", "new\nline"] },
  ])("open enum text matches the TS-node form: %j", (schema) => {
    const node = openEnums(schema as never, {} as never) as ts.TypeNode;
    const printed = ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ts.createSourceFile("x.ts", "", ts.ScriptTarget.Latest));
    expect(openEnumsIr(schema)).toBe(printed);
  });

  it("leaves other schemas to the generator", () => {
    for (const schema of [{ type: "string", enum: ["a"] }, { type: "integer", "x-extensible-enum": [1] }, { type: "string" }]) {
      expect(openEnumsIr(schema)).toBeUndefined();
      expect(openEnums(schema as never, {} as never)).toBeUndefined();
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
