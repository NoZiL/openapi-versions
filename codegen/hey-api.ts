/**
 * The Hey API generator path (ADR 0027): `@hey-api/openapi-ts` on the merged doc, then the core/gated split.
 *
 *   v<n>/sdk/**   Hey API's output (client, sdk, types, TanStack Query helpers). In a subfolder: Hey API
 *                 imports its `client/` folder as `./client`, which our `v<n>/client.ts` would shadow.
 *   v<n>/core.ts  named re-exports of the floor operations' functions
 *   v<n>/gated.ts the same for operations added after the floor
 *   meta.ts       gains `opIds`: Hey API operation id (the `_id` of its query keys) -> op key
 *
 * Hey API names operations itself (`get-a` -> `getA`, no operationId -> `postB`, `delete` -> sdk `delete_` but
 * key `delete`), so the ids and export names are read back from Hey API, never re-derived: the IR for ids,
 * methods and paths, the symbol registry for the final export names. Neither is a documented API, so
 * `checkOperations` fails the build when they stop answering for an operation (ADR 0027).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openEnumsHeyApi } from "./open-enums";

/** One operation as Hey API generated it. */
export interface HeyApiOperation {
  /** Hey API's operation id, the `_id` in its query keys */
  id: string;
  /** "get /users/{id}", as in meta.ts */
  opKey: string;
  /** module (relative to v<n>/, no extension) -> exported names that call this operation */
  exports: Record<string, string[]>;
}

export interface HeyApiOutput {
  /** files relative to v<n>/sdk/ */
  files: Record<string, string>;
  operations: HeyApiOperation[];
}

/** Only the part of `@hey-api/openapi-ts` this module uses. */
type HeyApiModule = { createClient: (config: any) => Promise<unknown> };

const SDK_DIR = "sdk";

/** Runs Hey API on `doc` in a temp folder and reads everything back, so build.ts stages it with the rest (ADR 0021, 0023). */
export async function generateHeyApi({ createClient }: HeyApiModule, doc: unknown): Promise<HeyApiOutput> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-hey-api-"));
  try {
    const [ctx] = (await createClient({
      input: structuredClone(doc),
      // no import extension and no barrel, whatever the app's tsconfig says: apps import from v<n>/client.ts
      output: { path: tmp, module: { extension: null }, entryFile: false },
      logs: { level: "silent", file: false },
      plugins: [
        "@hey-api/client-fetch",
        { name: "@hey-api/typescript", $resolvers: openEnumsHeyApi },
        "@hey-api/sdk",
        "@tanstack/react-query",
      ],
    })) as any[];
    return { files: readTree(tmp), operations: readOperations(ctx, tmp) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files[path.relative(root, abs).split(path.sep).join("/")] = fs.readFileSync(abs, "utf8");
  }
  return files;
}

function readOperations(ctx: any, root: string): HeyApiOperation[] {
  const byId = new Map<string, HeyApiOperation>();
  for (const [p, item] of Object.entries<any>(ctx?.ir?.paths ?? {}))
    for (const [method, op] of Object.entries<any>(item ?? {}))
      if (typeof op?.id === "string") byId.set(op.id, { id: op.id, opKey: `${method} ${p}`, exports: {} });

  for (const s of ctx?.gen?.symbols?.query?.({ resource: "operation" }) ?? []) {
    // types call nothing, so they stay shared; only functions are split
    if (s.meta?.category === "type" || !s.exported) continue;
    const op = byId.get(s.meta?.resourceId);
    const file = s.file?.finalPath ?? s.file?.path;
    const name = s.finalName ?? s.name;
    if (!op || typeof file !== "string" || typeof name !== "string") continue;
    const mod = `./${[SDK_DIR, ...path.relative(root, file).split(path.sep)].join("/").replace(/\.ts$/, "")}`;
    op.exports[mod] = [...(op.exports[mod] ?? []), name];
  }
  return [...byId.values()];
}

/**
 * Every operation codegen knows (`meta.ops`) must have a Hey API id and at least one exported function.
 * Otherwise a Hey API change would drop an operation from core.ts/gated.ts, or leave gate() unable to find it.
 */
export function checkOperations(operations: HeyApiOperation[], ops: readonly string[]): void {
  const problems: string[] = [];
  for (const op of ops) {
    const found = operations.find((o) => o.opKey === op);
    if (!found) problems.push(`${op}: no operation in Hey API's IR`);
    else if (!Object.keys(found.exports).length) problems.push(`${op}: Hey API exported no function for "${found.id}"`);
  }
  if (problems.length)
    throw new Error(
      `Hey API output does not match the specs (ADR 0027; check the @hey-api/openapi-ts version against our peer range):\n  ${problems.join("\n  ")}`,
    );
}

/** `{ getUser: "get /users/{id}", ... }` for meta.ts, sorted for a stable diff. */
export function opIds(operations: HeyApiOperation[]): Record<string, string> {
  return Object.fromEntries(operations.map((o) => [o.id, o.opKey] as const).sort(([a], [b]) => a.localeCompare(b)));
}

/** Source of core.ts or gated.ts: named re-exports, one line per module. */
export function reexports(operations: HeyApiOperation[], comment: string, header: string): string {
  const byModule = new Map<string, string[]>();
  for (const op of operations)
    for (const [mod, names] of Object.entries(op.exports)) byModule.set(mod, [...(byModule.get(mod) ?? []), ...names]);
  const lines = [...byModule]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mod, names]) => `export { ${[...names].sort().join(", ")} } from ${JSON.stringify(mod)};`);
  // an empty module still needs to be one, or `export * as $gated from "./gated"` fails
  return `${header}\n// ${comment}\n${lines.length ? lines.join("\n") : "export {};"}\n`;
}

/** v<n>/client.ts: binds the Hey API runtime to this major and exposes $api / $gated. */
export function heyApiClientSource(runtimeImport: string, header: string): string {
  return (
    `${header}\n` +
    `import { createHeyApiAware } from ${JSON.stringify(runtimeImport)};\n` +
    `import { client } from "./${SDK_DIR}/client.gen";\n` +
    `import { meta, type GatedOp, type GatedField } from "./meta";\n\n` +
    `const runtime = createHeyApiAware<GatedOp, GatedField>(meta, client);\n\n` +
    `export const { ApiVersionProvider, useApi, useSupports, useHasField, useSunset, Feature, createApi } = runtime;\n` +
    `/** Operations every supported backend has: sdk functions, xxxOptions(), xxxMutation(). */\n` +
    `export * as $api from "./core";\n` +
    `/** Operations added after the floor: useQuery(gate($gated.xxxOptions(...))), $gated.xxxMutation() inside <Feature>. */\n` +
    `export * as $gated from "./gated";\n` +
    `export type * from "./${SDK_DIR}/types.gen";\n` +
    `export type { GatedOp, GatedField };\n` +
    `export type Api = ReturnType<typeof useApi>;\n`
  );
}

export const HEY_API_SDK_DIR: string = SDK_DIR;
