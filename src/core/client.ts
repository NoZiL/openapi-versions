/**
 * One openapi-fetch client, exposed twice:
 *  - `core`:  typed with gated operations removed (safe on every supported backend)
 *  - `gated`: full merged types, for operations that need a capability check
 * Both are the SAME runtime object; only the types differ.
 *
 * A middleware reads `X-Api-Version` on every response so the app notices a backend
 * deploy during a session (web tab left open, mobile app resumed), and `Sunset`
 * so it can warn before the backend stops serving this major.
 */
import createFetchClient, { type Client, type Middleware } from "openapi-fetch";
import type { StripOps } from "./types";
import { type ApiHeaderHandlers, readApiHeaders } from "./version";

export { type ApiHeaderHandlers, fetchBackendVersion, SUNSET_HEADER, VERSION_HEADER } from "./version";

/** `P` = generated `paths`, `G` = union of gated operation keys */
export type CorePaths<P extends {}, G extends string> = StripOps<P, G>;
export interface ApiClient<P extends {}, G extends string> {
  core: Client<CorePaths<P, G>>;
  gated: Client<P>;
}

/** Reads X-Api-Version (deploys mid-session) and Sunset (major being retired) on every response. */
export function apiHeadersMiddleware(handlers: ApiHeaderHandlers): Middleware {
  return {
    onResponse({ response }) {
      readApiHeaders(response, handlers);
      return undefined;
    },
  };
}

/**
 * `baseUrl` includes the major: https://host/api/v1. The backend serves each major
 * under its own prefix, with its own /version, so one app build talks to one major.
 */
export function createApiClient<P extends {}, G extends string>(
  opts: { baseUrl: string; fetch?: typeof globalThis.fetch } & ApiHeaderHandlers,
): ApiClient<P, G> {
  const c = createFetchClient<P>({ baseUrl: opts.baseUrl, fetch: opts.fetch });
  if (opts.onVersionHeader || opts.onSunsetHeader) c.use(apiHeadersMiddleware(opts));
  return { core: c as unknown as Client<CorePaths<P, G>>, gated: c };
}
