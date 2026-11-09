---
"openapi-versions": patch
---

Codegen: a schema whose shape changes between supported minors (inline to `$ref`, a different `$ref` target, `allOf`/`anyOf`/`oneOf` to inline…) is merged as an `anyOf` of both shapes, so the types accept what a backend on any minor sends. The merge used to let the newest shape win, dropping data only the older minor has (such as an enum value a newer `$ref` no longer lists), and mixed the keys of two shapes that had no `$ref`, which generators read as an intersection.
