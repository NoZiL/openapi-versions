---
"openapi-versions": minor
---

Codegen can generate types with openapi-typesafe as well as openapi-typescript (ADR 0017). New config key `generator` (`"openapi-typescript"` or `"openapi-typesafe"`); when it is left out, the installed one is used, and openapi-typescript if both are. Codegen fails with an install hint when neither is installed. New exports `loadGenerator` and `GENERATORS`. `typescript` is loaded only on the openapi-typescript path, and `openEnums` no longer needs openapi-typescript's types.

Upgrading: openapi-typescript and openapi-typesafe are now optional peer dependencies, so npm no longer installs openapi-typescript for you. If your app relied on that, add it as a dev dependency (`npm i -D openapi-typescript`), as getting-started already says.
