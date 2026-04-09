import { describe, it, expect } from "vitest";
import { buildCorrectionNudge, shouldGiveUp } from "./quality-gate-corrector.js";

describe("buildCorrectionNudge", () => {
  it("includes the file path in the nudge", () => {
    const nudge = buildCorrectionNudge("src/foo.ts", "⚠ Verification failed — caught 1 stub(s): TODO on line 5");
    expect(nudge).toContain("src/foo.ts");
  });

  it("includes the summary in the nudge", () => {
    const summary = "⚠ Verification failed — caught 1 stub(s): TODO on line 5";
    const nudge = buildCorrectionNudge("src/foo.ts", summary);
    expect(nudge).toContain(summary);
  });

  it("includes ACTION REQUIRED directive", () => {
    const nudge = buildCorrectionNudge("src/foo.ts", "failed");
    expect(nudge).toContain("ACTION REQUIRED");
  });

  it("mentions TODO/FIXME fix instructions", () => {
    const nudge = buildCorrectionNudge("src/foo.ts", "failed");
    expect(nudge).toMatch(/TODO|FIXME/);
  });

  it("works with different file paths", () => {
    const nudge1 = buildCorrectionNudge("packages/core/src/index.ts", "stub detected");
    const nudge2 = buildCorrectionNudge("src/auth/login.py", "credential detected");
    expect(nudge1).toContain("packages/core/src/index.ts");
    expect(nudge2).toContain("src/auth/login.py");
  });

  it("returns a non-empty string", () => {
    const nudge = buildCorrectionNudge("src/x.ts", "failed");
    expect(typeof nudge).toBe("string");
    expect(nudge.length).toBeGreaterThan(50);
  });
});

describe("shouldGiveUp", () => {
  it("returns false for attempt 0 (first failure)", () => {
    expect(shouldGiveUp(0)).toBe(false);
  });

  it("returns false for attempt 1 (second failure)", () => {
    expect(shouldGiveUp(1)).toBe(false);
  });

  it("returns true for attempt 2 (give up)", () => {
    expect(shouldGiveUp(2)).toBe(true);
  });

  it("returns true for any attempt >= 2", () => {
    expect(shouldGiveUp(3)).toBe(true);
    expect(shouldGiveUp(10)).toBe(true);
    expect(shouldGiveUp(100)).toBe(true);
  });
});
