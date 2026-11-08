---
"openapi-versions": patch
---

Codegen replaces each generated file atomically (temp file + rename) and leaves unchanged files untouched, so tsc, vitest or vite reading `outDir` during a regen never see a missing or half-written file. It also removes `<outDir>/v<n>` dirs of majors no longer in the config.
