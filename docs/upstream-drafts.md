# Upstream drafts (NOT posted)

> **Status 2026-10-25 — draft 1 is superseded.** [openapi-ts/openapi-typescript#2766](https://github.com/openapi-ts/openapi-typescript/pull/2766) (open, review required) contains the same fix (primitive guard before `T extends object` in `Readable`/`Writable`). Do not post a duplicate; add the repro below as a comment there. Related: [#2415](https://github.com/openapi-ts/openapi-typescript/pull/2415) (merged, unreleased, queued for openapi-typescript 7.14.0 in release PR #2616) makes openapi-typescript itself emit `(literals) | (string & {})` for `additionalProperties: true` string enums, which hits this bug in every openapi-fetch consumer once released. Both are reasons to drop `patches/` once they ship.

Two drafts for the openapi-ts repository (`openapi-ts/openapi-typescript`). Nothing here has been sent. Before posting: search existing issues for duplicates, re-run the repro on the latest versions, and fill in the placeholders in `<angle brackets>`.

Versions used for the repro: `openapi-fetch@0.17.0`, `openapi-typescript-helpers@0.1.0`, `openapi-typescript@7.13`, `typescript@5.9`.

---

## 1. Bug + PR: `Readable<T>` / `Writable<T>` turn `string & {}` into an object type

**Package:** `openapi-typescript-helpers`

### Title

`Readable<T>` and `Writable<T>` map over `string & {}`, so open string unions lose their open member

### Description

Open string unions such as `"a" | "b" | (string & {})` are a common way to say "these values are known, others may appear" while keeping editor completion. `Readable<T>` and `Writable<T>` do not preserve them: `string & {}` matches the `T extends object` branch, and the mapped type then produces an object with all of `String`'s members instead of a string.

`openapi-fetch` wraps every response in `Readable<…>` (and every request body in `Writable<…>`), so the problem shows up in `data` and `error` of every call whose schema contains such a type, for instance a schema generated with a `transform` hook that emits open enums.

### Reproduction

`schema.d.ts` (the shape openapi-typescript emits with a transform that makes a string enum open):

```ts
export interface paths {
  "/users/{id}": {
    parameters: { query?: never; header?: never; path?: never; cookie?: never };
    get: {
      parameters: { query?: never; header?: never; path: { id: string }; cookie?: never };
      requestBody?: never;
      responses: {
        200: {
          headers: { [name: string]: unknown };
          content: { "application/json": { id: string; status: "active" | "invited" | "archived" | (string & {}) } };
        };
      };
    };
  };
}
```

```ts
import createClient from "openapi-fetch";
import type { paths } from "./schema";

const client = createClient<paths>({ baseUrl: "http://x" });
const { data } = await client.GET("/users/{id}", { params: { path: { id: "1" } } });

export const asString: string = data!.status; // error
export function label(s: NonNullable<typeof data>["status"]) {
  switch (s) {
    case "active":
      return "A";
    default:
      return s.toUpperCase();
  } // error
}
```

### Actual

```
error TS2322: Type '"active" | "invited" | "archived" | { readonly [x: number]: string; toString: {}; charAt: {}; charCodeAt: {}; concat: {}; indexOf: {}; ... }' is not assignable to type 'string'.
error TS2349: This expression is not callable. Not all constituents of type '(() => string) | {}' are callable.
```

The open member became `{ readonly [x: number]: string; toString: {}; charAt: {}; … }`.

### Expected

`Readable<"a" | (string & {})>` is `"a" | (string & {})`: primitives are returned unchanged, only objects and arrays are mapped.

### Cause

In `Readable<T>` (and `Writable<T>`) the last branches are:

```ts
… : T extends (infer E)[] ? Readable<E>[]
  : T extends object ? { [K in keyof T as …]: Readable<T[K]> }
  : T;
```

`string & {}` is assignable to `object`'s mapped path, so the mapped type iterates the keys of `String`.

### Proposed fix

Return primitives before the object branch, in both helpers:

```diff
-type Readable<T> = T extends $Write<any> ? never : T extends $Read<infer U> ? Readable<U> : T extends (infer E)[] ? Readable<E>[] : T extends object ? { … } : T;
+type Readable<T> = T extends $Write<any> ? never : T extends $Read<infer U> ? Readable<U> : T extends (infer E)[] ? Readable<E>[] : T extends string | number | boolean | bigint | symbol ? T : T extends object ? { … } : T;
```

and the same line in `Writable<T>`. A drop-in diff against 0.1.0 is in this repo: `patches/openapi-typescript-helpers@0.1.0.patch` (pnpm format).

With the patch applied, the repro above compiles; `"zzz"` is accepted where a newer backend sends an unknown value and `switch` still narrows the known cases.

### PR checklist (when posting)

- [ ] Add a type test next to the existing helper tests: `Readable<"a" | (string & {})>` equals `"a" | (string & {})`, and the same for `Writable`.
- [ ] Add a changeset for `openapi-typescript-helpers` (patch).
- [ ] Confirm other primitives are unaffected (`number`, `boolean`, `null`, template literal types).
- [ ] Mention that it also fixes `branded` primitives such as `string & { __brand: "x" }` (verify before claiming).

---

## 2. Discussion / proposal: multi-version input ("one client, a range of server versions")

**Where:** GitHub Discussion (Ideas) first, not an issue. This is a feature request that may belong outside the core.

### Title

Supporting a range of API minor versions from one generated client: merge + since-map + capability gating

### Problem

A client often has to work against more than one version of the same API at once: mobile builds stay installed for months, the web app deploys continuously while the backend deploys on its own cycle, staging and on-prem differ from production. Today `openapi-typescript` takes one document and `openapi-fetch` / `openapi-react-query` assume the server matches it. That breaks in both directions: a client ahead of the server calls operations that 404, a client behind the server meets values and fields it has never seen.

I did not find an existing tool for this. Hey API's multi-input merges different APIs and prefixes colliding paths; oasdiff detects breaking changes but produces no client.

### What I built (works today, outside the core)

A wrapper around the Node API of `openapi-typescript`, no fork, published as `<package>`:
1. **Inputs:** one spec per released version of one major, plus a _floor_ (oldest supported minor).
2. **Gate:** `oasdiff breaking` on each consecutive pair; the build fails on any break. Inside a major, changes must be additive.
3. **Tolerant merge:** paths, operations and properties are the union; `required` is the intersection; enums are the union; the rest is newest-wins.
4. **Since maps:** for operations and schema fields introduced after the floor, the first version that has them.
5. **Generation:** `openapiTS(mergedDocument, { transform })`. The `transform` hook turns `x-extensible-enum` into open unions (`"a" | "b" | (string & {})`).
6. **Runtime (separate, thin):** reads `GET <base>/version` and `X-Api-Version`, and exposes `supports(op)` / `hasField(field)`. A second `openapi-react-query` client is typed with gated operations removed, so calling a newer operation without a capability check is a compile error.

Evidence: a prototype with 34 tests runs one client build against seven backend versions plus two majors side by side, and never sends a request to an operation the connected backend lacks. A packed install into a fresh app generates and type-checks.

### What I am asking

Which of these would you like, if any?
- **A. Nothing in core.** The wrapper stays a separate package. Could the docs list it under ecosystem / recipes?
- **B. Documented recipe** for multi-spec input using the existing `transform` hook and Node API (no code in core).
- **C. Small core hooks** that would make the wrapper simpler: (i) built-in open enums from an extension keyword (today: custom `transform`), (ii) a way to pass several documents and receive the merged one, (iii) exposing the operation list (`"<method> <path>"` keys) with the schema.

Separately, I will open the `Readable` / `Writable` fix as its own PR (see above); it is independent of this proposal.

### Open design questions I would like feedback on

- Is `x-extensible-enum` the right keyword, or should open enums use another convention?
- Should "closed vs open enum" be a first-class concept in openapi-typescript?
- The merge is only sound if the inputs are non-breaking relative to each other. Is it better to run the oasdiff gate inside the tool or leave it to CI?
- Fields added after the floor become optional in the merged types. Is there a better representation (for example a branded "since" type)?

### Links

- Repo: `<repo url>`
- Concepts and how-tos: `<docs url>`
- Example app (control panel that "deploys" backend versions while the app is open): `<url or gif>`

---

## Posting order I would suggest

1. Open the `Readable` / `Writable` PR first: small, self-contained, needs no discussion.
2. Post the discussion after the PR, linking it as evidence that the open-enum use case is real.
3. Only after maintainers respond, decide between options A, B and C.
