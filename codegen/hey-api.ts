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

export const HEY_API_SDK_DIR = "sdk";
/** Every operation must have a function in each: the sdk call, and its TanStack options or mutation helper. */
const REQUIRED_MODULES = [`./${HEY_API_SDK_DIR}/sdk.gen`, `./${HEY_API_SDK_DIR}/@tanstack/react-query.gen`];

/** Runs Hey API on `doc` in a temp folder and reads everything back, so build.ts stages it with the rest (ADR 0021, 0023). */
export async function generateHeyApi({ createClient }: HeyApiModule, doc: unknown): Promise<HeyApiOutput> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-versions-hey-api-"));
  try {
    // an explicit, empty config file: otherwise Hey API also loads the app's openapi-ts.config.* from the
    // working directory and merges it under ours (another file suffix, filters, post-processors...).
    // Hey API's loader (c12) still reads a `.openapi-tsrc` there; that rare file is not isolated.
    const configFile = path.join(tmp, "openapi-ts.config.json");
    fs.writeFileSync(configFile, "{}");
    const out = path.join(tmp, "out");
    let results: unknown;
    try {
      results = await createClient({
        configFile,
        input: structuredClone(doc),
        // no import extension and no barrel, whatever the app's tsconfig says: apps import from v<n>/client.ts
        output: { path: out, module: { extension: null }, entryFile: false },
        logs: { level: "silent", file: false },
        plugins: [
          "@hey-api/client-fetch",
          { name: "@hey-api/typescript", $resolvers: openEnumsHeyApi },
          "@hey-api/sdk",
          "@tanstack/react-query",
        ],
      });
    } catch (e) {
      // Hey API wraps every job error as JobError("") and keeps the cause in originalError; logs are silent
      const cause = (e as { originalError?: { error?: unknown } })?.originalError?.error;
      if (cause instanceof Error) throw new Error(`Hey API failed: ${cause.message}`, { cause });
      throw e;
    }
    // Hey API reports an input it cannot read (an unresolvable $ref, ...) by returning no job, not by throwing
    const ctx = Array.isArray(results) ? results[0] : undefined;
    if (!ctx || !fs.existsSync(out))
      throw new Error("Hey API generated nothing: it could not read the merged spec (check for unresolvable $refs in merged.openapi.json)");
    return { files: readTree(out), operations: readOperations(ctx, out) };
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
    const mod = `./${[HEY_API_SDK_DIR, ...path.relative(root, file).split(path.sep)].join("/").replace(/\.ts$/, "")}`;
    op.exports[mod] = [...(op.exports[mod] ?? []), name];
  }
  return [...byId.values()];
}

/**
 * Every operation codegen knows (`meta.ops`) must have a Hey API id, an sdk function and a TanStack helper.
 * Otherwise a Hey API change would drop an operation, or one of its functions, from core.ts/gated.ts, or
 * leave gate() unable to find it.
 */
export function checkOperations(operations: HeyApiOperation[], ops: readonly string[]): void {
  const problems: string[] = [];
  const byKey = new Map(operations.map((o) => [o.opKey, o]));
  for (const op of ops) {
    const found = byKey.get(op);
    if (!found) problems.push(`${op}: no operation in Hey API's IR`);
    else
      for (const mod of REQUIRED_MODULES)
        if (!found.exports[mod]?.length) problems.push(`${op}: Hey API exported no function for "${found.id}" from ${mod}`);
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
  const from = new Map<string, string>();
  for (const op of operations)
    for (const [mod, names] of Object.entries(op.exports)) {
      byModule.set(mod, [...(byModule.get(mod) ?? []), ...names]);
      for (const name of names) {
        // e.g. the options of `GET /users` and the sdk function of `GET /users/options` are both `getUsersOptions`
        const other = from.get(name);
        if (other !== undefined && other !== mod)
          throw new Error(
            `Hey API exports "${name}" from both ${other} and ${mod}, so they cannot be re-exported together. Give the operations an operationId that does not end like a helper (Options, Mutation, QueryKey).`,
          );
        from.set(name, mod);
      }
    }
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
    `import { client } from "./${HEY_API_SDK_DIR}/client.gen";\n` +
    `import { meta, type GatedOp, type GatedField } from "./meta";\n\n` +
    `const runtime = createHeyApiAware<GatedOp, GatedField>(meta, client);\n\n` +
    `export const { ApiVersionProvider, useApi, useSupports, useHasField, useSunset, Feature, createApi } = runtime;\n` +
    `/** Operations every supported backend has: sdk functions, xxxOptions(), xxxMutation(). */\n` +
    `export * as $api from "./core";\n` +
    `/** Operations added after the floor: useQuery(gate($gated.xxxOptions(...))), $gated.xxxMutation() inside <Feature>. */\n` +
    `export * as $gated from "./gated";\n` +
    `export type * from "./${HEY_API_SDK_DIR}/types.gen";\n` +
    `export type { GatedOp, GatedField };\n` +
    `export type Api = ReturnType<typeof useApi>;\n`
  );
}
