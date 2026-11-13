/** Programmatic API of the version-aware codegen. */

export { type BreakingResult, checkChain, checkPair, MIN_OASDIFF_VERSION, type OasdiffProbe, probeOasdiff } from "./breaking";
export { BreakingChangeError, build, type MajorReport } from "./build";
export { type Config, type GateMode, loadConfig, validateConfig } from "./config";
export { GENERATORS, type Generator, type GeneratorName, type HeyApiGenerator, loadGenerator, type SchemaGenerator } from "./generator";
export type { HeyApiOperation, HeyApiOutput } from "./hey-api";
export { mergeAll, mergeTolerant } from "./merge";
export { openEnums } from "./open-enums";
export { computeSince, type SinceResult, type VersionedDoc } from "./since";
