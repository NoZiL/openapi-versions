# 0017. Support openapi-typescript and openapi-typesafe side by side

- Status: accepted
- Date: 2026-11-08
- Supersedes: [0012](0012-typescript-range-follows-openapi-typescript.md)
- Amends: [0005](0005-patch-openapi-typescript-helpers.md) (the patch applies only on the openapi-typescript path)

## Context

openapi-typescript, openapi-fetch and openapi-react-query stopped receiving updates on 2026-09-19, security fixes included ([openapi-ts/openapi-typescript#2874](https://github.com/openapi-ts/openapi-typescript/issues/2874)). The maintainer will not hand the project or the npm names to anyone else. That has three consequences for us:

- Our helpers patch (ADR 0005) waits on [#2766](https://github.com/openapi-ts/openapi-typescript/pull/2766), which will never merge. Consumers have to carry the patch in their own apps indefinitely.
- TypeScript 6 and 7 support (#52, #46) waits on an openapi-typescript release that will never ship. TS 7 also has no JS compiler API, which both openapi-typescript and our `codegen/open-enums.ts` use.
- openapi-typescript still gets about 16M npm downloads a week, so most of our potential users are on it and will stay there for a while.

[openapi-typesafe](https://github.com/openapi-typesafe/openapi-typesafe) is a fork with the full upstream history and a drop-in package for each one we use (`openapi-typesafe`, `-fetch`, `-react-query`, `-helpers`):

- Its generator does not use the TypeScript compiler API. The declarations type-check on TS 5.4 to 7 ([TS 7 notes](https://github.com/openapi-typesafe/openapi-typesafe/blob/main/docs/typescript-7.md)).
- Its helpers already treat primitives, including branded strings, as leaves of `Readable`/`Writable`. That is the #2766 fix, so it needs no patch.
- Its [compatibility report](https://github.com/openapi-typesafe/openapi-typesafe/blob/main/docs/compatibility.md) compares it with openapi-typescript 7.13 on 1,820 real-world schemas and 28 option sets: 0 unexpected differences.
- Releases are published from CI with npm provenance (SLSA) and trusted publishing. No package has install scripts.
- It is young (created 2026-11-02), at `1.0.0-rc.3`, has a single maintainer and has about 700 downloads a week.

Trial (branch `try/openapi-typesafe`, be705fb): after `openapi-typesafe-migrate --write` and with the patch entry removed, codegen, typecheck, all 41 tests and the oasdiff gate pass. `types.check.ts` check 4 (open enums keep their type) passes without the patch. Our TS-node `transform` works through the fork's bridge, with a deprecation warning, and that bridge is removed in its 2.0.

Options considered:

1. **Stay on openapi-typescript only.** No TS 6/7, a permanent consumer-side patch, and an unmaintained dependency.
2. **Replace it with openapi-typesafe.** That is a breaking change for every user, and it puts the whole project on a one-maintainer release candidate.
3. **Run our own fork.** It splits an already small effort, makes us the target for supply-chain attacks, and repeats work openapi-typesafe has already done (the TS 7 rewrite, the corpus checks).
4. **Support both, and let each app choose.** Chosen.

## Decision

openapi-versions supports both generator stacks. Each app picks one.

- **Codegen.** A `generator` config key (`"openapi-typescript"` or `"openapi-typesafe"`). When it is left out, we use the stack that is installed. If both are installed, we use openapi-typescript (#68).
  - openapi-typesafe path: `codegen/open-enums.ts` uses `irCallbacks` and returns type text.
  - openapi-typescript path: it keeps the `ts.factory` transform.
  - A parity test checks that both paths produce the same `schema.d.ts`, apart from the header line.
- **Runtime.** `src/` is built twice: `openapi-versions[/core]` against the openapi-typescript stack, and `openapi-versions/typesafe[/core]` against the openapi-typesafe stack. The generated `v<n>/client.ts` imports the matching entry. All stack peers are optional (#69).
- **TypeScript.** `typescript` is no longer one of our `dependencies`; it becomes an optional peer, `>=5.4 <8`. CI type-checks the generated types, `types.check.ts` and the playground on TS 5.4 and 5.9 for openapi-typescript, and on TS 5.4, 5.9, 6.0 and 7.0 for openapi-typesafe. The build tools stay on TS 5.9 (#70). This supersedes ADR 0012.
- **Patch.** ADR 0005 still applies, but only to openapi-typescript users. openapi-typesafe users need no patch.
- **Docs** (#71). openapi-typescript stays the documented default for now. A "Choosing a generator" page explains both paths:
  - openapi-typescript users must apply the helpers patch in their own app and stay on TS 5.
  - openapi-typesafe needs no patch and supports TS 5.4 to 7.
  - The page gives the reasons with links (#2874, #2766, the fork's compatibility report, provenance, governance).
- **Default switch** (#67). openapi-typesafe becomes the default in auto-detection, the playground, examples, getting-started and skills once openapi-ts officially recognizes it, meaning the openapi-typescript README or #2874 links to it as the successor.

## Consequences

- Existing users change nothing. TS 6/7 users and anyone who wants to drop the patch get a supported path. The change is additive, so it ships as a minor.
- We permanently maintain two transform forms, two runtime builds and a CI matrix of about 6 jobs. The parity test and the matrix are what keep the two paths in step.
- Our docs point users to openapi-typesafe with the reasons spelled out, which helps a young successor gain the recognition #67 waits for.
- Risk: openapi-typesafe could stall like its parent did. Users on it should pin exact versions and check provenance on upgrades. If it stalls, we drop that path in a minor (it is opt-in) and reconsider Hey API.
- Revisit when #67 triggers. At that point, decide whether to drop the openapi-typescript path, which would be a major. Revisit also if openapi-typesafe reaches 1.0 with a second maintainer, or goes quiet for three months.
- Not decided here: contributing upstream to openapi-typesafe, for example by offering our open-enum regression check.
