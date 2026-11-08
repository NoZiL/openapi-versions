---
"openapi-versions": patch
---

Codegen replaces each generated file atomically (temp file + rename) and leaves unchanged files untouched, so tsc, vitest or vite reading `outDir` during a regen never see a missing or half-written file. Every file is generated before any is written, so a generator error leaves the previous output whole. Codegen also removes the `<outDir>/v<n>` dirs it generated for majors no longer in the config.
