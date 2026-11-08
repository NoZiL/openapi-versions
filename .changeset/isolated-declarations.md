---
"openapi-versions": patch
---

Name the public return types: `createVersionAware` returns `VersionAware<P, G, F>` (`VersionAwareCore<P, G>` & `ReactBindings<P, G, F>`), `build` returns `MajorReport[]`, `computeSince` returns `SinceResult`, and `mergeAll` returns `Json` instead of `any`. `FeatureProps` is exported. Same shapes as before; `.d.ts` are now emitted by Oxc.
