---
"openapi-versions": minor
---

New entry `openapi-versions/hey-api`, the runtime the Hey API `client.ts` imports (ADR 0027). It exposes the same `ApiVersionProvider`, `useApi`, `useSupports`, `useHasField`, `useSunset`, `<Feature>` and `createApi` as the openapi-fetch stacks. The generated `$api` / `$gated` modules hold the sdk functions and TanStack Query helpers, and `useApi().gate()` reads the operation from Hey API's query keys. The provider configures Hey API's generated client (its own `fetch` is kept when the provider gets none) and reads X-Api-Version and Sunset in one response interceptor, forwarded to every mounted provider. The entry imports neither openapi-fetch nor openapi-react-query.

The React layer is now shared by both stacks, through a small `Transport` per stack. `OkCompat` and `fetchBackendVersion` now live in dependency-free modules; the existing exports are unchanged.
