// @vitest-environment jsdom
/**
 * Major transition: the backend serves /api/v1 and /api/v2 side by side.
 * This app build supports major 1 only and points its baseUrl at /api/v1.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createMockBackend, sideBySide } from "../playground/api/mock-backend";
import { fetchBackendVersion } from "../src/core/client";
import { ApiVersionProvider, createApi, useApi, useSunset } from "./fixtures/generated/v1/client";

const SUNSET = "2027-03-01T00:00:00Z";

function server() {
  const v1 = createMockBackend("1.9.2", { sunset: SUNSET });
  const v2 = createMockBackend("2.0.0");
  return { v1, v2, fetch: sideBySide({ "/api/v1": v1, "/api/v2": v2 }) };
}

function UserName() {
  const { $api } = useApi();
  const sunset = useSunset();
  const user = $api.useQuery("get", "/users/{id}", { params: { path: { id: "1" } } });
  return (
    <div>
      {sunset && <p role="alert">This version stops working on {sunset.toISOString().slice(0, 10)}. Please update.</p>}
      <h1>{user.data?.name ?? "…"}</h1>
    </div>
  );
}

function mount(baseUrl: string, fetchImpl: typeof fetch) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApiVersionProvider baseUrl={baseUrl} fetch={fetchImpl}>
        <UserName />
      </ApiVersionProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("major transition, majors served side by side", () => {
  it("/version is resolved under the base path, not at the host root", async () => {
    const s = server();
    expect(await fetchBackendVersion("http://api.test/api/v1", s.fetch)).toBe("1.9.2");
    expect(await fetchBackendVersion("http://api.test/api/v2/", s.fetch)).toBe("2.0.0");
  });

  it("a 1.x app keeps working against /api/v1 while v2 is live, and warns about the sunset", async () => {
    const s = server();
    mount("http://api.test/api/v1", s.fetch);
    await screen.findByText("Ada Lovelace");
    expect((await screen.findByRole("alert")).textContent).toContain("2027-03-01");
    expect(s.v1.calls).toContain("GET /users/1");
    expect(s.v2.calls).toHaveLength(0);
  });

  it("the same 1.x app pointed at /api/v2 is blocked: v2 needs a new app release", async () => {
    const s = server();
    mount("http://api.test/api/v2", s.fetch);
    await waitFor(() => expect(screen.getByText(/Please update the app/)).toBeTruthy());
  });

  it("loaders work with a prefixed base URL too", async () => {
    const s = server();
    const { $api } = await createApi({ baseUrl: "http://api.test/api/v1", fetch: s.fetch });
    const user = await new QueryClient().fetchQuery($api.queryOptions("get", "/users/{id}", { params: { path: { id: "1" } } }));
    expect(user.name).toBe("Ada Lovelace");
  });
});
