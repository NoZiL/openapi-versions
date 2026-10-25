/**
 * Example app: one client build (specs 1.3.0 to 1.6.0) against a backend whose
 * version you change from the control panel. The mock backend runs in the browser.
 */

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { createMockBackend } from "../api/mock-backend";
import { ApiVersionProvider, Feature, type Paths, useApi, useSunset } from "../generated/v1/client";

const BASE = "http://api.test/api/v1";
const VERSIONS = ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.8.0", "2.0.0", "2026.10.1"];

type Status = Paths["/users/{id}"]["get"]["responses"][200]["content"]["application/json"]["status"];

/** Extensible enum: the default branch is required by the open type */
function statusLabel(status: Status): { text: string; unknown: boolean } {
  switch (status) {
    case "active":
      return { text: "Active", unknown: false };
    case "invited":
      return { text: "Invited", unknown: false };
    case "archived":
      return { text: "Archived", unknown: false };
    default:
      return { text: status, unknown: true }; // added by a newer backend: shown raw, no crash
  }
}

function UserCard({ id }: { id: string }) {
  const { $api, $gated, gate, compat } = useApi();
  const user = $api.useQuery("get", "/users/{id}", { params: { path: { id } } });
  const activity = useQuery(gate($gated.queryOptions("get", "/users/{id}/activity", { params: { path: { id } } })));
  const archive = $gated.useMutation("post", "/users/{id}/archive");
  const sunset = useSunset();
  if (!user.data) return <p>Loading user…</p>;
  const u = user.data;
  const s = statusLabel(u.status);
  return (
    <div className="card">
      {sunset && <div className="banner">This app version stops working on {sunset.toDateString()}. Please update.</div>}
      {compat.backendAhead && (
        <div className="muted">Backend {compat.version} is newer than this app knows: unknown fields are ignored.</div>
      )}
      <div className="row">
        {u.avatarUrl ? <img className="avatar" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" alt="" /> : null}
        <div>
          <h1>
            {u.name}
            <span className={`pill${s.unknown ? " unknown" : ""}`}>{s.text}</span>
          </h1>
          <div className="muted">{u.avatarUrl ? "has avatar (backend 1.4.0+)" : "no avatar field on this backend"}</div>
        </div>
      </div>
      <div className="row">
        <Feature requires="post /users/{id}/archive" fallback={<span className="hidden-feature">Archive: hidden (needs 1.5.0)</span>}>
          <button onClick={() => archive.mutate({ params: { path: { id } } })}>Archive user</button>
          {archive.isSuccess && <span className="muted">archived (204)</span>}
        </Feature>
      </div>
      <div className="row">
        <Feature requires="get /users/{id}/activity" fallback={<span className="hidden-feature">Activity: hidden (needs 1.6.0)</span>}>
          <span>Activity events: {activity.data?.length ?? "…"}</span>
        </Feature>
      </div>
    </div>
  );
}

function Blocked({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="blocked">
      <strong>{title}</strong>
      <div>{detail}</div>
    </div>
  );
}

export function App() {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [backend] = useState(() => createMockBackend("1.4.0"));
  const [version, setVersion] = useState("1.4.0");
  const [sunset, setSunset] = useState(false);
  const [userId, setUserId] = useState("1");
  const [log, setLog] = useState<string[]>([]);

  const fetchImpl = useMemo<typeof fetch>(
    () => async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const path = new URL(req.url).pathname.replace("/api/v1", "") || "/";
      const res = await backend.fetch(new Request(new URL(path, req.url), req));
      setLog((l) => [`${res.status} ${req.method} ${path}   (backend ${backend.version})`, ...l].slice(0, 30));
      if (!sunset) return res;
      const headers = new Headers(res.headers);
      headers.set("sunset", new Date(Date.now() + 30 * 864e5).toUTCString());
      return new Response(res.body, { status: res.status, headers });
    },
    [backend, sunset],
  );

  const deploy = useCallback(
    (v: string) => {
      backend.deploy(v);
      setVersion(v);
      qc.invalidateQueries(); // the app notices the new version on its next request, no reload
    },
    [backend, qc],
  );

  return (
    <QueryClientProvider client={qc}>
      <div className="layout">
        <div className="panel">
          <h2>Backend control panel (simulates a deploy)</h2>
          <div className="versions">
            {VERSIONS.map((v) => (
              <button key={v} className={v === version ? "active" : ""} onClick={() => deploy(v)}>
                {v}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              <input
                type="checkbox"
                checked={sunset}
                onChange={(e) => {
                  setSunset(e.target.checked);
                  qc.invalidateQueries();
                }}
              />{" "}
              v1 is being retired (Sunset header)
            </label>
            <label>
              User:{" "}
              <select value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="1">1</option>
                <option value="2">2 (suspended on 1.8.0+)</option>
              </select>
            </label>
          </div>
          <div className="muted">
            App built from specs 1.3.0 to 1.6.0 (floor 1.3.0, major 1). Try 1.2.0, 2.0.0 and 2026.10.1 for the blocked screens.
          </div>
        </div>

        <div className="panel">
          <h2>The app</h2>
          <ApiVersionProvider
            baseUrl={BASE}
            fetch={fetchImpl}
            loading={<p>Checking API version…</p>}
            renderBlocked={(c) =>
              c.status === "backend-too-old" ? (
                <Blocked title="Please update the backend" detail={`This app needs API ${c.floor} or newer. Connected: ${c.version}.`} />
              ) : c.status === "app-too-old" ? (
                <Blocked title="Please update the app" detail={`This app does not support API ${c.version}.`} />
              ) : (
                <Blocked title="Unrecognised API version" detail={c.version} />
              )
            }
          >
            <UserCard id={userId} />
          </ApiVersionProvider>
        </div>

        <div className="panel">
          <h2>Requests sent by the app</h2>
          <pre>{log.join("\n") || "(none yet)"}</pre>
        </div>
      </div>
    </QueryClientProvider>
  );
}
