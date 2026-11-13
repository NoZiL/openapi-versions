---
"openapi-versions": minor
---

Add `openapi-versions/typesafe` and `openapi-versions/typesafe/core`: the same runtime built against the openapi-typesafe stack (`openapi-typesafe-fetch`, `openapi-typesafe-react-query`). With `"generator": "openapi-typesafe"`, the generated `client.ts` imports `openapi-versions/typesafe` unless `runtimeImport` is set. All stack peer dependencies are now optional, and the runtime no longer imports `openapi-typescript-helpers`. Existing openapi-typescript setups change nothing in config or code.

**npm users:** `openapi-fetch` (and `openapi-react-query` for the React hooks) are now optional peers, so npm no longer installs them for you. If your app does not list them, add them: `npm i openapi-fetch openapi-react-query`. openapi-typesafe users install `openapi-typesafe-fetch` and `openapi-typesafe-react-query` instead.

**Apps already generating with openapi-typesafe** (with `openapi-fetch` as the runtime): after re-running codegen, `client.ts` imports `openapi-versions/typesafe`. Install `openapi-typesafe-fetch` and `openapi-typesafe-react-query`, or keep the old runtime with `"runtimeImport": "openapi-versions"`.
