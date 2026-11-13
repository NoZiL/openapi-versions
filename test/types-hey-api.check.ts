/**
 * Compile-time guarantees of the Hey API codegen path (ADR 0027). Checked by `pnpm typecheck` (tsc), never executed.
 * Each @ts-expect-error FAILS the typecheck if the line stops being an error.
 */
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { $api, $gated, type Api, useSupports } from "./fixtures/generated/hey-api/v1/client";
import * as core from "./fixtures/generated/hey-api/v1/core";
import * as gated from "./fixtures/generated/hey-api/v1/gated";
import type { GatedOp } from "./fixtures/generated/hey-api/v1/meta";
import type { GetUserResponse, User } from "./fixtures/generated/hey-api/v1/sdk/types.gen";

const path = { path: { id: "1" } };

export function guarantees() {
  // 1. Floor operations are in core.ts: sdk function and query options
  void core.getUser(path);
  void core.getUserOptions(path);

  // 2. Operations added after the floor are NOT in core.ts...
  // @ts-expect-error activity exists only since 1.6.0
  void core.getUserActivityOptions(path);
  // @ts-expect-error archive exists only since 1.5.0
  void core.archiveUserMutation();
  // @ts-expect-error archive exists only since 1.5.0
  void core.archiveUser(path);

  // ...only in gated.ts
  void gated.getUserActivityOptions(path);
  void gated.archiveUserMutation();
  // @ts-expect-error a floor operation is not gated
  void gated.getUserOptions(path);

  // 3. Hey API query keys carry the operation id that gate() maps with meta.opIds
  const id: string = gated.getUserActivityOptions(path).queryKey[0]._id;

  // 4. Open enums: known values kept, newer values compile, and not collapsed to plain string
  const fromOldBackend: User = { id: "1", name: "Ada", status: "active" };
  const fromNewerBackend: User = { ...fromOldBackend, status: "suspended" };
  const status: GetUserResponse["status"] = "invited";
  const s: string = status;
  // @ts-expect-error the known values are kept: not plain string
  const known: "nope" = status;

  // 5. Gated op keys are the same as on the other stacks
  const op: GatedOp = "post /users/{id}/archive";
  // @ts-expect-error a floor operation is not a gated op
  const notGated: GatedOp = "get /users/{id}";

  return [id, fromOldBackend, fromNewerBackend, s, known, op, notGated];
}

/** The client.ts surface (#126): $api / $gated with gate(), as in test/types.check.ts. */
export function clientGuarantees({ gate }: Api) {
  // 1. Floor operations on $api, gated ones only on $gated
  useQuery($api.getUserOptions(path));
  // @ts-expect-error activity exists only since 1.6.0
  $api.getUserActivityOptions(path);
  useQuery(gate($gated.getUserActivityOptions(path)));
  useMutation($gated.archiveUserMutation());

  // 2. A gated query may be skipToken, so it cannot suspend
  // @ts-expect-error gated query cannot be used with suspense
  useSuspenseQuery(gate($gated.getUserActivityOptions(path)));
  useSuspenseQuery($api.getUserOptions(path));

  // 3. gate() only takes Hey API query options (keyed by operation id)
  // @ts-expect-error not Hey API query options
  gate({ queryKey: ["get", "/users/{id}"] });

  // 4. Response data keeps the open enum
  const q = useQuery($api.getUserOptions(path));
  if (q.data) {
    const s: string = q.data.status;
    // @ts-expect-error the known values are kept: not plain string
    const known: "nope" = q.data.status;
    void [s, known];
  }

  // 5. Capability names are op keys, not Hey API ids
  // @ts-expect-error unknown operation
  useSupports("get /nope");
  // @ts-expect-error op keys, not operation ids
  useSupports("archiveUser");
  useSupports("post /users/{id}/archive");

  // 6. Query keys for invalidation come from the options (no xxxQueryKey re-export)
  const key: readonly [{ _id: string }] = $api.getUserOptions(path).queryKey;
  return key;
}
