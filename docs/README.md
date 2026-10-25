# Version-aware API client: docs

A codegen extension for the [openapi-ts](https://openapi-ts.dev/) ecosystem ([openapi-typescript](https://openapi-ts.dev/), [openapi-fetch](https://openapi-ts.dev/openapi-fetch/), [openapi-react-query](https://openapi-ts.dev/openapi-react-query/)) that lets **one client build work against a range of minor versions of one API major**. It merges every supported minor spec into one tolerant contract, records which version introduced each operation and field, and exposes a small runtime that hides features the connected backend does not have yet.

| Read this                                | When                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| [concepts.md](concepts.md)               | You need the mental model: majors, minors, floor, gating, tolerant reading                   |
| [getting-started.md](getting-started.md) | First setup in an app                                                                        |
| [how-to.md](how-to.md)                   | A task: add a spec, gate a feature, raise a floor, add an enum, move to a new major, wire CI |
| [reference.md](reference.md)             | Exact config, CLI, programmatic API, merge rules, generated files, runtime API               |
| [ecosystem.md](ecosystem.md)             | How this fits next to openapi-ts, what to upstream                                           |
| [troubleshooting.md](troubleshooting.md) | An error message or surprising behaviour                                                     |
| [adr/](adr/README.md)                    | Why a design decision was made                                                               |

LLM agents: the same tasks are packaged as skills in [`../skills`](../skills) (`openapi-versions-setup`, `openapi-versions-add-spec`, `openapi-versions-gate-feature`) and summarised in [`../AGENTS.md`](../AGENTS.md).

## The idea in four lines

1. The backend only makes **additive** changes inside a major (checked by [oasdiff](https://github.com/oasdiff/oasdiff)). Breaking changes mean a new major under a new URL prefix.
2. Codegen merges the specs from the app's **floor** (oldest supported minor) up to the newest spec, even an unreleased one.
3. At runtime the app reads `GET <base>/version` and decides what is available. Operations newer than the backend are off, like feature flags.
4. Anything newer than the app (new fields, new enum values) is ignored or typed open, so old apps keep working on new backends.
