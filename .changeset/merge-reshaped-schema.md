---
"openapi-versions": patch
---

Codegen: a schema whose shape changes between supported minors (inline to `$ref`, a different `$ref` target, `allOf`/`anyOf`/`oneOf` to inline…) is merged as an `anyOf` of both shapes, so the types accept what a backend on any minor sends. This holds behind a null wrapper (`anyOf: [{$ref}, {type: "null"}]`, 3.0 `nullable` + `allOf`) and over any number of minors, and `anyOf`/`oneOf` members are now unioned across minors. The merge used to let the newest shape or member list win, dropping data only an older minor has (such as an enum value a newer `$ref` no longer lists), and mixed the keys of two shapes that had no `$ref`, which generators read as an intersection.
