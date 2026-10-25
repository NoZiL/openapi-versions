/**
 * In-memory backend that behaves like any API version, including future ones
 * the client has never seen (extra fields, new enum values). Exposes a fetch
 * function, so it plugs into openapi-fetch, the provider, tests and the demo.
 */
import semver from "semver";

export function createMockBackend(initialVersion: string, opts: { sunset?: string } = {}) {
  let version = initialVersion;
  const calls: string[] = [];

  const user = (id: string) => {
    const v = semver.coerce(version)!.version;
    const base: Record<string, unknown> = { id };
    if (semver.major(v) >= 2) Object.assign(base, { firstName: "Ada", lastName: "Lovelace" });
    else base.name = "Ada Lovelace";
    base.status = semver.gte(v, "1.8.0") && id === "2" ? "suspended" : "active"; // 1.8 adds a value
    if (semver.gte(v, "1.4.0")) base.avatarUrl = `https://img.example/${id}.png`;
    if (semver.gte(v, "1.6.0")) base.lastSeenAt = "2026-10-20T09:00:00Z";
    if (semver.gte(v, "1.8.0")) base.teamId = "t-42"; // field the client has never seen
    return base;
  };

  const routes: { method: string; re: RegExp; since: string; handle: (m: RegExpMatchArray) => [number, unknown] }[] = [
    { method: "GET", re: /^\/version$/, since: "0.0.0", handle: () => [200, { version }] },
    { method: "GET", re: /^\/users\/([^/]+)$/, since: "1.0.0", handle: (m) => [200, user(m[1])] },
    { method: "POST", re: /^\/users\/([^/]+)\/archive$/, since: "1.5.0", handle: () => [204, null] },
    {
      method: "GET",
      re: /^\/users\/([^/]+)\/activity$/,
      since: "1.6.0",
      handle: () => [200, [{ at: "2026-10-20T09:00:00Z", kind: "login" }]],
    },
  ];

  const fetchImpl: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const { pathname } = new URL(req.url);
    calls.push(`${req.method} ${pathname}`);
    const headers: Record<string, string> = { "content-type": "application/json", "x-api-version": version };
    if (opts.sunset) headers.sunset = new Date(opts.sunset).toUTCString();
    for (const r of routes) {
      const m = pathname.match(r.re);
      if (m && r.method === req.method && semver.gte(semver.coerce(version)!, r.since)) {
        const [status, body] = r.handle(m);
        return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
      }
    }
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers });
  };

  return {
    fetch: fetchImpl,
    calls,
    get version() {
      return version;
    },
    /** simulate a deploy */
    deploy(next: string) {
      version = next;
    },
  };
}

/**
 * Several majors side by side, each under its own prefix, as the backend serves
 * them during a major transition:
 *   sideBySide({ "/api/v1": createMockBackend("1.9.2"), "/api/v2": createMockBackend("2.0.0") })
 * A request to /api/v1/users/1 reaches the v1 backend as /users/1.
 */
export function sideBySide(majors: Record<string, ReturnType<typeof createMockBackend>>): typeof fetch {
  return async (input, init) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    for (const [prefix, backend] of Object.entries(majors)) {
      if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
        url.pathname = url.pathname.slice(prefix.length) || "/";
        return backend.fetch(new Request(url, req));
      }
    }
    return new Response(JSON.stringify({ error: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
  };
}
