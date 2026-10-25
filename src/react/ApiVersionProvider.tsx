/**
 * React layer: version detection with React Query, capability gating, and
 * re-evaluation when the backend version changes during a session.
 *
 * `createReactBindings(meta)` returns the provider and hooks bound to one generated
 * contract (`P` = paths, `G` = gated operation keys, `F` = gated field keys).
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from "react";
import { type Api, buildApi, type OkCompat } from "../core/api";
import { createApiClient, fetchBackendVersion } from "../core/client";
import { type Compat, type CompatOptions, type MajorMeta, resolveCompat } from "../core/compat";

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

export function createReactBindings<P extends {}, G extends string, F extends string>(meta: MajorMeta) {
  const majors = { [meta.major]: meta };
  const ApiContext = createContext<Api<P, G> | null>(null);
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

    const client = useMemo(
      () =>
        createApiClient<P, G>({
          baseUrl,
          fetch: fetchImpl,
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
      [baseUrl, fetchImpl, queryClient],
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
    const api = useMemo<Api<P, G> | undefined>(
      () => (compat?.status === "ok" ? buildApi<P, G>(compat, client) : undefined),
      [compat, client],
    );

    if (!compat) return <>{loading}</>;
    if (compat.status !== "ok") return <>{renderBlocked(compat)}</>;
    return (
      <ApiContext.Provider value={api!}>
        <SunsetContext.Provider value={sunset}>{children}</SunsetContext.Provider>
      </ApiContext.Provider>
    );
  }

  /** const { $api, $gated, gate } = useApi() */
  function useApi(): Api<P, G> {
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

  function Feature({ requires, children, fallback = null }: { requires: G; children: ReactNode; fallback?: ReactNode }) {
    return <>{useSupports(requires) ? children : fallback}</>;
  }

  return { ApiVersionProvider, useApi, useSunset, useSupports, useHasField, Feature };
}
