---
"openapi-versions": minor
---

Codegen can generate types with openapi-typesafe as well as openapi-typescript (ADR 0017). New config key `generator` (`"openapi-typescript"` or `"openapi-typesafe"`); when it is left out, the installed one is used, and openapi-typescript if both are. Both generators are now optional peer dependencies, and codegen fails with an install hint when neither is installed. New exports `loadGenerator` and `openEnumsIr`. `typescript` is loaded only on the openapi-typescript path.
