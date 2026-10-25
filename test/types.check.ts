/**
 * Compile-time guarantees. Checked by `pnpm typecheck` (tsc), never executed.
 * Each @ts-expect-error FAILS the typecheck if the line stops being an error.
 */
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type { Api, Paths } from "./fixtures/generated/v1/client";
import { useSupports } from "./fixtures/generated/v1/client";

type User = Paths["/users/{id}"]["get"]["responses"][200]["content"]["application/json"];
const id = { params: { path: { id: "1" } } };

export function guarantees({ client, $api, $gated, gate }: Api) {
  // 1. Operations available since the floor (1.3.0) are on $api / client.core
  $api.useQuery("get", "/users/{id}", id);
  void client.core.GET("/users/{id}", id);

  // 2. Operations added after the floor are NOT on $api / client.core...
  // @ts-expect-error activity exists only since 1.6.0
  $api.useQuery("get", "/users/{id}/activity", id);
  // @ts-expect-error archive exists only since 1.5.0
  $api.useMutation("post", "/users/{id}/archive");
  // @ts-expect-error archive exists only since 1.5.0
  void client.core.POST("/users/{id}/archive", id);

  // ...only on $gated, where queries go through gate()
  useQuery(gate($gated.queryOptions("get", "/users/{id}/activity", id)));
  $gated.useMutation("post", "/users/{id}/archive");

  // 3. A gated query may be skipToken, so it cannot suspend
  // @ts-expect-error gated query cannot be used with suspense
  useSuspenseQuery(gate($gated.queryOptions("get", "/users/{id}/activity", id)));
  useSuspenseQuery($api.queryOptions("get", "/users/{id}", id));

  // 4. Response data keeps the open enum (needs the openapi-typescript-helpers patch)
  const q = $api.useQuery("get", "/users/{id}", id);
  if (q.data) {
    const s: string = q.data.status;
    void s;
  }

  // 5. Fields added after the floor are optional: a 1.3.0 payload type-checks
  const fromOldBackend: User = { id: "1", name: "Ada", status: "active" };
  // 6. Extensible enums are open: a value from a newer backend compiles
  const fromNewerBackend: User = { ...fromOldBackend, status: "suspended" };

  // 7. Capability names are checked
  // @ts-expect-error unknown operation
  useSupports("get /nope");
  useSupports("post /users/{id}/archive");

  return [fromOldBackend, fromNewerBackend];
}
