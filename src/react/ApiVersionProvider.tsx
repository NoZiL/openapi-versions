/**
 * React layer of the openapi-fetch stacks (openapi-typescript, openapi-typesafe): the shared
 * bindings (./bindings) on an openapi-fetch client, with `useApi()` returning `$api`, `$gated`, `gate`.
 *
 * `createReactBindings(meta)` returns the provider and hooks bound to one generated
 * contract (`P` = paths, `G` = gated operation keys, `F` = gated field keys).
 */

import { type Api, buildApi } from "../core/api";
import { type ApiClient, createApiClient } from "../core/client";
import type { MajorMeta } from "../core/compat";
import { type Bindings, createBindings, type Transport } from "./bindings";

export { API_VERSION_KEY, type ApiVersionProviderProps, type Bindings, type FeatureProps, type Transport } from "./bindings";

/** Provider and hooks bound to one generated contract; `useApi()` returns `{ $api, $gated, gate, compat, client }`. */
export type ReactBindings<P extends {}, G extends string, F extends string> = Bindings<Api<P, G>, G, F>;

/** openapi-fetch: one client per baseUrl and fetch, headers read by its middleware. */
function openapiFetchTransport<P extends {}, G extends string>(): Transport<ApiClient<P, G>, Api<P, G>> {
  return {
    connect: (opts, headers) => createApiClient<P, G>({ ...opts, ...headers }),
    build: (compat, client) => buildApi<P, G>(compat, client),
  };
}

export function createReactBindings<P extends {}, G extends string, F extends string>(meta: MajorMeta): ReactBindings<P, G, F> {
  return createBindings<ApiClient<P, G>, Api<P, G>, G, F>(meta, openapiFetchTransport<P, G>());
}
