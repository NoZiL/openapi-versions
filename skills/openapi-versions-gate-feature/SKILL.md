---
name: openapi-versions-gate-feature
description: Use an API operation or field that only exists on newer backend versions, in an app built with the version-aware client. Use when writing UI or data code against operations in `gatedOps`/`gatedFields`, when TypeScript says an operation does not exist on `$api`, or when handling an extensible enum.
---

# Gate a feature in app code

Source of truth for what is gated: `src/generated/v<n>/meta.ts` (`gatedOps`, `gatedFields`: key → version that introduced it). Anything not listed exists on every supported backend and is used normally through `$api`.

## Pick the pattern

| Need | Code |
|---|---|
| Always-available operation | `const { $api } = useApi(); $api.useQuery("get", "/users/{id}", init)` |
| Gated **query** | `const { $gated, gate } = useApi(); useQuery(gate($gated.queryOptions("get", "/users/{id}/activity", init)))` |
| Gated **mutation** | `const m = $gated.useMutation("post", "/users/{id}/archive");` and render the trigger inside `<Feature requires="post /users/{id}/archive" fallback={…}>` |
| Boolean check | `useSupports("get /users/{id}/activity")`; outside React `api.compat.supports(op)` |
| Gated **field** | `useHasField("User.avatarUrl")`; the field is typed optional |
| Loader / outside React | `const api = await createApi({ baseUrl }); api.$api.queryOptions(...)` |

Operation keys: lower-case method + space + path template. Field keys: `Schema.property`.

## Rules

- A gated operation is NOT on `$api` (compile error is intended). Do not cast around it; use `$gated`.
- `gate()` results cannot go to `useSuspenseQuery` (may be skipped). Use `useQuery`.
- Never read or compare the backend version in a component. Ask `supports` / `hasField`.
- Provide a sensible UI when the feature is off (`fallback`, or render nothing). No error state: an unsupported operation is never called.
- Extensible enums are open unions: always a `default` branch in `switch`, showing the raw value. Do not narrow with `as`.
- Newer backends may send fields the app does not know: ignore them, never validate strictly against the generated shape.

## Check

`pnpm typecheck`. For behaviour, test with `createMockBackend(version)` from `playground/api/mock-backend.ts` against a version below, at, and above the feature (see `test/react.test.tsx`): assert the control is absent below, present at/above, and that `backend.calls` contains no request to the gated path below.
