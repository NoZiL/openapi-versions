/** Programmatic API of the version-aware codegen. */

export { type BreakingResult, checkChain, checkPair, MIN_OASDIFF_VERSION, type OasdiffProbe, probeOasdiff } from "./breaking";
export { BreakingChangeError, build, type MajorReport } from "./build";
export { type Config, type GateMode, loadConfig, validateConfig } from "./config";
export { mergeAll, mergeTolerant } from "./merge";
export { openEnums } from "./open-enums";
export { computeSince, type SinceResult, type VersionedDoc } from "./since";
