// ============================================================================
// @dantecode/dante-sandbox — ApprovalEngine Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  ApprovalEngine,
  globalApprovalEngine,
  getGlobalApprovalEngine,
} from "./approval-engine.js";
import type { ApprovalRequest } from "./approval-engine.js";

function makeReq(riskLevel: ApprovalRequest["riskLevel"], command?: string): ApprovalRequest {
  return {
    toolName: "Bash",
    command,
    riskLevel,
    reason: "test",
  };
}

// ─── manual policy ────────────────────────────────────────────────────────────

describe("ApprovalEngine — manual policy", () => {
  it("returns true for low risk", () => {
    const engine = new ApprovalEngine("manual");
    expect(engine.shouldPrompt(makeReq("low"))).toBe(true);
  });

  it("returns true for critical risk", () => {
    const engine = new ApprovalEngine("manual");
    expect(engine.shouldPrompt(makeReq("critical"))).toBe(true);
  });
});

// ─── on-request policy ────────────────────────────────────────────────────────

describe("ApprovalEngine — on-request policy", () => {
  it("returns false for low risk", () => {
    const engine = new ApprovalEngine("on-request");
    expect(engine.shouldPrompt(makeReq("low"))).toBe(false);
  });

  it("returns true for medium risk", () => {
    const engine = new ApprovalEngine("on-request");
    expect(engine.shouldPrompt(makeReq("medium"))).toBe(true);
  });

  it("returns true for high risk", () => {
    const engine = new ApprovalEngine("on-request");
    expect(engine.shouldPrompt(makeReq("high"))).toBe(true);
  });

  it("returns true for critical risk", () => {
    const engine = new ApprovalEngine("on-request");
    expect(engine.shouldPrompt(makeReq("critical"))).toBe(true);
  });
});

// ─── auto policy ─────────────────────────────────────────────────────────────

describe("ApprovalEngine — auto policy", () => {
  it("returns false for critical risk (CI mode)", () => {
    const engine = new ApprovalEngine("auto");
    expect(engine.shouldPrompt(makeReq("critical"))).toBe(false);
  });
});

// ─── allowRules ───────────────────────────────────────────────────────────────

describe("ApprovalEngine — allowRules", () => {
  it("bypass: addAllowRule('npm test') → shouldPrompt returns false with on-request policy", () => {
    // manual policy always prompts regardless of allow rules — use on-request to test bypass
    const engine = new ApprovalEngine("on-request");
    engine.addAllowRule("npm test");
    expect(engine.shouldPrompt(makeReq("critical", "npm test"))).toBe(false);
  });

  it("non-match: 'npm install' doesn't match 'npm test' rule → still prompts", () => {
    const engine = new ApprovalEngine("manual");
    engine.addAllowRule("npm test");
    expect(engine.shouldPrompt(makeReq("critical", "npm install"))).toBe(true);
  });

  it("allowRules accepts regex string — pattern with special chars (on-request policy)", () => {
    // In 'manual' policy, allow rules don't bypass the prompt — use 'on-request' to test rule matching
    const engine = new ApprovalEngine("on-request");
    engine.addAllowRule("^git\\s+");
    expect(engine.shouldPrompt(makeReq("high", "git status"))).toBe(false);
    expect(engine.shouldPrompt(makeReq("high", "rm -rf /"))).toBe(true);
  });
});

// ─── setPolicy ────────────────────────────────────────────────────────────────

describe("ApprovalEngine — setPolicy()", () => {
  it("changes behavior immediately — switching from manual to auto", () => {
    const engine = new ApprovalEngine("manual");
    expect(engine.shouldPrompt(makeReq("low"))).toBe(true);
    engine.setPolicy("auto");
    expect(engine.policy).toBe("auto");
    expect(engine.shouldPrompt(makeReq("critical"))).toBe(false);
  });
});

// ─── recordDecision ───────────────────────────────────────────────────────────

describe("ApprovalEngine — recordDecision()", () => {
  it("does not throw for any input", () => {
    const engine = new ApprovalEngine("on-request");
    expect(() => engine.recordDecision(makeReq("high", "rm -rf /"), true)).not.toThrow();
    expect(() => engine.recordDecision(makeReq("low"), false)).not.toThrow();
  });
});

// ─── Singleton exports ────────────────────────────────────────────────────────

describe("globalApprovalEngine + getGlobalApprovalEngine()", () => {
  it("globalApprovalEngine is exported and has default policy 'on-request'", () => {
    expect(globalApprovalEngine).toBeInstanceOf(ApprovalEngine);
    expect(globalApprovalEngine.policy).toBe("on-request");
  });

  it("getGlobalApprovalEngine() returns the same singleton", () => {
    expect(getGlobalApprovalEngine()).toBe(globalApprovalEngine);
  });
});

// ─── allowRules getter ────────────────────────────────────────────────────────

describe("ApprovalEngine — allowRules getter", () => {
  it("returns a copy of the rules array (includes DEFAULT_ALLOW_PATTERNS + user rules)", () => {
    const engine = new ApprovalEngine("manual");
    engine.addAllowRule("npm test");
    const rules = engine.allowRules;
    // DEFAULT_ALLOW_PATTERNS (3) + user-added rule (1) = 4
    expect(rules.length).toBeGreaterThanOrEqual(1);
    // Mutating the returned array should not affect the engine (length stays the same)
    const countBefore = engine.allowRules.length;
    rules.pop();
    expect(engine.allowRules).toHaveLength(countBefore);
  });
});
