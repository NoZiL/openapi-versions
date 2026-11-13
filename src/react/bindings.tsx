/**
 * The React layer every stack shares: version detection with React Query, capability gating,
 * and re-evaluation when the backend version changes during a session.
 *
 * What differs per stack (which HTTP client, how it reads response headers, what `useApi()`
 * returns) is a `Transport`. This module imports no HTTP client, so the Hey API entry can use it
 * without openapi-fetch or openapi-react-query installed (ADR 0027).
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type JSX, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type Compat, type CompatOptions, type MajorMeta, type OkCompat, resolveCompat } from "../core/compat";
import { type ApiHeaderHandlers, fetchBackendVersion } from "../core/version";

export const API_VERSION_KEY = ["api-version"] as const;

export interface ApiVersionProviderProps extends CompatOptions {
  baseUrl: string;
  children: ReactNode;
  fetch?: typeof globalThis.fetch;
  /** shown while /version loads */
  loading?: ReactNode;
  /** shown when the backend is outside the supported range */
  renderBlocked?: (compat: Exclude<Compat, OkCompat>) => ReactNode;
}

export interface FeatureProps<G extends string> {
  requires: G;
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * How one stack talks to the backend. `C` is its client, `A` what `useApi()` returns.
 */
export interface Transport<C, A extends { compat: OkCompat }> {
  /**
   * Called during render, again only when `baseUrl` or `fetch` change: children start their queries in
   * their own effects, which run before the provider's, so the client must be ready by then.
   */
  connect(opts: { baseUrl: string; fetch?: typeof globalThis.fetch }): C;
  /** Called in an effect: read X-Api-Version and Sunset on every response. Returns the cleanup. */
  listen(client: C, handlers: ApiHeaderHandlers): () => void;
  /** The object `useApi()` returns for one resolved backend version. */
  build(compat: OkCompat, client: C): A;
}

/** Provider and hooks bound to one generated contract. `A` = what `useApi()` returns. */
export interface Bindings<A, G extends string, F extends string> {
  ApiVersionProvider: (props: ApiVersionProviderProps) => JSX.Element;
  useApi: () => A;
  /** Date after which the backend stops serving this major (from the `Sunset` header) */
  useSunset: () => Date | undefined;
  /** Is this operation available on the connected backend? */
  useSupports: (op: G) => boolean;
  /** Does the connected backend send this field? */
  useHasField: (field: F) => boolean;
  /** Renders `children` only when the backend supports `requires`, else `fallback` */
  Feature: (props: FeatureProps<G>) => JSX.Element;
}

function defaultBlocked(c: Exclude<Compat, OkCompat>): ReactNode {
  switch (c.status) {
    case "app-too-old":
      return <p>This app does not support API {c.version}. Please update the app.</p>;
    case "backend-too-old":
      return (
        <p>
          This app needs API {c.floor} or newer (connected: {c.version}).
        </p>
      );
    case "invalid-version":
      return <p>Unrecognised API version "{c.version}".</p>;
  }
}

export function createBindings<C, A extends { compat: OkCompat }, G extends string, F extends string>(
  meta: MajorMeta,
  transport: Transport<C, A>,
): Bindings<A, G, F> {
  const majors = { [meta.major]: meta };
  const ApiContext = createContext<A | null>(null);
  /** Date after which the backend stops serving this app's major (from the Sunset header) */
  const SunsetContext = createContext<Date | undefined>(undefined);

  function ApiVersionProvider({
    baseUrl,
    children,
    fetch: fetchImpl,
    loading = null,
    renderBlocked = defaultBlocked,
    ...compatOpts
  }: ApiVersionProviderProps) {
    const queryClient = useQueryClient();
    const current = useRef<string | undefined>(undefined);
    const [sunset, setSunset] = useState<Date | undefined>(undefined);

    const client = useMemo(() => transport.connect({ baseUrl, fetch: fetchImpl }), [baseUrl, fetchImpl]);
    // in an effect, so StrictMode's mount/unmount/mount and unmounting leave exactly one listener
    useEffect(
      () =>
        transport.listen(client, {
          // Backend deployed mid-session: store the new version, refetch everything else.
          onVersionHeader: (v) => {
            if (current.current === undefined || v === current.current) return;
            // update synchronously: the refetches below answer before React re-renders,
            // and would otherwise each trigger another invalidation (refetch loop)
            current.current = v;
            queryClient.setQueryData(API_VERSION_KEY, v);
            queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== API_VERSION_KEY[0] });
          },
          // same timestamp -> same state, no re-render
          onSunsetHeader: (d) => setSunset((prev) => (prev?.getTime() === d.getTime() ? prev : d)),
        }),
      [client, queryClient],
    );

    const version = useQuery({
      queryKey: API_VERSION_KEY,
      queryFn: () => fetchBackendVersion(baseUrl, fetchImpl),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: true, // mobile resume / tab refocus re-checks the backend
    });
    current.current = version.data;

    // biome-ignore lint/correctness/useExhaustiveDependencies: compatOpts is an inline object; only prereleaseAsRelease is read
    const compat = useMemo(
      () => (version.data ? resolveCompat(version.data, majors, compatOpts) : undefined),
      [version.data, compatOpts.prereleaseAsRelease],
    );
    // a new object only when the version changes
    const api = useMemo<A | undefined>(() => (compat?.status === "ok" ? transport.build(compat, client) : undefined), [compat, client]);

    if (!compat) return <>{loading}</>;
    if (compat.status !== "ok") return <>{renderBlocked(compat)}</>;
    return (
      <ApiContext.Provider value={api!}>
        <SunsetContext.Provider value={sunset}>{children}</SunsetContext.Provider>
      </ApiContext.Provider>
    );
  }

  function useApi(): A {
    const ctx = useContext(ApiContext);
    if (!ctx) throw new Error("useApi must be used inside <ApiVersionProvider>");
    return ctx;
  }

  /**
   * Set once a response carries `Sunset`: the backend will stop serving this major.
   * Show a soft "update the app before <date>" banner; the hard block comes when the
   * major is gone (another major answers /version, or the prefix is removed).
   */
  const useSunset = () => useContext(SunsetContext);

  /** Feature-flag style check: is this operation available on the connected backend? */
  const useSupports = (op: G) => useApi().compat.supports(op);
  const useHasField = (field: F) => useApi().compat.hasField(field);

  function Feature({ requires, children, fallback = null }: FeatureProps<G>) {
    return <>{useSupports(requires) ? children : fallback}</>;
  }

  return { ApiVersionProvider, useApi, useSunset, useSupports, useHasField, Feature };
}
