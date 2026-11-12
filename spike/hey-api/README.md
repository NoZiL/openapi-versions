# Spike #124: Hey API (`@hey-api/openapi-ts`)

Review branch only, not for merging. The decision is in ADR 0027.

```sh
pnpm codegen                              # merged specs + meta.ts, as today
pnpm exec tsx spike/hey-api/gen.ts        # Hey API on each merged spec, then the core/gated split
pnpm exec tsc --noEmit                    # includes spike/hey-api/types.check.ts
pnpm exec vitest run spike                # spike/hey-api/runtime.test.tsx
```

| File | What it shows |
| --- | --- |
| `gen.ts` | Hey API run on `merged.openapi.json` into `v1/sdk/`, op ID map and per-op export names read from Hey API's symbol registry, then `meta.ts` (+ `opIds`), `core.ts`, `gated.ts`, `client.ts` |
| `open-enums.ts` | `x-extensible-enum` as `"a" \| "b" \| (string & {})` through `$resolvers.string` and `$resolvers.union` |
| `runtime.tsx` | Provider, `useApi().gate`, `useSupports`, `<Feature>`, `createApi` for Hey API output; X-Api-Version and Sunset via a response interceptor |
| `types.check.ts` | The `test/types.check.ts` guarantees, on Hey API output |
| `runtime.test.tsx` | The `test/react.test.tsx` scenarios, on Hey API output |
| `out/` | Committed generated output (playground, test fixtures, enum-shape fixtures) |

How a component calls each kind of operation:

```tsx
import { $api, $gated, Feature, useApi } from "./generated/v1/client";

const { gate } = useApi();
const user = useQuery($api.getUserOptions({ path: { id } }));                         // floor op
const activity = useQuery(gate($gated.getUserActivityOptions({ path: { id } })));     // gated query
const archive = useMutation($gated.archiveUserMutation());                             // gated mutation...
<Feature requires="post /users/{id}/archive">                                         // ...rendered inside <Feature>
  <button onClick={() => archive.mutate({ path: { id } })}>Archive</button>
</Feature>
```
