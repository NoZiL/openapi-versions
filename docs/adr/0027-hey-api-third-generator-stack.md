# 0027. Support Hey API as a third, opt-in generator stack

- Status: accepted
- Date: 2026-11-12
- Amends: [0017](0017-support-openapi-typescript-and-openapi-typesafe.md) (a third value for `generator`, a third runtime entry, a third CI job)

## Context

ADR 0017 named [Hey API](https://github.com/hey-api/hey-api) (`@hey-api/openapi-ts`) as the fallback if openapi-typesafe stalls. Hey API has about 7.3M npm downloads a week, so many apps that could use openapi-versions are on it already. #124 checked whether it fits and how much work it would be.

Merge, `since`, the oasdiff gate, `meta.ts`, compat, `/version`, `useSupports`, `useHasField` and `<Feature>` do not depend on the generator. Four parts do: open enums, the type-level split that hides newer operations, `gate()`, and the X-Api-Version / Sunset reader.

Trial (branch `try/hey-api`, `spike/hey-api/`): Hey API 0.99.0 runs on each `merged.openapi.json` with `@hey-api/client-fetch`, `@hey-api/typescript`, `@hey-api/sdk` and `@tanstack/react-query`. All four parts work. Copies of the guarantees in `test/types.check.ts` type-check on TS 5.4, 5.5, 6.0 and 7.0.2, and copies of the scenarios in `test/react.test.tsx` pass (6 tests). The existing suite still passes.

- **Open enums.** About 30 lines of `$resolvers` on `@hey-api/typescript`, built with Hey API's type DSL. `string` handles a plain extensible enum. `union` handles a nullable one, because Hey API splits `type: ["string", "null"]` and 3.0 `nullable: true` into a union whose string member loses the extension, while the parent schema keeps it. Hey API's printer adds the parentheses, so the problem in ADR 0019 does not occur. Every shape in `test/fixtures/enum-shapes*` matches the openapi-typescript output. No helpers patch is needed.
- **Operation names.** Hey API names operations itself: `get-a` becomes `getA`, an operation without `operationId` becomes `postB`, and `delete` becomes the SDK function `delete_` but the query key `delete`. Codegen cannot reproduce those rules safely, so it reads them back from Hey API. After `createClient()`, the IR gives each operation's id, method and path, and the symbol registry (`ctx.gen.symbols.query({ resource: "operation" })`) gives each per-operation export with its final name and file. Neither is a documented API.
- **Core / gated split.** Codegen writes `core.ts` (floor operations) and `gated.ts` (newer ones) as named re-exports of the SDK functions and TanStack helpers. `client.ts` exports them as the namespaces `$api` and `$gated`. `$api.archiveUserMutation()` is a type error. Types (`User`, `GetUserData`, ...) stay shared, because they call nothing.
- **`gate()`.** Hey API query keys are `[{ _id: "getUserActivity", path, query, ... }]`. `meta.ts` gets `opIds` (Hey API id → `"get /users/{id}/activity"`), and `gate()` looks up `queryKey[0]._id` there. It still returns `skipToken`, so `useSuspenseQuery` rejects it. `useSupports` and `<Feature>` keep taking op keys.
- **Headers.** Hey API generates one module-level client (`client.gen.ts`). The provider calls `setConfig({ baseUrl, fetch })` on it and adds a response interceptor for X-Api-Version and Sunset. One client per app matches the rule of one major per app release.

Costs and risks found:

- Hey API writes a `client/` folder and imports it as `./client`. Our `v<n>/client.ts` would shadow it, so its output goes into `v<n>/sdk/`.
- Hey API writes its files itself, so ADR 0021/0023 (stage everything in memory, replace atomically under the lock) needs generation into a temp folder first. Codegen then reads the files back into its write list.
- Generation uses the TypeScript compiler API, and 0.99.0 fails with `typescript@7` installed ([hey-api/hey-api#4235](https://github.com/hey-api/hey-api/issues/4235)). The `next` snapshot (2026-09-30) works with TS 7, and the spike passes unchanged on it. The generated code type-checks on 5.4 to 7.
- Release cadence: 0.x, so minors can break. The last stable release is 0.99.0 from 2026-06-22. The repo is active (last push 2026-11-08) and has one main maintainer. Codegen needs Node 22.18+.
- A closed enum with OpenAPI 3.0 `nullable: true` loses `| null` (openapi-typescript keeps it). That is Hey API's own reading and not an open-enum problem, but types differ from the other two stacks there.
- The calling style is different (`$api.getUserOptions({ path })` instead of `$api.useQuery("get", "/users/{id}", { params })`). Hey API is a stack for apps that already use Hey API. It is not a drop-in replacement for openapi-fetch apps.

Options considered:

1. **Not now.** Keep Hey API as the documented fallback. No new maintenance, but the large existing Hey API user base stays unserved.
2. **Replace a stack with Hey API.** That breaks every app on the replaced stack, because the calling style differs.
3. **Add it as a third stack, opt-in.** Chosen.

## Decision

openapi-versions supports Hey API as a third generator stack. An app opts in, and the stack is marked experimental until the revisit conditions below are met.

- **Codegen (#125).** `generator: "hey-api"`. In auto-detection it comes last, after openapi-typescript and openapi-typesafe, so an app with several installed keeps its current stack. Hey API output goes into `v<n>/sdk/`, generated in a temp folder and then staged with the rest of the generation (ADR 0021, 0023). Open enums use `$resolvers`. Codegen reads operation ids and export names from the Hey API IR and symbol registry. It fails with a clear error when an operation in `meta.ops` has no id or no export, so a Hey API change cannot silently ungate an operation. `meta.ts` gains `opIds`.
- **Runtime (#126).** A separate entry, `openapi-versions/hey-api`, whose only peer is `@tanstack/react-query`. Hey API's client is copied into the generated output, so the runtime imports nothing from Hey API. `createReactBindings` takes a small transport adapter (connect the client, read headers, build the `Api`) so the provider is not duplicated per stack. `client.ts` exports `$api`, `$gated` and the usual hooks. `useApi()` returns `{ compat, gate }`. ADR 0003 holds unchanged: newer operations are absent from `$api`, queries go through `$gated` + `gate()`, and mutations go inside `<Feature>`.
- **Versions.** The `@hey-api/openapi-ts` peer range covers only the tested 0.x minor (`>=0.99.0 <0.100.0`), and we widen it after testing each new minor. Docs say that TS 7 needs a Hey API release that fixes #4235 (or `@next`) for codegen.
- **CI.** One job type-checks the Hey API output and runs its tests on TS 5.5 and 7.0. Codegen runs on TS 5.9.
- **Docs (#127).** The "Choosing a generator" page compares the three stacks: maintenance, TS range, patch, calling style. The skills cover the `$gated.xxxOptions()` + `gate()` form.

## Consequences

- Hey API users can adopt openapi-versions without changing their calling style. The change is additive, so it ships as a minor.
- We maintain three generator paths, three runtime entries and one more CI job. The adapter in #126 keeps the React layer shared.
- We depend on two undocumented Hey API internals: the symbol registry and the IR operation shape. The loud codegen check and the tested peer range limit the damage when they change. Offer upstream a documented way to read operation ids and export names (#125).
- Estimate: #125 about 2 days, #126 about 2 to 3 days, #127 about 1 day.
- Revisit, and drop the experimental label, when Hey API ships a stable release that generates with TS 7. Revisit also if Hey API has made no stable release by 2026-12-22 (six months after 0.99.0), or if the internals above change in a way the check cannot catch. If it stalls, drop the path in a minor (it is opt-in).
