/**
 * The two generator stacks (ADR 0017). Each app picks one with the `generator` config key;
 * when it is left out, the installed one is used, and openapi-typescript if both are (until #67).
 * Each generator is imported only when it is used, so an app needs only the one it picks.
 */
import { openEnums, openEnumsIr } from "./open-enums";

export type GeneratorName = "openapi-typescript" | "openapi-typesafe";
/** Auto-detection order: the first installed one wins. */
export const GENERATORS = ["openapi-typescript", "openapi-typesafe"] as const satisfies readonly GeneratorName[];

export interface Generator {
  name: GeneratorName;
  /** Generates `schema.d.ts` text from a (merged) OpenAPI document, with open enums. */
  generate(doc: any): Promise<string>;
}

const INSTALL_HINT =
  "Install one as a dev dependency: `npm i -D openapi-typescript` (the default) or `npm i -D openapi-typesafe` (TypeScript 5.4 to 7, no helpers patch). See ADR 0017.";

/** Resolves the configured generator, or detects the installed one. */
export const loadGenerator = (name?: GeneratorName) => selectGenerator(name, tryLoad);

/** Selection logic, separate from the imports so it can be tested without uninstalling anything. */
export async function selectGenerator(
  name: GeneratorName | undefined,
  load: (name: GeneratorName) => Promise<Generator | undefined>,
): Promise<Generator> {
  if (name) {
    const gen = await load(name);
    if (!gen) throw new Error(`"generator" is "${name}", but ${name} is not installed. ${INSTALL_HINT}`);
    return gen;
  }
  for (const candidate of GENERATORS) {
    const gen = await load(candidate);
    if (gen) return gen;
  }
  throw new Error(`No generator found: neither openapi-typescript nor openapi-typesafe is installed. ${INSTALL_HINT}`);
}

async function tryLoad(name: GeneratorName): Promise<Generator | undefined> {
  try {
    if (name === "openapi-typesafe") {
      const { default: openapiTS, astToString } = await import("openapi-typesafe");
      return {
        name,
        generate: async (doc) => astToString(await openapiTS(doc, { irCallbacks: true, transform: openEnumsIr, silent: true })),
      };
    }
    const { default: openapiTS, astToString } = await import("openapi-typescript");
    return { name, generate: async (doc) => astToString(await openapiTS(doc, { transform: openEnums, silent: true })) };
  } catch (e) {
    if (isNotInstalled(e, name)) return undefined;
    throw e;
  }
}

/** True only when the package itself is missing, not when something it imports is broken. */
export function isNotInstalled(e: unknown, name: string) {
  const err = e as { code?: string; message?: string };
  return (
    (err?.code === "ERR_MODULE_NOT_FOUND" || err?.code === "MODULE_NOT_FOUND") &&
    new RegExp(`['"]${name.replace(/[-/]/g, "\\$&")}['"]`).test(err.message ?? "")
  );
}
