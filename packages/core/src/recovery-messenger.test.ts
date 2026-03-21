import { describe, it, expect } from "vitest";
import { RecoveryMessenger, recoveryMessenger } from "./recovery-messenger.js";

describe("RecoveryMessenger", () => {
  const messenger = new RecoveryMessenger({ colors: false });

  // 1. getRecovery returns structured object
  it("getRecovery() returns RecoveryMessage with correct scenario", () => {
    const msg = messenger.getRecovery("context_saturated");
    expect(msg.scenario).toBe("context_saturated");
    expect(msg.title).toBe("Context Window Full");
    expect(msg.steps.length).toBeGreaterThan(0);
  });

  // 2. all scenarios have steps
  it("every scenario has at least 1 recovery step", () => {
    const scenarios = [
      "context_saturated",
      "model_rate_limited",
      "pipeline_stalled",
      "partial_completion",
      "session_resume",
      "typecheck_failed",
      "test_failed",
      "tool_blocked",
      "model_confabulated",
      "round_budget_exhausted",
    ] as const;
    for (const s of scenarios) {
      const msg = messenger.getRecovery(s);
      expect(msg.steps.length).toBeGreaterThan(0);
      expect(msg.title.length).toBeGreaterThan(0);
    }
  });

  // 3. auto-recoverable flag
  it("context_saturated is auto-recoverable", () => {
    expect(messenger.getRecovery("context_saturated").autoRecoverable).toBe(true);
  });

  it("typecheck_failed is not auto-recoverable", () => {
    expect(messenger.getRecovery("typecheck_failed").autoRecoverable).toBe(false);
  });

  // 4. format() produces title + steps
  it("format() includes title and numbered steps", () => {
    const out = messenger.format("pipeline_stalled");
    expect(out).toContain("Pipeline Stalled");
    expect(out).toContain("1.");
    expect(out).toContain("2.");
  });

  // 5. format() includes quick fix
  it("format() includes quick fix when present", () => {
    const out = messenger.format("context_saturated");
    expect(out).toContain("/compact");
  });

  // 6. format() with colors=false has no ANSI
  it("format() with colors=false has no ANSI codes", () => {
    const out = messenger.format("model_rate_limited");
    expect(out).not.toContain("\x1b[");
  });

  // 7. format() with colors=true has ANSI
  it("format() with colors=true has ANSI codes", () => {
    const colorMessenger = new RecoveryMessenger({ colors: true });
    const out = colorMessenger.format("test_failed");
    expect(out).toContain("\x1b[");
  });

  // 8. detect — context saturation
  it("detect() identifies context saturation", () => {
    expect(messenger.detect("Context window is full")).toBe("context_saturated");
  });

  // 9. detect — rate limit
  it("detect() identifies rate limit from 429", () => {
    expect(messenger.detect("HTTP 429: rate_limit exceeded")).toBe("model_rate_limited");
  });

  // 10. detect — typecheck
  it("detect() identifies TypeScript errors", () => {
    expect(messenger.detect("TS2345: type error")).toBe("typecheck_failed");
  });

  // 11. detect — test failure
  it("detect() identifies test failures", () => {
    expect(messenger.detect("AssertionError: vitest failed")).toBe("test_failed");
  });

  // 12. detect — confabulation
  it("detect() identifies confabulation (0 files changed)", () => {
    expect(messenger.detect("0 files changed, nothing to commit")).toBe("model_confabulated");
  });

  // 13. detect — round budget
  it("detect() identifies round budget exhaustion", () => {
    expect(messenger.detect("round budget exhausted at 150 rounds")).toBe("round_budget_exhausted");
  });

  // 14. detect — tool blocked
  it("detect() identifies blocked destructive commands", () => {
    expect(messenger.detect("blocked: destructive git command detected")).toBe("tool_blocked");
  });

  // 15. detect — unknown returns null
  it("detect() returns null for unrecognized text", () => {
    expect(messenger.detect("something completely unrelated happened")).toBeNull();
  });

  // 16. detectAndFormat — returns formatted string for known error
  it("detectAndFormat() returns formatted string for known error", () => {
    const out = messenger.detectAndFormat("TS2304: Cannot find name 'foo'");
    expect(out).not.toBeNull();
    expect(out).toContain("TypeScript");
  });

  // 17. detectAndFormat — returns null for unknown
  it("detectAndFormat() returns null for unknown text", () => {
    expect(messenger.detectAndFormat("banana")).toBeNull();
  });

  // 18. singleton export
  it("recoveryMessenger is a RecoveryMessenger instance", () => {
    expect(recoveryMessenger).toBeInstanceOf(RecoveryMessenger);
  });

  // 19. partial_completion has quickFix
  it("partial_completion has a quickFix", () => {
    expect(messenger.getRecovery("partial_completion").quickFix).toBeTruthy();
  });

  // 20. tool_blocked has no quickFix (optional)
  it("tool_blocked quickFix is undefined (no slash command shortcut)", () => {
    expect(messenger.getRecovery("tool_blocked").quickFix).toBeUndefined();
  });
});
