/**
 * Spike #124: the compile-time guarantees of test/types.check.ts, on Hey API output.
 * Checked by tsc, never executed. Each @ts-expect-error FAILS the typecheck if the line stops being an error.
 */
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { type Api, api, gated, type User, useSupports } from "./out/test/v1/client";

const path = { path: { id: "1" } };

export function guarantees({ gate }: Api) {
  // 1. Floor operations are on `api`: sdk function, query options
  useQuery(api.getUserOptions(path));
  void api.getUser(path);

  // 2. Operations added after the floor are NOT on `api`...
  // @ts-expect-error activity exists only since 1.6.0
  api.getUserActivityOptions(path);
  // @ts-expect-error archive exists only since 1.5.0
  api.archiveUserMutation();
  // @ts-expect-error archive exists only since 1.5.0
  void api.archiveUser(path);

  // ...only on `gated`, where queries go through gate()
  useQuery(gate(gated.getUserActivityOptions(path)));
  useMutation(gated.archiveUserMutation());

  // 3. A gated query may be skipToken, so it cannot suspend
  // @ts-expect-error gated query cannot be used with suspense
  useSuspenseQuery(gate(gated.getUserActivityOptions(path)));
  useSuspenseQuery(api.getUserOptions(path));

  // gate() only takes Hey API query options (keyed by operation id)
  // @ts-expect-error not query options
  gate({ queryKey: ["get", "/users/{id}"] });

  // 4. Response data keeps the open enum (no helpers patch on this path)
  const q = useQuery(api.getUserOptions(path));
  if (q.data) {
    const s: string = q.data.status;
    // @ts-expect-error the known values are kept: not plain string
    const known: "nope" = q.data.status;
    void s;
    void known;
  }

  // 5. Fields added after the floor are optional: a 1.3.0 payload type-checks
  const fromOldBackend: User = { id: "1", name: "Ada", status: "active" };
  // 6. Extensible enums are open: a value from a newer backend compiles
  const fromNewerBackend: User = { ...fromOldBackend, status: "suspended" };

  // 7. Capability names are checked, and stay op keys (not Hey API ids)
  // @ts-expect-error unknown operation
  useSupports("get /nope");
  // @ts-expect-error op keys, not operation ids
  useSupports("archiveUser");
  useSupports("post /users/{id}/archive");

  return [fromOldBackend, fromNewerBackend];
}
