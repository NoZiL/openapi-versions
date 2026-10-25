# Version-aware API client (prototype)

One frontend build that works against **a range of minor versions of one API major**: features the backend
lacks are hidden like feature flags, unknown additions from newer backends are tolerated
(Tolerant Reader), and breaking changes are only allowed across majors.

Built on [openapi-typescript](https://openapi-ts.dev/) + openapi-fetch + openapi-react-query (TanStack Query),
as a wrapper, not a fork.

**Docs:** [docs/](docs/README.md) (concepts, getting started, how-tos, reference, troubleshooting) · **LLM agents:** [AGENTS.md](AGENTS.md) and [skills/](skills) · **Package:** `openapi-versions` (`pnpm build` → `dist/`: runtime, codegen, CLI) · **Playground:** `pnpm playground` (app) · `pnpm playground:api` (CLI demo)

## Quick start

```bash
mise install && pnpm install
# oasdiff (>= 1.34) on PATH or OASDIFF_BIN runs the breaking-change gate; without it codegen warns and skips it
# (use --require-gate or "gate": "required" in CI): https://github.com/oasdiff/oasdiff/releases
pnpm codegen         # check + merge + generate for playground/ and test/fixtures/ (output is gitignored)
pnpm typecheck       # includes compile-time guarantees in test/types.check.ts
npm test                # 34 tests: merge, since maps, oasdiff gate, compat matrix, React, loaders, major transition
pnpm playground:api  # one client build vs backends 1.2.0 … 2.0.0
npx tsx codegen/cli.ts --check-only --config test/fixtures/broken.config.json   # shows the CI gate failing
```

## How it works

```
playground/specs/1.3.0.json … 1.6.0.json            playground/openapi-versions.config.json (major + floor)
            │
            ▼  codegen/build.ts  (per major)
  1. keep specs >= floor
  2. oasdiff breaking on each consecutive pair  → build fails on any break
  3. tolerant merge: paths/props ∪, required ∩, enums ∪        (codegen/merge.ts)
  4. since maps: ops + fields added after the floor            (codegen/since.ts)
  5. openapi-typescript on the merged doc, open extensible enums (codegen/open-enums.ts)
            │
            ▼
  playground/generated/vN/{schema.d.ts, meta.ts, merged.openapi.json}, playground/generated/index.ts
```

Runtime:

| File                                | Role                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`, `src/core/index.ts` | Generic runtime entry points (`createVersionAware(meta)`); apps use the generated `v<n>/client.ts`, which binds them to the app's types |
| `src/core/compat.ts`                | `resolveCompat(version, majors)` → ok / backend-too-old / app-too-old / invalid-version, `supports(op)`, `hasField(field)`              |
| `src/core/client.ts`                | One openapi-fetch client exposed as `core` (gated ops removed from types) and `gated` (full), `X-Api-Version` middleware                |
| `src/core/types.ts`                 | `StripOps`: removes gated operations at the type level                                                                                  |
| `src/core/api.ts`                   | `Api<P, G>` = compat + `$api` / `$gated` (openapi-react-query) + `gate()`; `createApi()` builds it outside React                        |
| `src/react/ApiVersionProvider.tsx`  | `/version` via React Query, blocked screens, `useApi`, `useSupports`, `<Feature>`, mid-session re-evaluation                            |
| `patches/`                          | One-line fix to `openapi-typescript-helpers` so open enums survive openapi-fetch's `Readable<T>` (applied by pnpm `patchedDependencies`; tracked upstream in openapi-ts/openapi-typescript#2766)  |
| `playground/api/mock-backend.ts`    | Fetch-compatible fake backend at any version, including future ones                                                                     |
| `test/fixtures/`                    | Spec copies for the tests, a breaking 1.7.0 (CI gate demo) and a 2.0.0 (next major); generated client is gitignored                     |
| `playground/`                       | `api/` (fake backend + CLI demo), `app/` (Vite app), `specs/` + config for its own generated client                                     |

## Usage

```tsx
<QueryClientProvider client={qc}>
  <ApiVersionProvider baseUrl={API_URL}>
    <App />
  </ApiVersionProvider>
</QueryClientProvider>;

const { $api, $gated, gate } = useApi();

// operations every supported backend has: plain openapi-react-query
const user = $api.useQuery("get", "/users/{id}", { params: { path: { id } } });

// operations added after the floor: gate() turns the query into skipToken when unsupported
const activity = useQuery(gate($gated.queryOptions("get", "/users/{id}/activity", { params: { path: { id } } })));

// gated mutations: render the trigger inside <Feature>
const archive = $gated.useMutation("post", "/users/{id}/archive");
<Feature requires="post /users/{id}/archive">
  <button onClick={() => archive.mutate({ params: { path: { id } } })}>Archive</button>
</Feature>;

// router loader / prefetch: same options, no hook
const api = await createApi({ baseUrl: API_URL });
await queryClient.ensureQueryData(api.$api.queryOptions("get", "/users/{id}", { params: { path: { id } } }));
```

Compile-time rules (see `test/types.check.ts`): a gated operation is not on `$api`, so it can only be
reached through `$gated`; a gated query cannot be used with `useSuspenseQuery`.

## One major per app release, majors side by side on the backend

The app supports one API major and points its `baseUrl` at that major's prefix:

```
https://host/api/v1   ← every 1.x app build
https://host/api/v2   ← every 2.x app build
```

Each major is served under its own prefix with its own `GET {prefix}/version` and `X-Api-Version`
header, so the client never needs to know other majors exist. During a transition the backend serves
both prefixes; v1 is frozen (patches only) and its responses carry a `Sunset` header (RFC 8594).

| Situation                                                           | What the 1.x app does                                                 |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `/api/v1` live, no Sunset                                           | Works normally                                                        |
| `/api/v1` live with `Sunset`                                        | Works; `useSunset()` returns the date for an "update before …" banner |
| `/api/v1` answers a 2.x version, or the app is pointed at `/api/v2` | Blocked: "update the app"                                             |

Moving the app to 2.x is a new release: set the major in the config, import from `…/v2/client` instead of `…/v1/client`,
point `baseUrl` at `/api/v2`, run codegen, fix what the compiler reports. `test/majors.test.tsx`
runs both majors side by side (`sideBySide()` in `playground/api/mock-backend.ts`).

## Contract rules the backend must follow

- Within a major: additive changes only (oasdiff gate).
- Enums that may grow: `x-extensible-enum` (generated as open unions). Plain `enum` is closed; adding a value is breaking.
- Each major under its own prefix (`/api/v1`, `/api/v2`), each with `GET {prefix}/version` → `{ "version": "<semver>" }` and `X-Api-Version` on every response. Real semver only: `2026.10.1` parses as major 2026.
- A major being retired sends `Sunset: <HTTP-date>` on its responses. Optional: `GET /api/versions` listing live majors and their sunset dates.

## Release cadence

- New API release: add `playground/specs/<version>.json` (take it from the backend CI artifact of the release commit), `pnpm codegen`.
  The upcoming unreleased spec can be added before the backend ships: its features stay hidden until the backend reports that version.
- Raise a floor in `openapi-versions.config.json` when a version leaves the support window; gated ops become plain ops, and the compiler shows which checks are now dead.
