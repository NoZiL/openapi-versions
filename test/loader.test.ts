/**
 * The same typed query options outside React: what a router loader or a
 * prefetch does. No hook, no provider.
 */

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createMockBackend } from "../playground/api/mock-backend";
import { createApi } from "./fixtures/generated/v1/client";

const params = { params: { path: { id: "1" } } };

describe("query options outside React", () => {
  it("loads typed data and caches it under openapi-react-query's key", async () => {
    const backend = createMockBackend("1.4.0");
    const { $api } = await createApi({ baseUrl: "http://api.test", fetch: backend.fetch });
    const qc = new QueryClient();
    const options = $api.queryOptions("get", "/users/{id}", params);
    const user = await qc.ensureQueryData(options);
    expect(user.name).toBe("Ada Lovelace");
    expect(qc.getQueryData(options.queryKey)).toEqual(user);
  });

  it("a gated query is skipped on an older backend and never hits the network", async () => {
    const backend = createMockBackend("1.4.0");
    const { $gated, gate } = await createApi({ baseUrl: "http://api.test", fetch: backend.fetch });
    const qc = new QueryClient();
    const options = gate($gated.queryOptions("get", "/users/{id}/activity", params));
    await qc.prefetchQuery(options);
    expect(qc.getQueryData(options.queryKey)).toBeUndefined();
    expect(backend.calls).not.toContain("GET /users/1/activity");
  });

  it("the same gated query runs once the backend has it", async () => {
    const backend = createMockBackend("1.6.0");
    const { $gated, gate } = await createApi({ baseUrl: "http://api.test", fetch: backend.fetch });
    const activity = await new QueryClient().fetchQuery(gate($gated.queryOptions("get", "/users/{id}/activity", params)));
    expect(activity).toHaveLength(1);
  });

  it("refuses another major up front", async () => {
    const backend = createMockBackend("2.0.0");
    await expect(createApi({ baseUrl: "http://api.test", fetch: backend.fetch })).rejects.toThrow(/app-too-old/);
  });
});
