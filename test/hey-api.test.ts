/** The Hey API codegen path (ADR 0027, #125). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { build } from "../codegen/build";
import type { GeneratorName } from "../codegen/generator";
import { checkOperations, type HeyApiOperation, reexports } from "../codegen/hey-api";

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-"));
  dirs.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const gen = async (specsDir: string, floor: string, generator: GeneratorName = "hey-api", outDir = tmp()) => {
  const major = floor.split(".")[0];
  await build({ specsDir, outDir, majors: { [major]: { floor } }, generator, gate: "off" }, { log: () => {} });
  const dir = path.join(outDir, `v${major}`);
  const read = (file: string) => fs.readFileSync(path.join(dir, file), "utf8");
  return { outDir, dir, read, exists: (file: string) => fs.existsSync(path.join(dir, file)) };
};

describe("Hey API codegen", () => {
  it("names operations the way Hey API does, read back from it", async () => {
    const { read } = await gen("test/fixtures/hey-api-ids", "1.0.0");
    // `delete` is a reserved word: sdk function `delete_`, query key and options `delete`
    expect(read("meta.ts")).toContain(
      `"opIds": {\n    "delete": "get /things/{id}/purge",\n    "getThing": "get /things/{id}",\n    "postThings": "post /things",\n    "thingsList": "get /things"\n  }`,
    );
    expect(read("core.ts")).toContain(`export { getThing, thingsList } from "./sdk/sdk.gen";`);
    expect(read("core.ts")).toContain(`export { getThingOptions, thingsListOptions } from "./sdk/@tanstack/react-query.gen";`);
    expect(read("gated.ts")).toContain(`export { delete_, postThings } from "./sdk/sdk.gen";`);
    expect(read("gated.ts")).toContain(`export { deleteOptions, postThingsMutation } from "./sdk/@tanstack/react-query.gen";`);
    expect(read("sdk/@tanstack/react-query.gen.ts")).toContain(`createQueryKey('delete', options)`);
  });

  it("writes Hey API's output under sdk/ with extensionless imports and no barrel, next to client.ts", async () => {
    const { read, exists, outDir } = await gen("test/fixtures/specs", "1.3.0");
    expect(exists("sdk/client/index.ts")).toBe(true);
    expect(exists("sdk/index.ts")).toBe(false);
    expect(exists("schema.d.ts")).toBe(false);
    expect(read("sdk/sdk.gen.ts")).toContain(`from './client.gen';`);
    expect(read("client.ts")).toContain(`import { createHeyApiAware } from "openapi-versions/hey-api";`);
    expect(read("client.ts")).toContain(`export * as $gated from "./gated";`);
    expect(fs.readFileSync(path.join(outDir, "index.ts"), "utf8")).not.toContain("PathsV1");
  });

  it("removes the other stack's files when the generator changes, and stale sdk/ files", async () => {
    const outDir = tmp();
    let out = await gen("test/fixtures/specs", "1.3.0", "openapi-typescript", outDir);
    expect(out.exists("schema.d.ts")).toBe(true);

    out = await gen("test/fixtures/specs", "1.3.0", "hey-api", outDir);
    expect(out.exists("schema.d.ts")).toBe(false);
    expect(out.exists("core.ts")).toBe(true);

    fs.mkdirSync(path.join(out.dir, "sdk", "old"), { recursive: true });
    fs.writeFileSync(path.join(out.dir, "sdk", "old", "gone.gen.ts"), "");
    out = await gen("test/fixtures/specs", "1.3.0", "hey-api", outDir);
    expect(out.exists("sdk/old")).toBe(false);

    out = await gen("test/fixtures/specs", "1.3.0", "openapi-typescript", outDir);
    for (const file of ["sdk", "core.ts", "gated.ts"]) expect(out.exists(file)).toBe(false);
    expect(out.exists("schema.d.ts")).toBe(true);
  });

  it.each([
    ["test/fixtures/enum-shapes", "1.0.0"],
    ["test/fixtures/enum-shapes-3.0", "1.0.0"],
  ])("generates open enums for %s, nullable ones included", async (specsDir, floor) => {
    const types = (await gen(specsDir, floor)).read("sdk/types.gen.ts");
    expect(types).toContain(`plain: 'a' | 'b' | (string & {});`);
    expect(types).toContain(`nullable?: 'a' | (string & {}) | null;`);
    expect(types).toContain(`nullableItems?: Array<'a' | (string & {}) | null>;`);
    expect(types).toMatch(/composed\?: \('a' \| (?:'b' \| )?\(string & \{\}\)(?: \| null)?\) & unknown;/);
  });

  it("keeps Hey API's own reading of a closed 3.0 nullable enum (differs from openapi-typescript, ADR 0027)", async () => {
    expect((await gen("test/fixtures/enum-shapes-3.0", "1.0.0")).read("sdk/types.gen.ts")).toContain(`closedNullable?: 'a';`);
  });

  it("fails when Hey API's output no longer matches the specs", () => {
    const ops: HeyApiOperation[] = [
      { id: "getUser", opKey: "get /users/{id}", exports: { "./sdk/sdk.gen": ["getUser"] } },
      { id: "archiveUser", opKey: "post /users/{id}/archive", exports: {} },
    ];
    expect(() => checkOperations(ops, ["get /users/{id}"])).not.toThrow();
    expect(() => checkOperations(ops, ["get /users/{id}", "post /users/{id}/archive", "get /users"])).toThrow(
      /post \/users\/\{id\}\/archive: Hey API exported no function for "archiveUser"\n {2}get \/users: no operation in Hey API's IR/,
    );
  });

  it("writes a module even with nothing gated", () => {
    expect(reexports([], "none", "// h")).toBe("// h\n// none\nexport {};\n");
  });
});
