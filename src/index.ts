/**
 * Runtime of the version-aware client: core + React bindings.
 * Apps do not call this directly; the generated `v<major>/client.ts` does, with its own types.
 */

import { createVersionAwareCore } from "./core";
import type { MajorMeta } from "./core/compat";
import { createReactBindings } from "./react/ApiVersionProvider";

export * from "./core";
export { API_VERSION_KEY, type ApiVersionProviderProps } from "./react/ApiVersionProvider";

/** `P` = generated paths, `G` = gated operation keys, `F` = gated field keys */
export function createVersionAware<P extends {}, G extends string, F extends string>(meta: MajorMeta) {
  return { ...createVersionAwareCore<P, G>(meta), ...createReactBindings<P, G, F>(meta) };
}
