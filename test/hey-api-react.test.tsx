// @vitest-environment jsdom
/** The Hey API runtime (`openapi-versions/hey-api`, #126) on the generated fixture: test/react.test.tsx's scenarios. */

import fs from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createMockBackend } from "../playground/api/mock-backend";
import { $api, $gated, ApiVersionProvider, createApi, Feature, type User, useApi, useSunset } from "./fixtures/generated/hey-api/v1/client";
import { client } from "./fixtures/generated/hey-api/v1/sdk/client.gen";

function statusLabel(status: User["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "invited":
      return "Invited";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

function UserCard({ id }: { id: string }) {
  const { gate } = useApi();
  const user = useQuery($api.getUserOptions({ path: { id } }));
  const activity = useQuery(gate($gated.getUserActivityOptions({ path: { id } })));
  const archive = useMutation($gated.archiveUserMutation());
  const sunset = useSunset();
  if (!user.data) return <p>loading user</p>;
  return (
    <div>
      <h1>{user.data.name}</h1>
      <span data-testid="status">{statusLabel(user.data.status)}</span>
      {sunset && <span>sunset {sunset.toISOString().slice(0, 10)}</span>}
      <Feature requires="post /users/{id}/archive">
        <button type="button" onClick={() => archive.mutate({ path: { id } })}>
          Archive
        </button>
        {archive.isSuccess && <span>archived</span>}
      </Feature>
      <Feature requires="get /users/{id}/activity" fallback={<span>no activity</span>}>
        <span>activity: {activity.data?.length ?? "…"}</span>
      </Feature>
    </div>
  );
}

function setup(version: string, id = "1", opts: { sunset?: string; strict?: boolean } = {}) {
  const backend = createMockBackend(version, opts);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={qc}>
      <ApiVersionProvider baseUrl="http://api.test" fetch={backend.fetch} loading={<p>checking API</p>}>
        <UserCard id={id} />
      </ApiVersionProvider>
    </QueryClientProvider>
  );
  const view = render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { backend, qc, view };
}

/** Response interceptors registered on the generated client, ejected ones excluded. */
const interceptors = () => (client.interceptors.response as unknown as { fns: unknown[] }).fns.filter(Boolean).length;

afterEach(cleanup);

describe("Hey API runtime against different backends", () => {
  it("1.4.0 (client ahead): hides features the backend lacks and never calls them", async () => {
    const { backend } = setup("1.4.0");
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.getByText("no activity")).toBeTruthy();
    expect(backend.calls).not.toContain("GET /users/1/activity");
  });

  it("1.6.0: gated query runs, gated mutation works", async () => {
    const { backend } = setup("1.6.0");
    await screen.findByText("activity: 1");
    act(() => screen.getByText("Archive").click());
    await screen.findByText("archived");
    expect(backend.calls).toContain("POST /users/1/archive");
  });

  it("backend deploys 1.6.0 mid-session: X-Api-Version (interceptor) brings the features without reload", async () => {
    const { backend, qc } = setup("1.4.0");
    await screen.findByText("Ada Lovelace");
    backend.deploy("1.6.0");
    await act(() => qc.refetchQueries({ predicate: (q) => q.queryKey[0] !== "api-version" }));
    await screen.findByText("Archive");
    await screen.findByText("activity: 1");
  });

  it("1.8.0 (backend ahead): unknown enum value is tolerated", async () => {
    setup("1.8.0", "2");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("suspended"));
  });

  it("Sunset header (interceptor) is surfaced", async () => {
    setup("1.6.0", "1", { sunset: "2027-01-31T00:00:00Z" });
    await screen.findByText("sunset 2027-01-31");
  });

  it("leaves one interceptor under StrictMode, and none after unmount", async () => {
    const before = interceptors();
    const { view } = setup("1.6.0", "1", { strict: true, sunset: "2027-01-31T00:00:00Z" });
    await screen.findByText("sunset 2027-01-31");
    expect(interceptors()).toBe(before + 1);
    view.unmount();
    expect(interceptors()).toBe(before);
  });
});

describe("Hey API runtime without React", () => {
  it("createApi: gate() on query keys built by Hey API", async () => {
    const backend = createMockBackend("1.5.0");
    const { compat, gate } = await createApi({ baseUrl: "http://api.test", fetch: backend.fetch });
    expect(compat.version).toBe("1.5.0");
    expect(gate($gated.getUserActivityOptions({ path: { id: "1" } })).queryFn).toBeTypeOf("symbol"); // skipToken
    expect(gate($api.getUserOptions({ path: { id: "1" } })).queryFn).toBeTypeOf("function");
    const { data } = await $api.getUser({ path: { id: "1" } });
    expect(data?.name).toBe("Ada Lovelace");
  });

  it("gate() refuses an operation id codegen did not write", async () => {
    const { gate } = await createApi({ baseUrl: "http://api.test", fetch: createMockBackend("1.6.0").fetch });
    expect(() => gate({ queryKey: [{ _id: "notAnOperation" }] })).toThrow(/unknown Hey API operation "notAnOperation"/);
  });

  it("imports no openapi-fetch or openapi-react-query (only peer: @tanstack/react-query)", () => {
    const seen = new Set<string>();
    const bare = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const [, spec] of fs.readFileSync(file, "utf8").matchAll(/(?:from|import)\s*"([^"]+)"/g)) {
        if (!spec.startsWith(".")) bare.add(spec);
        else {
          const base = path.resolve(path.dirname(file), spec);
          visit([".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((f) => fs.existsSync(f))!);
        }
      }
    };
    visit(path.resolve("src/hey-api/index.tsx"));
    expect([...bare].sort()).toEqual(["@tanstack/react-query", "react", "semver"]);
  });
});
