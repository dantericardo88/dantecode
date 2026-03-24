import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEnforcer } from "./policy-enforcer.js";
import type { PolicyRule } from "./policy-enforcer.js";

describe("PolicyEnforcer — Built-in Rules", () => {
  let enforcer: PolicyEnforcer;

  beforeEach(() => {
    enforcer = new PolicyEnforcer();
  });

  it("denies rm -rf / commands", () => {
    const decision = enforcer.evaluate({
      resourceType: "command",
      resource: "rm -rf /",
      action: "exec",
    });
    expect(decision.effect).toBe("deny");
    expect(decision.matchedRules.length).toBeGreaterThan(0);
  });

  it("denies file writes to /etc", () => {
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/etc/passwd",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("denies file writes to /sys", () => {
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/sys/kernel/debug",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("denies file writes to /proc", () => {
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/proc/sys/net",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("allows reading from /etc", () => {
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/etc/passwd",
      action: "read",
    });
    expect(decision.effect).toBe("allow");
  });

  it("warns on large file patterns", () => {
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/tmp/image.iso",
      action: "write",
    });
    expect(decision.effect).toBe("warn");
  });

  it("audits agent spawning", () => {
    const decision = enforcer.evaluate({
      resourceType: "agent",
      resource: "sub-agent-1",
      action: "spawn",
    });
    expect(decision.effect).toBe("audit");
  });

  it("allows safe file operations", () => {
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/workspace/src/app.ts",
      action: "write",
    });
    expect(decision.effect).toBe("allow");
  });
});

describe("PolicyEnforcer — Custom Rules", () => {
  let enforcer: PolicyEnforcer;

  beforeEach(() => {
    enforcer = new PolicyEnforcer();
  });

  it("adds and evaluates custom rules", () => {
    const customRule: PolicyRule = {
      id: "custom-deny-secrets",
      name: "Deny access to secrets directory",
      description: "Blocks writes to .secrets directory",
      resourceType: "file",
      conditions: [
        { field: "action", operator: "equals", value: "write" },
        { field: "resource", operator: "contains", value: ".secrets" },
      ],
      effect: "deny",
      priority: 950,
      enabled: true,
    };

    enforcer.addRule(customRule);
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/workspace/.secrets/keys.json",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("throws on duplicate rule IDs", () => {
    const rule: PolicyRule = {
      id: "dup-test",
      name: "Test",
      description: "Test rule",
      resourceType: "file",
      conditions: [],
      effect: "allow",
      priority: 1,
      enabled: true,
    };
    enforcer.addRule(rule);
    expect(() => enforcer.addRule(rule)).toThrow("duplicate rule id");
  });

  it("removes rules by ID", () => {
    const rule: PolicyRule = {
      id: "remove-me",
      name: "Remove Me",
      description: "Will be removed",
      resourceType: "file",
      conditions: [],
      effect: "deny",
      priority: 1,
      enabled: true,
    };
    enforcer.addRule(rule);
    expect(enforcer.removeRule("remove-me")).toBe(true);
    expect(enforcer.getRule("remove-me")).toBeUndefined();
  });

  it("returns false when removing non-existent rule", () => {
    expect(enforcer.removeRule("ghost-rule")).toBe(false);
  });
});

describe("PolicyEnforcer — Condition Operators", () => {
  let enforcer: PolicyEnforcer;

  beforeEach(() => {
    enforcer = new PolicyEnforcer();
  });

  function addRuleWithCondition(
    field: string,
    operator: "equals" | "contains" | "startsWith" | "endsWith" | "matches" | "exists",
    value?: string,
  ): void {
    enforcer.addRule({
      id: `test-${operator}-${field}`,
      name: `Test ${operator}`,
      description: `Tests ${operator} on ${field}`,
      resourceType: "file",
      conditions: [{ field, operator, value }],
      effect: "deny",
      priority: 999,
      enabled: true,
    });
  }

  it("evaluates 'equals' operator", () => {
    addRuleWithCondition("action", "equals", "delete");
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/tmp/file",
      action: "delete",
    });
    expect(decision.effect).toBe("deny");
  });

  it("evaluates 'contains' operator", () => {
    addRuleWithCondition("resource", "contains", "node_modules");
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/workspace/node_modules/pkg/index.js",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("evaluates 'startsWith' operator", () => {
    addRuleWithCondition("resource", "startsWith", "/root");
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/root/.bashrc",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("evaluates 'endsWith' operator", () => {
    addRuleWithCondition("resource", "endsWith", ".env");
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/workspace/.env",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("evaluates 'matches' regex operator", () => {
    addRuleWithCondition("resource", "matches", "\\.pem$");
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/workspace/certs/server.pem",
      action: "write",
    });
    expect(decision.effect).toBe("deny");
  });

  it("evaluates 'exists' operator with metadata", () => {
    addRuleWithCondition("danger_flag", "exists");
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/tmp/file",
      action: "write",
      metadata: { danger_flag: "true" },
    });
    expect(decision.effect).toBe("deny");
  });

  it("'exists' fails when field is missing", () => {
    addRuleWithCondition("missing_field", "exists");
    const decision = enforcer.evaluate({
      resourceType: "file",
      resource: "/tmp/file",
      action: "write",
    });
    // The builtin rules may still match, but our specific rule should not
    expect(decision.matchedRules.every((r) => r.id !== "test-exists-missing_field")).toBe(true);
  });
});

describe("PolicyEnforcer — Policy Sets", () => {
  it("creates and applies policy sets", () => {
    const enforcer = new PolicyEnforcer();

    const rule: PolicyRule = {
      id: "set-rule-1",
      name: "Set Rule",
      description: "Rule from policy set",
      resourceType: "tool",
      conditions: [
        { field: "resource", operator: "equals", value: "dangerous-tool" },
      ],
      effect: "deny",
      priority: 800,
      enabled: true,
    };

    const set = enforcer.createPolicySet("security-hardening", [rule]);
    enforcer.applyPolicySet(set.id);

    const decision = enforcer.evaluate({
      resourceType: "tool",
      resource: "dangerous-tool",
      action: "exec",
    });
    expect(decision.effect).toBe("deny");
  });

  it("throws on unknown policy set ID", () => {
    const enforcer = new PolicyEnforcer();
    expect(() => enforcer.applyPolicySet("unknown-id")).toThrow("unknown policy set");
  });

  it("stopOnDeny halts evaluation at first deny", () => {
    const enforcer = new PolicyEnforcer({ stopOnDeny: true });

    enforcer.addRule({
      id: "first-deny",
      name: "First Deny",
      description: "First deny rule",
      resourceType: "command",
      conditions: [{ field: "resource", operator: "contains", value: "test" }],
      effect: "deny",
      priority: 100,
      enabled: true,
    });
    enforcer.addRule({
      id: "second-deny",
      name: "Second Deny",
      description: "Second deny rule",
      resourceType: "command",
      conditions: [{ field: "resource", operator: "contains", value: "test" }],
      effect: "deny",
      priority: 50,
      enabled: true,
    });

    const decision = enforcer.evaluate({
      resourceType: "command",
      resource: "test command",
      action: "exec",
    });
    // Should have stopped at the first deny (higher priority)
    expect(decision.matchedRules.filter((r) => r.id.startsWith("first") || r.id.startsWith("second"))).toHaveLength(1);
  });
});
