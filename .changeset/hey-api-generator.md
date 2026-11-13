---
"openapi-versions": minor
---

Codegen: `generator: "hey-api"` runs `@hey-api/openapi-ts` (0.99.x, experimental, ADR 0027) on each major's merged spec. Its output goes in `v<n>/sdk/`. Extensible enums stay open unions. `meta.ts` gains `opIds` (Hey API operation id → op key). `core.ts` and `gated.ts` split the operation functions into floor operations and operations added after the floor. Hey API is tried last in auto-detection. `loadGenerator()` now returns a `kind` (`"schema"` or `"sdk"`). The runtime entry `openapi-versions/hey-api` that the generated `client.ts` imports ships separately (#126).
