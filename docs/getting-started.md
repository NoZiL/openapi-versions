# Getting started

## Prerequisites

- Node 20+, **TypeScript 5 or 6** (verified on 5.9 and 6.0; openapi-typescript 7 does not run on TypeScript 7, the native compiler, tracked in openapi-ts/openapi-typescript#2841).
- [`oasdiff`](https://github.com/oasdiff/oasdiff) on the `PATH` (or `OASDIFF_BIN=/path/to/oasdiff`), version 1.34 or newer. `brew install oasdiff` on macOS. Optional locally (codegen warns and skips the gate without it); set `"gate": "required"` or pass `--require-gate` in CI.
- A backend that: serves each major under its own prefix, answers `GET <prefix>/version` with `{ "version": "1.6.0" }`, sends `X-Api-Version` on every response, and publishes one OpenAPI JSON spec per release.

## Install

```bash
npm i openapi-versions
npm i openapi-fetch openapi-react-query @tanstack/react-query react   # peers: the openapi-ts runtime you already use
npm i -D openapi-typescript "typescript@<7"
```

`openapi-versions` is a layer on the openapi-ts packages, not a replacement: it generates types with `openapi-typescript`, calls with `openapi-fetch`, hooks with `openapi-react-query`. React and TanStack Query are optional; without them use `openapi-versions/core`.

Open enums need a one-line fix to `openapi-typescript-helpers` (see [troubleshooting](troubleshooting.md)); apply `patches/` with `patch-package` in your app until it lands upstream.

## 1. Collect the specs

Put one spec per released version in `specs/`, named `<semver>.json`. Take each from the backend CI artifact of the release commit, not from a branch tip.

```
specs/1.3.0.json
specs/1.4.0.json
specs/1.5.0.json
specs/1.6.0.json   # may be a release the backend has not deployed yet
```

Mark enums that may grow with `x-extensible-enum` in the spec (see [how-to](how-to.md#declare-an-enum-that-can-grow)).

## 2. Write the config

`openapi-versions.config.json`:

```json
{
  "$schema": "./openapi-versions.schema.json",
  "specsDir": "specs",
  "outDir": "src/generated",
  "majors": { "1": { "floor": "1.3.0" } }
}
```

The floor must be a real spec file (`specs/1.3.0.json`). See [reference](reference.md#config).

## 3. Generate

```bash
npx openapi-versions   # or an npm script
```

You get `src/generated/v1/{schema.d.ts, meta.ts, merged.openapi.json}` and `src/generated/index.ts`. Do not edit them. Commit them or regenerate in CI, as you prefer, but be consistent.

## 4. Import from the generated client

Codegen writes `<outDir>/v<major>/client.ts`: the runtime already bound to this major's types. The import path is the only place the major appears in app code:

```ts
import { ApiVersionProvider, useApi, Feature, createApi, type Paths } from "./api/v1/client";
```

`runtimeImport` in the config sets what `client.ts` imports the runtime from (default `openapi-versions`).

## 5. Use it in React

```tsx
<QueryClientProvider client={queryClient}>
  <ApiVersionProvider baseUrl="https://host/api/v1">
    <App />
  </ApiVersionProvider>
</QueryClientProvider>;
```

```tsx
const { $api, $gated, gate } = useApi();

// available on every supported backend: plain openapi-react-query
const user = $api.useQuery("get", "/users/{id}", { params: { path: { id } } });

// added after the floor: gate() turns it into skipToken when the backend lacks it
const activity = useQuery(gate($gated.queryOptions("get", "/users/{id}/activity", { params: { path: { id } } })));

// gated mutation: render the trigger inside <Feature>
const archive = $gated.useMutation("post", "/users/{id}/archive");
<Feature requires="post /users/{id}/archive">
  <button onClick={() => archive.mutate({ params: { path: { id } } })}>Archive</button>
</Feature>;
```

## 6. Try it without a backend

`playground/api/mock-backend.ts` is a fetch-compatible fake backend at any version. `pnpm playground` starts a small app with a control panel that "deploys" versions while the app is open. `pnpm playground:api` prints a table of one build against seven backends.

## 7. Wire CI

See [how-to: CI](how-to.md#wire-ci).
