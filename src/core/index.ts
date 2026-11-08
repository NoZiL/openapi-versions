/** Framework-free runtime: usable in loaders, scripts, React Native without React. */

import { type Api, buildApi, type CreateApiOptions, createApi, type OkCompat } from "./api";
import type { ApiClient } from "./client";
import type { MajorMeta } from "./compat";

export { type Api, buildApi, type CreateApiOptions, createApi, type Gated, type OkCompat } from "./api";
export { type ApiClient, apiHeadersMiddleware, type CorePaths, createApiClient, fetchBackendVersion } from "./client";
export { type Compat, type CompatOptions, type MajorMeta, resolveCompat } from "./compat";
export type { StripOps } from "./types";

/** What `createVersionAwareCore` returns: the runtime bound to one generated contract. */
export interface VersionAwareCore<P extends {}, G extends string> {
  meta: MajorMeta;
  createApi: (opts: CreateApiOptions) => Promise<Api<P, G>>;
  buildApi: (compat: OkCompat, client: ApiClient<P, G>) => Api<P, G>;
}

/**
 * Bind the runtime to one generated contract. Normally called by the generated
 * `v<major>/client.ts`; `P` = paths, `G` = gated operation keys.
 */
export function createVersionAwareCore<P extends {}, G extends string>(meta: MajorMeta): VersionAwareCore<P, G> {
  return {
    meta,
    createApi: (opts: CreateApiOptions) => createApi<P, G>(meta, opts),
    buildApi: buildApi<P, G>,
  };
}
