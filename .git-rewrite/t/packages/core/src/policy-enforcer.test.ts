// ============================================================================
// @dantecode/core — PolicyEnforcer unit tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { PolicyEnforcer, type PolicyRule, type PolicyRequest } from "./policy-enforcer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid PolicyRule for test use. */
function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: "test-rule-1",
    name: "Test Rule",
    description: "A test rule.",
    resourceType: "file",
    conditions: [],
    effect: "allow",
    priority: 100,
    enabled: true,
    ...overrides,
  };
}

/** Build a minimal valid PolicyRequest. */
function makeRequest(overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    resourceType: "file",
    resource: "/home/user/project/main.ts",
    action: "read",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Constructor with defaults
// ---------------------------------------------------------------------------
describe("PolicyEnforcer", () => {
  it("constructor initialises with built-in rules and default options", () => {
    const enforcer = new PolicyEnforcer();
    const rules = enforcer.getRules();
    // Should contain the built-in rules out of the box.
    expect(rules.length).toBeGreaterThan(0);
    const builtinIds = rules.map((r) => r.id);
    expect(builtinIds).toContain("builtin-deny-rm-rf-root");
    expect(builtinIds).toContain("builtin-audit-agent-spawn");
  });

  // -------------------------------------------------------------------------
  // 2. evaluate() returns allow when no rules match
  // -------------------------------------------------------------------------
  it("evaluate() returns allow when no rules match", () => {
    // Use an engine with no rules so nothing can match.
    const enforcer = new PolicyEnforcer({ defaultEffect: "allow" });
    // Remove all built-in rules so we have a clean slate.
    for (const r of enforcer.getRules()) enforcer.removeRule(r.id);

    const decision = enforcer.evaluate(makeRequest());
    expect(decision.effect).toBe("allow");
    expect(decision.matchedRules).toHaveLength(0);
    expect(decision.reasons).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 3. evaluate() returns deny for a matching deny rule
  // -------------------------------------------------------------------------
  it("evaluate() returns deny when a deny rule matches", () => {
    const enforcer = new PolicyEnforcer();
    // Remove built-ins to isolate.
    for (const r of enforcer.getRules()) enforcer.removeRule(r.id);

    enforcer.addRule(
      makeRule({
        id: "deny-writes",
        effect: "deny",
        resourceType: "file",
        conditions: [{ field: "action", operator: "equals", value: "write" }],
      }),
    );

    const decision = enforcer.evaluate(makeRequest({ action: "write" }));
    expect(decision.effect).toBe("deny");
    expect(decision.matchedRules).toHaveLength(1);
    expect(decision.matchedRules[0]!.id).toBe("deny-writes");
  });

  // -------------------------------------------------------------------------
  // 4. evaluate() returns warn for a warn rule
  // -------------------------------------------------------------------------
  it("evaluate() returns warn when a warn rule matches", () => {
    const enforcer = new PolicyEnforcer();
    for (const r of enforcer.getRules()) enforcer.removeRule(r.id);

    enforcer.addRule(
      makeRule({
        id: "warn-read",
        effect: "warn",
        resourceType: "file",
        conditions: [{ field: "action", operator: "equals", value: "read" }],
      }),
    );

    const decision = enforcer.evaluate(makeRequest({ action: "read" }));
    expect(decision.effect).toBe("warn");
  });

  // -------------------------------------------------------------------------
  // 5. evaluate() priority: deny overrides warn
  // -------------------------------------------------------------------------
  it("evaluate() deny overrides warn regardless of rule order", () => {
    const enforcer = new PolicyEnforcer({ stopOnDeny: false });
    for (const r of enforcer.getRules()) enforcer.removeRule(r.id);

    // Add warn at higher numeric priority, deny at lower — deny must still win.
    enforcer.addRule(
      makeRule({
        id: "warn-rule",
        effect: "warn",
        priority: 200,
        conditions: [{ field: "action", operator: "equals", value: "write" }],
      }),
    );
    enforcer.addRule(
      makeRule({
        id: "deny-rule",
        effect: "deny",
        priority: 100,
        conditions: [{ field: "action", operator: "equals", value: "write" }],
      }),
    );

    const decision = enforcer.evaluate(makeRequest({ action: "write" }));
    expect(decision.effect).toBe("deny");
    expect(decision.matchedRules).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // 6. evaluate() stopOnDeny stops after first deny
  // -------------------------------------------------------------------------
  it("evaluate() stopOnDeny halts after first deny and skips subsequent rules", () => {
    const enforcer = new PolicyEnforcer({ stopOnDeny: true });
    for (const r of enforcer.getRules()) enforcer.removeRule(r.id);

    enforcer.addRule(
      makeRule({
        id: "deny-high",
        effect: "deny",
        priority: 300,
        resourceType: "command",
        conditions: [{ field: "action", operator: "equals", value: "exec" }],
      }),
    );
    enforcer.addRule(
      makeRule({
        id: "audit-low",
        effect: "audit",
        priority: 100,
        resourceType: "command",
        conditions: [{ field: "action", operator: "equals", value: "exec" }],
      }),
    );

    const decision = enforcer.evaluate(
      makeRequest({ resourceType: "command", action: "exec", resource: "ls" }),
    );
    // Only the first (highest priority) deny rule should be collected.
    expect(decision.matchedRules).toHaveLength(1);
    expect(decision.matchedRules[0]!.id).toBe("deny-high");
    expect(decision.effect).toBe("deny");
  });

  // -------------------------------------------------------------------------
  // 7. addRule() adds rule
  // -------------------------------------------------------------------------
  it("addRule() appends a new rule to the engine", () => {
    const enforcer = new PolicyEnforcer();
    const before = enforcer.getRules().length;

    enforcer.addRule(makeRule({ id: "custom-rule-add" }));

    expect(enforcer.getRules().length).toBe(before + 1);
    expect(enforcer.getRule("custom-rule-add")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 8. addRule() throws on duplicate ID
  // -------------------------------------------------------------------------
  it("addRule() throws when a rule with the same id already exists", () => {
    const enforcer = new PolicyEnforcer();
    enforcer.addRule(makeRule({ id: "dup-id" }));

    expect(() => enforcer.addRule(makeRule({ id: "dup-id" }))).toThrow(/duplicate rule id/i);
  });

  // -------------------------------------------------------------------------
  // 9. removeRule() removes rule and returns true
  // -------------------------------------------------------------------------
  it("removeRule() removes an existing rule and returns true", () => {
    const enforcer = new PolicyEnforcer();
    enforcer.addRule(makeRule({ id: "remove-me" }));

    const result = enforcer.removeRule("remove-me");

    expect(result).toBe(true);
    expect(enforcer.getRule("remove-me")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 10. removeRule() returns false for unknown id
  // -------------------------------------------------------------------------
  it("removeRule() returns false when the rule id is not found", () => {
    const enforcer = new PolicyEnforcer();
    expect(enforcer.removeRule("does-not-exist")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 11. enableRule() / disableRule() toggle
  // -------------------------------------------------------------------------
  it("enableRule() and disableRule() toggle the enabled flag", () => {
    const enforcer = new PolicyEnforcer();
    enforcer.addRule(makeRule({ id: "toggle-me", enabled: true }));

    const disabledResult = enforcer.disableRule("toggle-me");
    expect(disabledResult).toBe(true);
    expect(enforcer.getRule("toggle-me")!.enabled).toBe(false);

    const enabledResult = enforcer.enableRule("toggle-me");
    expect(enabledResult).toBe(true);
    expect(enforcer.getRule("toggle-me")!.enabled).toBe(true);

    // Unknown ids return false.
    expect(enforcer.disableRule("ghost")).toBe(false);
    expect(enforcer.enableRule("ghost")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 12. getRules() returns all rules
  // -------------------------------------------------------------------------
  it("getRules() without filter returns every registered rule", () => {
    const enforcer = new PolicyEnforcer();
    for (const r of enforcer.getRules()) enforcer.removeRule(r.id);

    enforcer.addRule(makeRule({ id: "r1", resourceType: "file" }));
    enforcer.addRule(makeRule({ id: "r2", resourceType: "command" }));
    enforcer.addRule(makeRule({ id: "r3", resourceType: "network" }));

    const all = enforcer.getRules();
    expect(all).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // 13. getRules() filters by resourceType
  // -------------------------------------------------------------------------
  it("getRules() filters rules by resourceType", () => {
    const enforcer = new PolicyEnforcer();
    for (const r of enforcer.getRules()) enforcer.removeRule(r.id);

    enforcer.addRule(makeRule({ id: "file-rule", resourceType: "file" }));
    enforcer.addRule(makeRule({ id: "cmd-rule", resourceType: "command" }));

    const fileRules = enforcer.getRules("file");
    expect(fileRules).toHaveLength(1);
    expect(fileRules[0]!.id).toBe("file-rule");

    const cmdRules = enforcer.getRules("command");
    expect(cmdRules).toHaveLength(1);
    expect(cmdRules[0]!.id).toBe("cmd-rule");
  });

  // -------------------------------------------------------------------------
  // 14. evaluateCondition() — equals operator
  // -------------------------------------------------------------------------
  it("evaluateCondition() equals matches exact field value", () => {
    const enforcer = new PolicyEnforcer();
    const req = makeRequest({ action: "write", resource: "/tmp/foo.txt" });

    expect(
      enforcer.evaluateCondition({ field: "action", operator: "equals", value: "write" }, req),
    ).toBe(true);

    expect(
      enforcer.evaluateCondition({ field: "action", operator: "equals", value: "read" }, req),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 15. evaluateCondition() — contains operator
  // -------------------------------------------------------------------------
  it("evaluateCondition() contains checks for substring presence", () => {
    const enforcer = new PolicyEnforcer();
    const req = makeRequest({ resource: "/home/user/project/src/index.ts" });

    expect(
      enforcer.evaluateCondition(
        { field: "resource", operator: "contains", value: "project" },
        req,
      ),
    ).toBe(true);

    expect(
      enforcer.evaluateCondition({ field: "resource", operator: "contains", value: "etc" }, req),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 16. evaluateCondition() — matches (regex) operator
  // -------------------------------------------------------------------------
  it("evaluateCondition() matches uses RegExp against the field value", () => {
    const enforcer = new PolicyEnforcer();
    const req = makeRequest({ resource: "/backups/dump-2025-01-15.tar.gz" });

    expect(
      enforcer.evaluateCondition(
        {
          field: "resource",
          operator: "matches",
          value: "\\.tar\\.gz$",
        },
        req,
      ),
    ).toBe(true);

    expect(
      enforcer.evaluateCondition({ field: "resource", operator: "matches", value: "\\.zip$" }, req),
    ).toBe(false);

    // Invalid regex should not throw — returns false.
    expect(
      enforcer.evaluateCondition(
        { field: "resource", operator: "matches", value: "[[invalid" },
        req,
      ),
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 17. createPolicySet() creates a set
  // -------------------------------------------------------------------------
  it("createPolicySet() creates and registers a named policy set", () => {
    const enforcer = new PolicyEnforcer();
    const rule = makeRule({ id: "set-rule-1", resourceType: "tool" });

    const set = enforcer.createPolicySet("Hardened Tool Policy", [rule]);

    expect(set.id).toBeTruthy();
    expect(set.name).toBe("Hardened Tool Policy");
    expect(set.rules).toHaveLength(1);
    expect(set.rules[0]!.id).toBe("set-rule-1");

    // Applying the set should add the rule to the engine.
    const countBefore = enforcer.getRules().length;
    enforcer.applyPolicySet(set.id);
    expect(enforcer.getRules().length).toBe(countBefore + 1);
    expect(enforcer.getRule("set-rule-1")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // 18. reset() restores built-in rules only
  // -------------------------------------------------------------------------
  it("reset() discards custom rules and restores only built-in rules", () => {
    const enforcer = new PolicyEnforcer();
    const builtinCount = enforcer.getBuiltinRules().length;

    // Add a custom rule and a policy set.
    enforcer.addRule(makeRule({ id: "custom-before-reset" }));
    const set = enforcer.createPolicySet("Temp Set", [makeRule({ id: "set-before-reset" })]);
    enforcer.applyPolicySet(set.id);

    expect(enforcer.getRules().length).toBeGreaterThan(builtinCount);

    enforcer.reset();

    const afterReset = enforcer.getRules();
    expect(afterReset).toHaveLength(builtinCount);
    // Custom rule gone.
    expect(enforcer.getRule("custom-before-reset")).toBeUndefined();
    // Built-ins restored.
    expect(enforcer.getRule("builtin-audit-agent-spawn")).toBeDefined();

    // applyPolicySet using old set id should fail (policySets cleared).
    expect(() => enforcer.applyPolicySet(set.id)).toThrow(/unknown policy set/i);
  });

  it("enforces task boundary rules for observe-only and diagnose-only without mocks", () => {
    const enforcer = new PolicyEnforcer();
    const obsReq: PolicyRequest = {
      resourceType: "file",
      resource: "src/foo.ts",
      action: "write",
      metadata: { taskMode: "observe-only" },
    };
    let decision = enforcer.evaluate(obsReq);
    expect(decision.effect).toBe("deny");
    expect(decision.matchedRules.some((r) => r.id.includes("taskmode"))).toBe(true);
    expect(decision.reasons.some((r) => r.includes("taskMode") || r.includes("boundary"))).toBe(
      true,
    );

    const diagReq: PolicyRequest = {
      resourceType: "tool",
      resource: "Edit",
      action: "execute",
      metadata: { taskMode: "diagnose-only" },
    };
    decision = enforcer.evaluate(diagReq);
    expect(decision.effect).toBe("deny");
    expect(
      decision.matchedRules.some((r) => r.id.includes("taskmode-deny-mutation-diagnose")),
    ).toBe(true);

    const runReq: PolicyRequest = {
      resourceType: "file",
      resource: "src/foo.ts",
      action: "write",
      metadata: { taskMode: "run-only" },
    };
    decision = enforcer.evaluate(runReq);
    expect(decision.effect).toBe("deny");

    const noEditReq: PolicyRequest = {
      resourceType: "tool",
      resource: "Edit",
      action: "edit",
      metadata: { taskMode: "run-only" },
    };
    expect(enforcer.evaluate(noEditReq).effect).toBe("deny");

    const noBuildReq: PolicyRequest = {
      resourceType: "command",
      resource: "npm run build",
      action: "exec",
      metadata: { taskMode: "run-only" },
    };
    expect(enforcer.evaluate(noBuildReq).effect).toBe("deny");

    const noFallbackReq: PolicyRequest = {
      resourceType: "tool",
      resource: "fallback",
      action: "execute",
      metadata: { taskMode: "diagnose-only" },
    };
    expect(enforcer.evaluate(noFallbackReq).effect).toBe("deny");

    const noBranchReq: PolicyRequest = {
      resourceType: "command",
      resource: "git checkout -b newbranch",
      action: "exec",
      metadata: { permission: "none" },
    };
    expect(enforcer.evaluate(noBranchReq).effect).toBe("deny");

    const normalReq: PolicyRequest = {
      resourceType: "file",
      resource: "src/foo.ts",
      action: "write",
      metadata: {},
    };
    expect(enforcer.evaluate(normalReq).effect).toBe("allow");

    enforcer.setTaskMode("run-only");
    const setModeReq: PolicyRequest = {
      resourceType: "file",
      resource: "src/foo.ts",
      action: "write",
    };
    decision = enforcer.evaluate(setModeReq);
    expect(decision.effect).toBe("deny");
    expect(decision.matchedRules.some((r) => r.id.includes("taskmode"))).toBe(true);
    enforcer.setTaskMode(null);
  });
});
