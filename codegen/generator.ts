/**
 * The generator stacks (ADR 0017, 0027). Each app picks one with the `generator` config key;
 * when it is left out, the first installed one in GENERATORS is used (openapi-typescript first, until #67;
 * Hey API last, so an app with several installed keeps the stack it has).
 * Each generator is imported only when it is used, so an app needs only the one it picks.
 */
import { generateHeyApi, type HeyApiOutput } from "./hey-api";
import { openEnums, openEnumsIr } from "./open-enums";

export type GeneratorName = "openapi-typescript" | "openapi-typesafe" | "hey-api";
/** Auto-detection order: the first installed one wins. */
export const GENERATORS: readonly GeneratorName[] = ["openapi-typescript", "openapi-typesafe", "hey-api"];

/** The npm package each generator comes from. */
export const GENERATOR_PACKAGES: Readonly<Record<GeneratorName, string>> = {
  "openapi-typescript": "openapi-typescript",
  "openapi-typesafe": "openapi-typesafe",
  "hey-api": "@hey-api/openapi-ts",
};

/** openapi-typescript and openapi-typesafe: one `schema.d.ts` with a `paths` map, for openapi-fetch. */
export interface SchemaGenerator {
  name: "openapi-typescript" | "openapi-typesafe";
  kind: "schema";
  /** Generates `schema.d.ts` text from a (merged) OpenAPI document, with open enums. */
  generate(doc: any): Promise<string>;
}

/** Hey API: an SDK (one function per operation) plus TanStack Query helpers, in `v<n>/sdk/` (ADR 0027). */
export interface HeyApiGenerator {
  name: "hey-api";
  kind: "sdk";
  /** Generates the Hey API file set from a (merged) OpenAPI document, with open enums. */
  generate(doc: any): Promise<HeyApiOutput>;
}

export type Generator = SchemaGenerator | HeyApiGenerator;

const INSTALL_HINT =
  "Install one as a dev dependency: `npm i -D openapi-typescript` (the default), `npm i -D openapi-typesafe` (TypeScript 5.4 to 7, no helpers patch, Node 22.12+) or `npm i -D @hey-api/openapi-ts@0.99` (Hey API, experimental, Node 22.18+, generates with TypeScript 6 or older). See ADR 0017 and 0027.";

/** Resolves the configured generator, or detects the installed one. */
export const loadGenerator = (name?: GeneratorName): Promise<Generator> => selectGenerator(name, tryLoad);

/** Selection logic, separate from the imports so it can be tested without uninstalling anything. */
export async function selectGenerator(
  name: GeneratorName | undefined,
  load: (name: GeneratorName) => Promise<Generator | undefined>,
): Promise<Generator> {
  if (name) {
    const gen = await load(name);
    if (!gen) throw new Error(`"generator" is "${name}", but ${GENERATOR_PACKAGES[name]} is not installed. ${INSTALL_HINT}`);
    return gen;
  }
  for (const candidate of GENERATORS) {
    const gen = await load(candidate);
    if (gen) return gen;
  }
  throw new Error(`No generator found: none of ${GENERATORS.map((g) => GENERATOR_PACKAGES[g]).join(", ")} is installed. ${INSTALL_HINT}`);
}

async function tryLoad(name: GeneratorName): Promise<Generator | undefined> {
  try {
    if (name === "hey-api") {
      const mod = await import("@hey-api/openapi-ts");
      return { name, kind: "sdk", generate: (doc) => generateHeyApi(mod, doc) };
    }
    if (name === "openapi-typesafe") {
      const mod = await import("openapi-typesafe");
      const transform = openEnumsIr(mod);
      return {
        name,
        kind: "schema",
        generate: async (doc) => mod.astToString(await mod.default(doc, { irCallbacks: true, transform, silent: true })),
      };
    }
    const { default: openapiTS, astToString } = await import("openapi-typescript");
    return { name, kind: "schema", generate: async (doc) => astToString(await openapiTS(doc, { transform: openEnums, silent: true })) };
  } catch (e) {
    if (isNotInstalled(e, GENERATOR_PACKAGES[name])) return undefined;
    throw e;
  }
}

/** True only when the package itself is missing, not when something it imports is broken. */
export function isNotInstalled(e: unknown, name: string): boolean {
  const err = e as { code?: string; message?: string };
  return (
    (err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "MODULE_NOT_FOUND") &&
    new RegExp(`['"]${name.replace(/[-/]/g, "\\$&")}['"]`).test(err.message ?? "")
  );
}
