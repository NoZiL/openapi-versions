/** Framework-free runtime: usable in loaders, scripts, React Native without React. */

import { buildApi, type CreateApiOptions, createApi } from "./api";
import type { MajorMeta } from "./compat";

export { type Api, buildApi, type CreateApiOptions, createApi, type Gated, type OkCompat } from "./api";
export { type ApiClient, apiHeadersMiddleware, type CorePaths, createApiClient, fetchBackendVersion } from "./client";
export { type Compat, type CompatOptions, type MajorMeta, resolveCompat } from "./compat";
export type { StripOps } from "./types";

/**
 * Bind the runtime to one generated contract. Normally called by the generated
 * `v<major>/client.ts`; `P` = paths, `G` = gated operation keys.
 */
export function createVersionAwareCore<P extends {}, G extends string>(meta: MajorMeta) {
  return {
    meta,
    createApi: (opts: CreateApiOptions) => createApi<P, G>(meta, opts),
    buildApi: buildApi<P, G>,
  };
}
