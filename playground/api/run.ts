/**
 * Framework-free walkthrough: one client build (specs 1.3.0–1.6.0, major 1)
 * against backends at different versions. Run: pnpm playground:api
 */

import { majors } from "../generated";
import { createApi } from "../generated/v1/client";
import { createMockBackend } from "./mock-backend";

const BACKENDS = ["1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0", "1.8.0", "2.0.0"];
const BASE = "http://api.test";

console.log(`Client built from specs: ${majors[1].specs.join(", ")}\n`);
const rows: string[][] = [["backend", "result", "archive", "activity", "user as the app sees it"]];

for (const v of BACKENDS) {
  const backend = createMockBackend(v);
  let api: Awaited<ReturnType<typeof createApi>> | undefined;
  try {
    api = await createApi({ baseUrl: BASE, fetch: backend.fetch });
  } catch (e) {
    rows.push([v, (e as Error).message.match(/: (\S+)/)?.[1] ?? "error", "-", "-", "-"]);
    continue;
  }
  const { compat, client } = api;
  const archive = compat.supports("post /users/{id}/archive");
  const activity = compat.supports("get /users/{id}/activity");
  const { data } = await client.core.GET("/users/{id}", { params: { path: { id: "2" } } });
  if (activity) await client.gated.GET("/users/{id}/activity", { params: { path: { id: "2" } } });
  const shown = `${data!.name} | ${data!.status} | avatar:${data!.avatarUrl ? "yes" : "no"}`;
  rows.push([v, compat.backendAhead ? "ok (backend ahead)" : "ok", archive ? "shown" : "hidden", activity ? "shown" : "hidden", shown]);
  const stray = backend.calls.filter((call) => call.includes("/activity") && !activity);
  if (stray.length) throw new Error(`called an unsupported op: ${stray}`);
}

const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const [i, r] of rows.entries()) {
  console.log(r.map((cell, j) => cell.padEnd(widths[j])).join("  "));
  if (i === 0) console.log(widths.map((w) => "-".repeat(w)).join("  "));
}
console.log("\nNo request was sent to an operation the connected backend lacks.");
