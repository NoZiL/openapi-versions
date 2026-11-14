/**
 * What every stack shares, with no HTTP-client dependency: GET /version, and reading
 * X-Api-Version (backend deployed mid-session) and Sunset (major being retired) off a response.
 * The openapi-fetch path reads them in a middleware, the Hey API path in a response interceptor.
 */

export const VERSION_HEADER = "x-api-version";
export const SUNSET_HEADER = "sunset"; // RFC 8594: when this API (major) stops being served

export interface ApiHeaderHandlers {
  onVersionHeader?: (version: string) => void;
  onSunsetHeader?: (sunset: Date) => void;
}

/** Calls the handlers for the X-Api-Version and Sunset headers of `response`, when present and valid. */
export function readApiHeaders(response: Response, { onVersionHeader, onSunsetHeader }: ApiHeaderHandlers): void {
  const v = response.headers.get(VERSION_HEADER);
  if (v && onVersionHeader) onVersionHeader(v);
  const sunset = response.headers.get(SUNSET_HEADER);
  if (sunset && onSunsetHeader) {
    const d = new Date(sunset);
    if (!Number.isNaN(d.getTime())) onSunsetHeader(d);
  }
}

/** GET {baseUrl}/version, e.g. https://host/api/v1/version. Resolved RELATIVE to the base path. */
export async function fetchBackendVersion(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const res = await fetchImpl(new URL("version", base));
  if (!res.ok) throw new Error(`GET /version failed: ${res.status}`);
  const body = (await res.json()) as { version?: unknown };
  if (typeof body.version !== "string") throw new Error("GET /version: missing `version` string");
  return body.version;
}
