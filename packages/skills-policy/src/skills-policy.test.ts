// ============================================================================
// @dantecode/skills-policy — tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { mapAllowedToolsToPolicy, KNOWN_DANTE_TOOLS } from "./map-allowed-tools.js";
import { mapCompatibilityToPolicy } from "./map-compatibility.js";
import { runSkillPolicyCheck } from "./skill-policy-check.js";

// ─── mapAllowedToolsToPolicy ────────────────────────────────────────────────

describe("mapAllowedToolsToPolicy", () => {
  it("returns empty result for empty tools list", () => {
    const result = mapAllowedToolsToPolicy([]);
    expect(result.rules).toHaveLength(0);
    expect(result.unsupportedTools).toHaveLength(0);
  });

  it("marks known tools as supported", () => {
    const result = mapAllowedToolsToPolicy(["read", "write", "bash"]);
    expect(result.rules).toHaveLength(3);
    for (const rule of result.rules) {
      expect(rule.advisory).toBe(true);
      expect(rule.unsupported).toBe(false);
    }
    expect(result.unsupportedTools).toHaveLength(0);
  });

  it("marks all rules as advisory regardless of support status", () => {
    const result = mapAllowedToolsToPolicy(["Read", "some_unknown_tool"]);
    for (const rule of result.rules) {
      expect(rule.advisory).toBe(true);
    }
  });

  it("marks unknown tools as unsupported", () => {
    const result = mapAllowedToolsToPolicy(["execute_docker", "run_sql_query"]);
    expect(result.unsupportedTools).toEqual(["execute_docker", "run_sql_query"]);
    for (const rule of result.rules) {
      expect(rule.unsupported).toBe(true);
      expect(rule.advisory).toBe(true);
    }
  });

  it("handles mixed known and unknown tools", () => {
    const result = mapAllowedToolsToPolicy(["Read", "execute_docker", "Bash", "run_sql_query"]);
    expect(result.rules).toHaveLength(4);
    expect(result.unsupportedTools).toEqual(["execute_docker", "run_sql_query"]);

    const readRule = result.rules.find((r) => r.tool === "Read");
    expect(readRule?.unsupported).toBe(false);

    const dockerRule = result.rules.find((r) => r.tool === "execute_docker");
    expect(dockerRule?.unsupported).toBe(true);
  });

  it("includes WebSearch and TodoWrite in known tools", () => {
    expect(KNOWN_DANTE_TOOLS.has("WebSearch")).toBe(true);
    expect(KNOWN_DANTE_TOOLS.has("TodoWrite")).toBe(true);
  });

  it("includes lowercase variants in known tools", () => {
    expect(KNOWN_DANTE_TOOLS.has("read")).toBe(true);
    expect(KNOWN_DANTE_TOOLS.has("bash")).toBe(true);
    expect(KNOWN_DANTE_TOOLS.has("glob")).toBe(true);
  });

  it("preserves original tool name in rule", () => {
    const result = mapAllowedToolsToPolicy(["MyCustomTool"]);
    expect(result.rules[0]?.tool).toBe("MyCustomTool");
  });
});

// ─── mapCompatibilityToPolicy ────────────────────────────────────────────────

describe("mapCompatibilityToPolicy", () => {
  it("returns compatible + openCompat when list is undefined", () => {
    const result = mapCompatibilityToPolicy(undefined);
    expect(result.compatible).toBe(true);
    expect(result.openCompat).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.unknownAgents).toHaveLength(0);
  });

  it("returns compatible + openCompat when list is empty", () => {
    const result = mapCompatibilityToPolicy([]);
    expect(result.compatible).toBe(true);
    expect(result.openCompat).toBe(true);
  });

  it("returns compatible when claude is in list", () => {
    const result = mapCompatibilityToPolicy(["claude", "codex"]);
    expect(result.compatible).toBe(true);
    expect(result.openCompat).toBe(false);
  });

  it("returns incompatible when claude is NOT in list", () => {
    const result = mapCompatibilityToPolicy(["codex", "cursor"]);
    expect(result.compatible).toBe(false);
    expect(result.openCompat).toBe(false);
  });

  it("emits SKILL-005 warning for unknown agents", () => {
    const result = mapCompatibilityToPolicy(["claude", "my-custom-agent"]);
    expect(result.compatible).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("SKILL-005");
    expect(result.warnings[0]?.agent).toBe("my-custom-agent");
    expect(result.unknownAgents).toEqual(["my-custom-agent"]);
  });

  it("emits multiple SKILL-005 warnings for multiple unknowns", () => {
    const result = mapCompatibilityToPolicy(["claude", "agent-x", "agent-y"]);
    expect(result.warnings).toHaveLength(2);
    expect(result.unknownAgents).toEqual(["agent-x", "agent-y"]);
  });

  it("is case-insensitive for claude check", () => {
    const result = mapCompatibilityToPolicy(["Claude", "Codex"]);
    expect(result.compatible).toBe(true);
  });

  it("does not emit SKILL-005 for known agents", () => {
    const result = mapCompatibilityToPolicy(["claude", "codex", "cursor", "gemini"]);
    expect(result.warnings).toHaveLength(0);
    expect(result.unknownAgents).toHaveLength(0);
  });
});

// ─── runSkillPolicyCheck ─────────────────────────────────────────────────────

describe("runSkillPolicyCheck", () => {
  it("passes with no tools and no compat", () => {
    const result = runSkillPolicyCheck({});
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("passes with all known tools", () => {
    const result = runSkillPolicyCheck({
      allowedTools: ["Read", "Write", "Bash"],
      compatibility: ["claude"],
    });
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("emits SKILL-004 error for unsupported tool", () => {
    const result = runSkillPolicyCheck({
      allowedTools: ["Read", "execute_docker"],
      compatibility: ["claude"],
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("SKILL-004");
    expect(result.errors[0]?.tool).toBe("execute_docker");
  });

  it("emits multiple SKILL-004 errors for multiple unsupported tools", () => {
    const result = runSkillPolicyCheck({
      allowedTools: ["execute_docker", "run_sql", "send_email"],
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(3);
    for (const err of result.errors) {
      expect(err.code).toBe("SKILL-004");
    }
  });

  it("emits SKILL-005 warning for unknown compat agent (non-blocking)", () => {
    const result = runSkillPolicyCheck({
      allowedTools: ["Read"],
      compatibility: ["claude", "my-custom-agent"],
    });
    expect(result.passed).toBe(true); // warnings don't block
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("SKILL-005");
  });

  it("SKILL-004 blocks even if SKILL-005 would be advisory", () => {
    const result = runSkillPolicyCheck({
      allowedTools: ["execute_docker"],
      compatibility: ["claude", "unknown-agent"],
    });
    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("SKILL-004");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe("SKILL-005");
  });

  it("allowed-tools advisory: known tools do not trigger SKILL-004", () => {
    const result = runSkillPolicyCheck({
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch"],
    });
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes with open compat (no compatibility list)", () => {
    const result = runSkillPolicyCheck({ allowedTools: ["Read"] });
    expect(result.passed).toBe(true);
    expect(result.compatMapping.openCompat).toBe(true);
  });

  it("exposes toolsMapping and compatMapping on result", () => {
    const result = runSkillPolicyCheck({
      allowedTools: ["Read", "execute_docker"],
      compatibility: ["claude", "codex"],
    });
    expect(result.toolsMapping.unsupportedTools).toEqual(["execute_docker"]);
    expect(result.compatMapping.compatible).toBe(true);
  });
});
