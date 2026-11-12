---
"openapi-versions": minor
---

Add `openapi-versions/typesafe` and `openapi-versions/typesafe/core`: the same runtime built against the openapi-typesafe stack (`openapi-typesafe-fetch`, `openapi-typesafe-react-query`). With `"generator": "openapi-typesafe"`, the generated `client.ts` imports `openapi-versions/typesafe` unless `runtimeImport` is set. All stack peer dependencies are now optional, and the runtime no longer imports `openapi-typescript-helpers`. Existing openapi-typescript setups change nothing.
