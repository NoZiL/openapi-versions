---
"openapi-versions": patch
---

Two codegen runs on the same `outDir` no longer mix their files: the write phase holds a short-lived lock file (`<outDir>/.openapi-versions.lock`), taken over automatically when left by a killed run. Every changed file is also staged before any is renamed, so a disk-full or permission error while writing leaves the previous output whole.
