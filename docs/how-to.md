# How-to

Each recipe lists the exact steps. Run `pnpm codegen`, `pnpm typecheck` and `pnpm test` after changes.
- [Add the spec of a new backend release](#add-the-spec-of-a-new-backend-release)
- [Use a feature before the backend ships it](#use-a-feature-before-the-backend-ships-it)
- [Gate a query, a mutation, a field](#gate-a-query-a-mutation-a-field)
- [Declare an enum that can grow](#declare-an-enum-that-can-grow)
- [Raise the floor](#raise-the-floor)
- [Handle a breaking-change failure](#handle-a-breaking-change-failure)
- [Move the app to the next major](#move-the-app-to-the-next-major)
- [Use the API in a router loader or outside React](#use-the-api-in-a-router-loader-or-outside-react)
- [Mobile (React Native)](#mobile-react-native)
- [Show an "update before" banner](#show-an-update-before-banner)
- [Test against several backend versions](#test-against-several-backend-versions)
- [Wire CI](#wire-ci)

## Add the spec of a new backend release

1. Download the spec from the backend release artifact. Save it as `specs/<version>.json` (e.g. `specs/1.7.0.json`). The file name must be the exact semver.
2. `pnpm codegen`. The oasdiff gate checks `1.6.0 → 1.7.0`; new operations land in the gated maps automatically.
3. `git diff src/generated/v1/meta.ts` shows what is newly gated.
4. Build the feature (see next recipe).

If the spec changes again before the release, overwrite the file and re-run codegen. The gate catches anything that stopped being additive.

## Use a feature before the backend ships it

This is the point of the tool. Add the upcoming spec (as above), build the feature behind `gate()` / `<Feature>`, and release. Users on the old backend never see it and no request is sent. The moment the backend deploys the new version, the next response carries `X-Api-Version`, the provider re-evaluates and the feature appears without a reload.

## Gate a query, a mutation, a field

Operation introduced after the floor, **query**:

```tsx
const { $gated, gate } = useApi();
const activity = useQuery(gate($gated.queryOptions("get", "/users/{id}/activity", init)));
// activity.data is undefined while the backend lacks the operation (skipToken: never fetched)
```

`gate()` output cannot be passed to `useSuspenseQuery` (compile error, by design: it may be skipped).

**Mutation**: render the trigger only when supported.

```tsx
const archive = $gated.useMutation("post", "/users/{id}/archive");
<Feature requires="post /users/{id}/archive" fallback={null}>
  …
</Feature>;
```

**Anywhere**: `useSupports("get /users/{id}/activity")` returns a boolean; outside React use `api.compat.supports(op)`.

**Field** added after the floor: its type is optional. Check explicitly when it matters.

```tsx
const showAvatar = useHasField("User.avatarUrl");
```

Operation keys are `"<method> <path>"` in lower-case method, e.g. `"post /users/{id}/archive"`; field keys are `"<Schema>.<property>"`. Both are typed (`GatedOp`, `GatedField`), so a typo is a compile error. Calling a gated operation through `$api` is also a compile error: it exists only on `$gated`.

## Declare an enum that can grow

Plain `enum` is closed: adding a value is a **breaking** change and oasdiff blocks it. For an enum that will grow within a major, the backend declares it with `x-extensible-enum`:

```json
"status": { "type": "string", "x-extensible-enum": ["active", "invited", "archived"] }
```

Codegen turns it into an open union, `"active" | "invited" | "archived" | (string & {})`. Autocomplete lists the known values, unknown ones compile, and a `switch` needs a `default` branch:

```ts
switch (user.status) {
  case "active": …
  default: return user.status; // value from a newer backend: show raw, do not crash
}
```

Converting an existing closed `enum` to `x-extensible-enum` is itself an API-contract decision: do it at a major boundary, or by adding the extension to every spec of the range.

## Raise the floor

When a backend minor leaves the support window:
1. Edit `majors.<n>.floor` in `openapi-versions.config.json` (the new floor needs a spec file).
2. Optionally delete older specs.
3. `pnpm codegen`. Operations that were gated only against versions below the new floor become ordinary operations.
4. `pnpm typecheck`. `useSupports(...)` / `<Feature requires=…>` for operations that are no longer gated now error or become dead; remove them.

## Handle a breaking-change failure

`FAIL v1: 1.6.0 -> 1.7.0` with an oasdiff report means a spec removed, renamed or retyped something, or added a required request field, or added a value to a closed enum. Options, in order of preference:
1. Fix the **backend** so the change is additive (add a new field, keep the old one).
2. If it was a growable enum, declare it `x-extensible-enum`.
3. If the break is intended, it belongs in a new major: [Move to the next major](#move-the-app-to-the-next-major).

Do not hand-edit specs to silence the gate: the merged types would then describe a server that does not exist.

## Move the app to the next major

The backend serves both majors side by side for a bounded window; the app switches only by a new release.
1. Backend ships `/api/v2` and keeps `/api/v1` running, frozen (patches only). Existing apps are unaffected.
2. Backend adds `Sunset` to v1 responses. 1.x apps show the banner ([recipe](#show-an-update-before-banner)).
3. In the app repo: put the 2.x specs in `specsDir`, set `majors` to `{ "2": { "floor": "2.0.0" } }`, run codegen, change imports from `…/v1/client` to `…/v2/client`, point `baseUrl` at `/api/v2`, fix compile errors.
4. When the sunset date passes, the backend removes `/api/v1`. Remaining 1.x builds get the "update the app" screen.

## Use the API in a router loader or outside React

```ts
import { createApi } from "./api/v1/client";
const api = await createApi({ baseUrl: "https://host/api/v1" }); // reads /version, throws if unsupported
await queryClient.ensureQueryData(api.$api.queryOptions("get", "/users/{id}", init));
```

Without React (scripts, workers, React Native without hooks) import the core from `openapi-versions/core`; the generated client already re-exports `createApi`.

Query keys are openapi-react-query's own (`[method, path, params]`), so the same options work in components, loaders and `prefetchQuery`.

## Mobile (React Native)

`src/core` is framework-free and the React layer works as is. Only the re-check trigger differs: the provider already refetches `/version` on window focus; on React Native wire app resume with TanStack Query's `focusManager` and `AppState`:

```ts
import { AppState } from "react-native";
import { focusManager } from "@tanstack/react-query";
AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
```

## Show an "update before" banner

```tsx
const sunset = useSunset(); // Date | undefined, set once a response carries a Sunset header
return sunset && <Banner>Update before {sunset.toDateString()}</Banner>;
```

## Test against several backend versions

`createMockBackend(version, { sunset? })` from `playground/api/mock-backend.ts` (a test helper in this repo; copy it) returns `{ fetch, calls, deploy(next) }`. Pass `fetch` to `ApiVersionProvider` or `createApi`, assert on `calls` that no gated request was sent, and call `deploy("1.6.0")` then invalidate queries to simulate a deploy mid-session. `sideBySide({ "/api/v1": …, "/api/v2": … })` simulates two majors. See `test/react.test.tsx` and `test/majors.test.tsx`. Pin the compile-time guarantees with `@ts-expect-error` as in `test/types.check.ts`.

## Wire CI

Backend CI (the important one): run oasdiff on the previous released spec and the new one and block the merge.

```bash
oasdiff breaking specs/1.6.0.json new-spec.json --fail-on ERR
```

Client CI:

```bash
npm ci
pnpm codegen        # fails on a breaking pair, bad config, or missing floor spec
git diff --exit-code src/generated   # if generated code is committed
pnpm typecheck && pnpm test
```

`pnpm check:breaking` runs only the gate and writes nothing.
