/**
 * Runtime of the version-aware client: core + React bindings.
 * Apps do not call this directly; the generated `v<major>/client.ts` does, with its own types.
 */

import { createVersionAwareCore, type VersionAwareCore } from "./core";
import type { MajorMeta } from "./core/compat";
import { createReactBindings, type ReactBindings } from "./react/ApiVersionProvider";

export * from "./core";
export { API_VERSION_KEY, type ApiVersionProviderProps, type FeatureProps, type ReactBindings } from "./react/ApiVersionProvider";

/** What the generated `v<major>/client.ts` destructures: core runtime + React bindings. */
export type VersionAware<P extends {}, G extends string, F extends string> = VersionAwareCore<P, G> & ReactBindings<P, G, F>;

/** `P` = generated paths, `G` = gated operation keys, `F` = gated field keys */
export function createVersionAware<P extends {}, G extends string, F extends string>(meta: MajorMeta): VersionAware<P, G, F> {
  return { ...createVersionAwareCore<P, G>(meta), ...createReactBindings<P, G, F>(meta) };
}
