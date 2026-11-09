---
"openapi-versions": patch
---

Codegen: a field that an older supported minor declares nullable (`nullable: true`, `"null"` in `type`, or a nullable reference such as `anyOf: [{$ref}, {type: "null"}]`) stays nullable in the merged types when a newer minor drops it. oasdiff does not flag that change for responses, and a backend still on the older minor can send `null`. The merge also no longer drops a schema property named `required`.
