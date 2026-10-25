/**
 * The object components and loaders use: resolved compatibility + typed
 * openapi-react-query clients + gating.
 *
 *   $api    operations every supported backend has (floor and older)
 *   $gated  operations added after the floor: queries go through gate(),
 *           mutations are rendered inside <Feature>
 *
 * Generic over the generated types: `P` = `paths`, `G` = union of gated operation keys.
 * Apps get it pre-bound from the generated `v<major>/client.ts`.
 */
import { skipToken } from "@tanstack/react-query";
import createQueryClient, { type OpenapiQueryClient } from "openapi-react-query";
import { type ApiClient, createApiClient, fetchBackendVersion } from "./client";
import { type Compat, type CompatOptions, type MajorMeta, resolveCompat } from "./compat";
import type { StripOps } from "./types";

export type OkCompat = Extract<Compat, { status: "ok" }>;

type QueryOptionsLike = { queryKey: readonly unknown[]; queryFn?: unknown };
export type Gated<O extends QueryOptionsLike> = Omit<O, "queryFn"> & { queryFn: O["queryFn"] | typeof skipToken };

export interface Api<P extends {}, G extends string> {
  compat: OkCompat;
  client: ApiClient<P, G>;
  $api: OpenapiQueryClient<StripOps<P, G>>;
  $gated: Pick<OpenapiQueryClient<P>, "queryOptions" | "useMutation">;
  /**
   * Replace queryFn with skipToken when the connected backend lacks the operation.
   * The operation is read from the key openapi-react-query builds ([method, path, init]),
   * and the result type includes skipToken, so useSuspenseQuery rejects it.
   */
  gate<O extends QueryOptionsLike>(options: O): Gated<O>;
}

export function buildApi<P extends {}, G extends string>(compat: OkCompat, client: ApiClient<P, G>): Api<P, G> {
  const full = createQueryClient(client.gated);
  return {
    compat,
    client,
    $api: createQueryClient(client.core) as unknown as Api<P, G>["$api"],
    $gated: { queryOptions: full.queryOptions, useMutation: full.useMutation },
    gate: <O extends QueryOptionsLike>(options: O): Gated<O> => {
      const [method, path] = options.queryKey as [string, string];
      return (compat.supports(`${method} ${path}`) ? options : { ...options, queryFn: skipToken }) as Gated<O>;
    },
  };
}

export type CreateApiOptions = { baseUrl: string; fetch?: typeof fetch } & CompatOptions;

/** Reads `<baseUrl>/version`, resolves compatibility, throws if the backend is not supported. */
export async function createApi<P extends {}, G extends string>(meta: MajorMeta, opts: CreateApiOptions): Promise<Api<P, G>> {
  const compat = resolveCompat(await fetchBackendVersion(opts.baseUrl, opts.fetch), { [meta.major]: meta }, opts);
  if (compat.status !== "ok") throw new Error(`Unsupported backend: ${compat.status} (${compat.version})`);
  return buildApi<P, G>(compat, createApiClient<P, G>({ baseUrl: opts.baseUrl, fetch: opts.fetch }));
}
