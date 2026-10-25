# Fit with the openapi-ts ecosystem

`openapi-versions` is deliberately a thin layer on the openapi-ts packages. It adds one capability they do not have: **one client, a range of server versions**.

| openapi-ts piece             | Role here               | How it is used                                                                                                                                                                         |
| ---------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openapi-typescript`         | Generates `schema.d.ts` | Called through its Node API (`openapiTS`, `astToString`) on the _merged_ spec. The only extension point used is the documented `transform` hook (for `x-extensible-enum`). Not forked. |
| `openapi-fetch`              | The HTTP client         | One `createClient<paths>` instance, plus one middleware (`onResponse`) for `X-Api-Version` and `Sunset`.                                                                               |
| `openapi-react-query`        | Hooks                   | `createClient(fetchClient)` twice: `$api` (types without gated operations) and `$gated` (everything). Query keys are its own, so loaders and `prefetchQuery` work unchanged.           |
| `openapi-typescript-helpers` | Shared types            | `StripOps` uses `HttpMethod`. A one-line fix to `Readable<T>` is needed for open enums (below).                                                                                        |
| `swr-openapi`                | SWR hooks               | Not supported yet.                                                                                                                                                                     |

Conventions followed: peer dependencies on the user's `openapi-typescript` / `openapi-fetch` / `openapi-react-query` (no bundled copies), ESM, types for every entry point, `$`-prefixed query client as in the openapi-react-query docs, one generated `schema.d.ts` per major.

## Gaps this fills

| Tool                                | What is missing for multi-version clients                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| openapi-typescript                  | One spec in, one `paths` out. No merging of minors, no since-versions, closed enums           |
| openapi-fetch / openapi-react-query | Typed against one spec. No capability check at runtime                                        |
| Hey API `openapi-ts`                | Merges _different_ APIs, prefixing colliding paths; not a union of versions of the _same_ API |
| oasdiff                             | Detects breaks, produces no client                                                            |

## What could be upstreamed

1. **`Readable<T>` / `Writable<T>` primitives fix** in `openapi-typescript-helpers`. The local patch (`patches/`) makes both helpers return primitives as-is, so `string & {}` open unions survive. Without it, `openapi-fetch` response types lose the known values of open enums. Smallest, most valuable contribution; independent of this package.
2. **`x-extensible-enum` (or an option) as built-in open enums** in openapi-typescript, replacing the `transform` hook in `codegen/open-enums.ts`.
3. **Multi-spec input** (merge + since map) as a documented recipe or plugin in the openapi-typescript docs, with this package as the reference implementation.

## Naming and docs placement

- Package name: `openapi-versions` (unclaimed on npm when checked; reserve it before publishing).
- Fits next to `openapi-fetch` and `openapi-react-query` in the docs sidebar as "Versioning": the pages in `docs/` map to _Introduction_ (concepts), _Setup_ (getting-started), _Recipes_ (how-to), _API_ (reference). The openapi-ts docs are VitePress/Markdown, so these files port as they are.
- Before proposing it upstream, confirm with the maintainers whether they prefer it as a separate package (as here) or an openapi-typescript feature.

## Known constraints

- openapi-typescript 7 requires TypeScript 5 or 6: TypeScript 7 (native port, `latest` on npm) has no `ts.factory`. Upstream issue #2841; open PRs #2867 (bundle a compiler) and #2872 (no runtime compiler dependency).
- The package is not published yet; `pnpm build` then `npm pack` produces the tarball. A packed install in a fresh app was verified: codegen, generated `client.ts`, and a typecheck of the gating guarantees all pass.
