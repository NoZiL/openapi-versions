// @vitest-environment jsdom

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMockBackend } from "../playground/api/mock-backend";
import { ApiVersionProvider, Feature, type Paths, useApi } from "./fixtures/generated/v1/client";

type Status = Paths["/users/{id}"]["get"]["responses"][200]["content"]["application/json"]["status"];

/** Extensible enum: the default branch is required by the open type */
function statusLabel(status: Status): string {
  switch (status) {
    case "active":
      return "Active";
    case "invited":
      return "Invited";
    case "archived":
      return "Archived";
    default:
      return status; // value added by a newer backend: shown raw, no crash
  }
}

function UserCard({ id }: { id: string }) {
  const { $api, $gated, gate } = useApi();
  const user = $api.useQuery("get", "/users/{id}", { params: { path: { id } } });
  const activity = useQuery(gate($gated.queryOptions("get", "/users/{id}/activity", { params: { path: { id } } })));
  const archive = $gated.useMutation("post", "/users/{id}/archive");
  if (!user.data) return <p>loading user</p>;
  return (
    <div>
      <h1>{user.data.name}</h1>
      <span data-testid="status">{statusLabel(user.data.status)}</span>
      <Feature requires="post /users/{id}/archive">
        <button onClick={() => archive.mutate({ params: { path: { id } } })}>Archive</button>
      </Feature>
      <Feature requires="get /users/{id}/activity" fallback={<span>no activity</span>}>
        <span>activity: {activity.data?.length ?? "…"}</span>
      </Feature>
    </div>
  );
}

function setup(version: string, id = "1") {
  const backend = createMockBackend(version);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ApiVersionProvider baseUrl="http://api.test" fetch={backend.fetch} loading={<p>checking API</p>}>
        <UserCard id={id} />
      </ApiVersionProvider>
    </QueryClientProvider>,
  );
  return { backend, qc };
}

afterEach(cleanup);

describe("frontend against different backends", () => {
  it("1.4.0 (client ahead): hides features the backend lacks and never calls them", async () => {
    const { backend } = setup("1.4.0");
    await screen.findByText("Ada Lovelace");
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.getByText("no activity")).toBeTruthy();
    expect(backend.calls).not.toContain("GET /users/1/activity");
  });

  it("backend deploys 1.6.0 mid-session: features appear without reload", async () => {
    const { backend, qc } = setup("1.4.0");
    await screen.findByText("Ada Lovelace");
    backend.deploy("1.6.0");
    await act(() => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "api-version" }));
    await screen.findByText("Archive");
    await screen.findByText("activity: 1");
  });

  it("1.8.0 (backend ahead): unknown enum value and unknown field are tolerated", async () => {
    setup("1.8.0", "2");
    await screen.findByText("Ada Lovelace");
    expect(screen.getByTestId("status").textContent).toBe("suspended");
    expect(screen.getByText("Archive")).toBeTruthy();
  });

  it("2.0.0: another major needs a new app release, so it is blocked", async () => {
    setup("2.0.0");
    await waitFor(() => expect(screen.getByText(/Please update the app/)).toBeTruthy());
  });

  it("1.2.0: below the floor is blocked", async () => {
    setup("1.2.0");
    await waitFor(() => expect(screen.getByText(/needs API 1.3.0 or newer/)).toBeTruthy());
  });
});
