#!/usr/bin/env node
/**
 * Usage: openapi-versions [--config openapi-versions.config.json] [--check-only] [--require-gate]
 *   --check-only    run only the oasdiff breaking-change gate, write nothing
 *   --require-gate  fail if oasdiff is missing instead of skipping the gate (use in CI)
 */
import { build } from "./build";
import { loadConfig } from "./config";

const args = process.argv.slice(2);
const configPath = args.includes("--config") ? args[args.indexOf("--config") + 1] : "openapi-versions.config.json";

try {
  await build(loadConfig(configPath), {
    checkOnly: args.includes("--check-only"),
    gate: args.includes("--require-gate") ? "required" : undefined,
  });
} catch (e) {
  console.error(`\n${(e as Error).message}`);
  process.exit(1);
}
