# Concepts

## Why this exists

Web, mobile and backend ship on different clocks. The API releases every two weeks, the web app several times a day, and mobile builds stay installed for months. At any moment several client and API versions talk to each other. A client generated from one spec silently assumes the backend matches it. This tool makes the assumption explicit and safe.

## Vocabulary

| Term                        | Meaning                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Major**                   | The `1` in `1.6.0`. Breaking changes allowed. Served under its own prefix: `/api/v1`, `/api/v2`.                                |
| **Minor**                   | The `6` in `1.6.0`. Additive changes only.                                                                                      |
| **Spec**                    | One OpenAPI JSON document per released version, stored as `specs/<semver>.json`.                                                |
| **Floor**                   | The oldest minor of a major that the app still supports. Everything present at the floor is assumed on every supported backend. |
| **Newest spec**             | The highest spec in `specsDir`. It may be a release the backend has not deployed yet.                                           |
| **Gated operation / field** | Introduced after the floor. Available only when the connected backend reports a version at or above the one that introduced it. |
| **Backend ahead**           | The backend is newer than the newest spec. Works: unknown fields are ignored, unknown enum values are tolerated.                |

## The three rules

1. **Within a major, changes are additive.** New endpoints, new optional request fields, new response fields, new values of _extensible_ enums. Removing, renaming, retyping, or adding a required request field needs a new major.
2. **Each app release supports one major**, over a range of its minors (floor to newest spec). Moving to the next major is a new app release.
3. **Each major has its own prefix and its own `GET <prefix>/version`**, plus an `X-Api-Version` header on every response, as real semver. The app's base URL includes the major, so it never needs to know other majors exist.

## What the client does for each backend

| Connected backend                   | Behaviour                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Same major, older than newest spec  | Works. Operations added later are hidden or disabled.                                 |
| Same major, newer than newest spec  | Works. Everything known is on. Unknown fields ignored, unknown enum values tolerated. |
| Same major, below the floor         | Blocked: `backend-too-old`.                                                           |
| Same major, `Sunset` header present | Works. `useSunset()` returns the date for a banner.                                   |
| Another major                       | Blocked: `app-too-old`.                                                               |
| Version changes mid-session         | The next response's `X-Api-Version` triggers re-evaluation and a refetch.             |
| `/version` not valid semver         | Blocked: `invalid-version`.                                                           |

## How the pieces fit

```
specs/1.3.0.json … 1.6.0.json  +  openapi-versions.config.json
        │  codegen (build time, in CI)
        │   1. keep specs >= floor
        │   2. oasdiff breaking on each consecutive pair  → fail on any break
        │   3. tolerant merge into one document
        │   4. since maps: which version introduced each op / field
        │   5. openapi-typescript on the merged doc, extensible enums as open unions
        ▼
src/generated/v1/{schema.d.ts, meta.ts, merged.openapi.json}
        │  runtime
        ▼
resolveCompat(version) → supports(op) / hasField(field)   ← the single decision point
        │
        ├─ $api    typed WITHOUT gated operations (cannot call newer ops: compile error)
        └─ $gated  typed WITH everything; queries go through gate(), mutations inside <Feature>
```

No component compares version numbers. Everything asks `supports()`.

## Tolerant reader

Depend on what you need, ignore the rest. Concretely: merged types make fields added after the floor optional, extensible enums are open (`"a" | "b" | (string & {})`) so a `switch` needs a `default`, and unknown response fields are never an error.

## Trade-offs to accept

- It relies on backend discipline. The oasdiff gate belongs in the **backend** CI as well, otherwise a breaking change shipped in a minor makes the merged types describe a shape no server has.
- Fields added after the floor are typed optional, so the compiler no longer reminds you newer servers always send them. Use `hasField()` for explicit checks.
- Open enums are open in request bodies too: a typo in a sent value compiles.
