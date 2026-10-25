import { describe, expect, it } from "vitest";
import { resolveCompat } from "../src/core/compat";
import { majors } from "./fixtures/generated";

const ok = (v: string, opts = {}) => {
  const c = resolveCompat(v, majors, opts);
  if (c.status !== "ok") throw new Error(`expected ok, got ${c.status}`);
  return c;
};

describe("compatibility matrix (client built with 1.3.0 – 1.6.0)", () => {
  it.each([
    ["1.3.0", false, false, false],
    ["1.4.2", false, false, false],
    ["1.5.0", true, false, false],
    ["1.6.0", true, true, false],
    ["1.9.1", true, true, true], // backend ahead of the client: forward compatible
  ])("backend %s: archive=%s activity=%s backendAhead=%s", (v, archive, activity, ahead) => {
    const c = ok(v);
    expect(c.supports("post /users/{id}/archive")).toBe(archive);
    expect(c.supports("get /users/{id}/activity")).toBe(activity);
    expect(c.backendAhead).toBe(ahead);
  });

  it("field gates", () => {
    expect(ok("1.3.0").hasField("User.avatarUrl")).toBe(false);
    expect(ok("1.4.0").hasField("User.avatarUrl")).toBe(true);
  });
  it("blocks backends below the floor", () => expect(resolveCompat("1.2.9", majors).status).toBe("backend-too-old"));
  it("blocks another major: it needs a new app release", () => expect(resolveCompat("2.0.0", majors).status).toBe("app-too-old"));
  it("rejects non-semver versions", () => {
    expect(resolveCompat("build-4812", majors).status).toBe("invalid-version");
    expect(resolveCompat("1.6", majors).status).toBe("invalid-version");
  });
  it("date-based versions parse as semver with a huge major: blocked, not misread", () => {
    expect(resolveCompat("2026.10.1", majors).status).toBe("app-too-old");
  });
  it("an unknown operation is never supported", () => expect(ok("1.6.0").supports("get /nope")).toBe(false));
  it("release candidates count as the previous minor unless configured", () => {
    expect(ok("1.6.0-rc.1").supports("get /users/{id}/activity")).toBe(false);
    expect(ok("1.6.0-rc.1", { prereleaseAsRelease: true }).supports("get /users/{id}/activity")).toBe(true);
  });
});
