---
"openapi-versions": patch
---

Codegen: an extensible enum marked with OpenAPI 3.0 `nullable: true` now keeps `| null`, as `type: ["string", "null"]` already did, on both the openapi-typescript and the openapi-typesafe path.
