/**
 * Spike #124: the runtime for Hey API output. Same model as src/ (ADR 0003): compat from /version,
 * useSupports / useHasField / <Feature> on op keys, and gate() for queries. What differs:
 *
 * - Hey API generates one module-level client (`client.gen.ts`); the provider configures it
 *   (`setConfig({ baseUrl, fetch })`) instead of creating an openapi-fetch client.
 * - X-Api-Version / Sunset are read by a response interceptor, not an openapi-fetch middleware.
 * - gate() reads the operation from the query key Hey API builds, `[{ _id: "getUserActivity", ... }]`,
 *   and maps it to an op key with `meta.opIds`.
 *
 * Most of this duplicates src/react/ApiVersionProvider.tsx. #126 would instead give createReactBindings
 * a transport adapter (connect a client, read headers, build the Api) so both stacks share it.
 */
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type JSX, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type ApiHeaderHandlers, fetchBackendVersion } from "../../src/core/client";
import { type Compat, type CompatOptions, type MajorMeta, resolveCompat } from "../../src/core/compat";

export const API_VERSION_KEY = ["api-version"] as const;
const VERSION_HEADER = "x-api-version";
const SUNSET_HEADER = "sunset";

export interface HeyApiMeta extends MajorMeta {
  /** Hey API operation id (the `_id` of its query keys) -> op key ("get /users/{id}") */
  readonly opIds: Readonly<Record<string, string>>;
}

/** The part of a generated Hey API fetch client this runtime uses. */
export interface HeyApiClient {
  setConfig(config: { baseUrl?: string; fetch?: typeof globalThis.fetch }): unknown;
  interceptors: {
    response: {
      use(fn: (response: Response, ...rest: any[]) => Response | Promise<Response>): unknown;
      eject(id: any): void;
    };
  };
}

type OkCompat = Extract<Compat, { status: "ok" }>;
type HeyApiQueryOptions = { queryKey: readonly [{ _id: string }]; queryFn?: unknown };
export type Gated<O extends HeyApiQueryOptions> = Omit<O, "queryFn"> & { queryFn: O["queryFn"] | typeof skipToken };

export interface HeyApi {
  compat: OkCompat;
  /** skipToken instead of queryFn when the connected backend lacks the operation; useSuspenseQuery rejects the result */
  gate<O extends HeyApiQueryOptions>(options: O): Gated<O>;
}

function buildHeyApi(meta: HeyApiMeta, compat: OkCompat): HeyApi {
  return {
    compat,
    gate: <O extends HeyApiQueryOptions>(options: O): Gated<O> => {
      const id = options.queryKey[0]._id;
      const op = meta.opIds[id];
      if (!op) throw new Error(`gate(): unknown Hey API operation "${id}"`);
      return (compat.supports(op) ? options : { ...options, queryFn: skipToken }) as Gated<O>;
    },
  };
}

/** Points the generated client at `baseUrl` and reads X-Api-Version / Sunset on every response. Returns the cleanup. */
export function connectClient(
  client: HeyApiClient,
  { baseUrl, fetch, onVersionHeader, onSunsetHeader }: { baseUrl: string; fetch?: typeof globalThis.fetch } & ApiHeaderHandlers,
): () => void {
  client.setConfig({ baseUrl, ...(fetch ? { fetch } : {}) });
  if (!onVersionHeader && !onSunsetHeader) return () => {};
  const id = client.interceptors.response.use((response) => {
    const v = response.headers.get(VERSION_HEADER);
    if (v && onVersionHeader) onVersionHeader(v);
    const sunset = response.headers.get(SUNSET_HEADER);
    if (sunset && onSunsetHeader) {
      const d = new Date(sunset);
      if (!Number.isNaN(d.getTime())) onSunsetHeader(d);
    }
    return response;
  });
  return () => client.interceptors.response.eject(id);
}

export interface ApiVersionProviderProps extends CompatOptions {
  baseUrl: string;
  children: ReactNode;
  fetch?: typeof globalThis.fetch;
  loading?: ReactNode;
  renderBlocked?: (compat: Exclude<Compat, OkCompat>) => ReactNode;
}

export function createHeyApiAware<G extends string, F extends string>(meta: HeyApiMeta, client: HeyApiClient) {
  const majors = { [meta.major]: meta };
  const ApiContext = createContext<HeyApi | null>(null);
  const SunsetContext = createContext<Date | undefined>(undefined);

  function ApiVersionProvider({
    baseUrl,
    children,
    fetch: fetchImpl,
    loading = null,
    renderBlocked,
    ...compatOpts
  }: ApiVersionProviderProps) {
    const queryClient = useQueryClient();
    const current = useRef<string | undefined>(undefined);
    const [sunset, setSunset] = useState<Date | undefined>(undefined);

    // configured during render, not in an effect: children's queries start in their own effects, which run first
    const disconnect = useMemo(
      () =>
        connectClient(client, {
          baseUrl,
          fetch: fetchImpl,
          onVersionHeader: (v) => {
            if (current.current === undefined || v === current.current) return;
            current.current = v;
            queryClient.setQueryData(API_VERSION_KEY, v);
            queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== API_VERSION_KEY[0] });
          },
          onSunsetHeader: (d) => setSunset((prev) => (prev?.getTime() === d.getTime() ? prev : d)),
        }),
      [baseUrl, fetchImpl, queryClient],
    );
    useEffect(() => disconnect, [disconnect]);

    const version = useQuery({
      queryKey: API_VERSION_KEY,
      queryFn: () => fetchBackendVersion(baseUrl, fetchImpl),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: true,
    });
    current.current = version.data;

    // biome-ignore lint/correctness/useExhaustiveDependencies: only prereleaseAsRelease is read
    const compat = useMemo(
      () => (version.data ? resolveCompat(version.data, majors, compatOpts) : undefined),
      [version.data, compatOpts.prereleaseAsRelease],
    );
    const api = useMemo(() => (compat?.status === "ok" ? buildHeyApi(meta, compat) : undefined), [compat]);

    if (!compat) return <>{loading}</>;
    if (compat.status !== "ok") return <>{renderBlocked ? renderBlocked(compat) : <p>Unsupported API {compat.version}</p>}</>;
    return (
      <ApiContext.Provider value={api!}>
        <SunsetContext.Provider value={sunset}>{children}</SunsetContext.Provider>
      </ApiContext.Provider>
    );
  }

  function useApi(): HeyApi {
    const ctx = useContext(ApiContext);
    if (!ctx) throw new Error("useApi must be used inside <ApiVersionProvider>");
    return ctx;
  }
  const useSunset = () => useContext(SunsetContext);
  const useSupports = (op: G) => useApi().compat.supports(op);
  const useHasField = (field: F) => useApi().compat.hasField(field);
  function Feature({ requires, children, fallback = null }: { requires: G; children: ReactNode; fallback?: ReactNode }): JSX.Element {
    return <>{useSupports(requires) ? children : fallback}</>;
  }

  /** Framework-free: loaders, scripts. Configures the generated client and resolves compat. */
  async function createApi(opts: { baseUrl: string; fetch?: typeof globalThis.fetch } & CompatOptions): Promise<HeyApi> {
    const compat = resolveCompat(await fetchBackendVersion(opts.baseUrl, opts.fetch), majors, opts);
    if (compat.status !== "ok") throw new Error(`Unsupported backend: ${compat.status} (${compat.version})`);
    connectClient(client, opts);
    return buildHeyApi(meta, compat);
  }

  return { ApiVersionProvider, useApi, useSunset, useSupports, useHasField, Feature, createApi };
}
