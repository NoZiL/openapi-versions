---
"openapi-versions": patch
---

Codegen: a field that an older supported minor declares nullable (`nullable: true` in OpenAPI 3.0, `"null"` in `type` in 3.1) stays nullable in the merged types when a newer minor drops it. oasdiff does not flag that change, and a backend still on the older minor can send `null`.
