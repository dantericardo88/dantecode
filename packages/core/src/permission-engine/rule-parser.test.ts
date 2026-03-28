import { describe, expect, it } from "vitest";
import { parseRule, parseRules, inferSpecifierKind, serializeRule } from "./rule-parser.js";

describe("parseRule", () => {
  it("parses a basic allow rule with command specifier", () => {
    const rule = parseRule("allow Bash git *");
    expect(rule.decision).toBe("allow");
    expect(rule.toolName).toBe("Bash");
    expect(rule.specifier).toBe("git *");
    expect(rule.specifierKind).toBe("command");
    expect(rule.raw).toBe("allow Bash git *");
  });

  it("parses a deny rule with path specifier", () => {
    const rule = parseRule("deny Write src/sensitive/*");
    expect(rule.decision).toBe("deny");
    expect(rule.toolName).toBe("Write");
    expect(rule.specifier).toBe("src/sensitive/*");
    expect(rule.specifierKind).toBe("path");
  });

  it("parses an ask rule with literal specifier", () => {
    const rule = parseRule("ask GitPush *");
    expect(rule.decision).toBe("ask");
    expect(rule.toolName).toBe("GitPush");
    expect(rule.specifier).toBe("*");
    expect(rule.specifierKind).toBe("literal");
  });

  it("parses a tool-level rule with no specifier", () => {
    const rule = parseRule("deny SubAgent");
    expect(rule.decision).toBe("deny");
    expect(rule.toolName).toBe("SubAgent");
    expect(rule.specifier).toBeUndefined();
    expect(rule.specifierKind).toBe("literal");
  });

  it("parses case-insensitive decisions", () => {
    const rule1 = parseRule("ALLOW Bash echo hello");
    expect(rule1.decision).toBe("allow");

    const rule2 = parseRule("DENY Write /etc/*");
    expect(rule2.decision).toBe("deny");

    const rule3 = parseRule("Ask GitPush *");
    expect(rule3.decision).toBe("ask");
  });

  it("handles extra whitespace", () => {
    const rule = parseRule("  allow   Bash   npm test  ");
    expect(rule.decision).toBe("allow");
    expect(rule.toolName).toBe("Bash");
    expect(rule.specifier).toBe("npm test");
  });

  it("parses a skill specifier", () => {
    const rule = parseRule("allow Skill my-custom-skill");
    expect(rule.decision).toBe("allow");
    expect(rule.toolName).toBe("Skill");
    expect(rule.specifier).toBe("my-custom-skill");
    expect(rule.specifierKind).toBe("skill");
  });

  it("parses a domain specifier for WebFetch", () => {
    const rule = parseRule("deny WebFetch *.evil.com");
    expect(rule.decision).toBe("deny");
    expect(rule.toolName).toBe("WebFetch");
    expect(rule.specifier).toBe("*.evil.com");
    expect(rule.specifierKind).toBe("domain");
  });

  it("parses an Edit rule with path specifier", () => {
    const rule = parseRule("ask Edit packages/core/**");
    expect(rule.decision).toBe("ask");
    expect(rule.toolName).toBe("Edit");
    expect(rule.specifier).toBe("packages/core/**");
    expect(rule.specifierKind).toBe("path");
  });

  it("preserves multi-word command specifiers", () => {
    const rule = parseRule("deny Bash rm -rf /");
    expect(rule.specifier).toBe("rm -rf /");
    expect(rule.specifierKind).toBe("command");
  });

  it("throws on empty string", () => {
    expect(() => parseRule("")).toThrow("Permission rule cannot be empty");
    expect(() => parseRule("   ")).toThrow("Permission rule cannot be empty");
  });

  it("throws on missing tool name", () => {
    expect(() => parseRule("allow")).toThrow('Invalid permission rule "allow": expected format');
  });

  it("throws on invalid decision", () => {
    expect(() => parseRule("permit Bash echo")).toThrow('Invalid permission decision "permit"');
  });

  it("throws on missing tool name after decision", () => {
    expect(() => parseRule("allow  ")).toThrow("expected format");
  });
});

describe("parseRules", () => {
  it("parses multiple rule strings", () => {
    const rules = parseRules(["allow Bash git *", "deny Write src/secret/*", "ask GitPush *"]);
    expect(rules).toHaveLength(3);
    expect(rules[0]!.decision).toBe("allow");
    expect(rules[1]!.decision).toBe("deny");
    expect(rules[2]!.decision).toBe("ask");
  });

  it("skips empty lines", () => {
    const rules = parseRules(["allow Bash echo", "", "  ", "deny Write /etc/*"]);
    expect(rules).toHaveLength(2);
  });

  it("skips comment lines starting with #", () => {
    const rules = parseRules([
      "# This is a comment",
      "allow Bash echo hello",
      "  # Another comment",
      "deny Write /etc/*",
    ]);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.decision).toBe("allow");
    expect(rules[1]!.decision).toBe("deny");
  });

  it("returns empty array for empty input", () => {
    expect(parseRules([])).toEqual([]);
  });

  it("throws on first malformed rule", () => {
    expect(() => parseRules(["allow Bash echo", "invalid", "deny Write /etc/*"])).toThrow(
      "Invalid permission rule",
    );
  });
});

describe("inferSpecifierKind", () => {
  it("returns literal for no specifier", () => {
    expect(inferSpecifierKind("Bash", undefined)).toBe("literal");
  });

  it("returns command for Bash tool", () => {
    expect(inferSpecifierKind("Bash", "npm test")).toBe("command");
  });

  it("returns path for Write tool", () => {
    expect(inferSpecifierKind("Write", "src/*.ts")).toBe("path");
  });

  it("returns path for Edit tool", () => {
    expect(inferSpecifierKind("Edit", "src/index.ts")).toBe("path");
  });

  it("returns path for Read tool", () => {
    expect(inferSpecifierKind("Read", "*.json")).toBe("path");
  });

  it("returns domain for WebFetch tool", () => {
    expect(inferSpecifierKind("WebFetch", "example.com")).toBe("domain");
  });

  it("returns domain for WebSearch tool", () => {
    expect(inferSpecifierKind("WebSearch", "*.google.com")).toBe("domain");
  });

  it("returns skill for Skill tool", () => {
    expect(inferSpecifierKind("Skill", "my-skill")).toBe("skill");
  });

  it("returns literal for GitCommit tool", () => {
    expect(inferSpecifierKind("GitCommit", "*")).toBe("literal");
  });

  it("uses heuristics for unknown tools with path-like specifier", () => {
    expect(inferSpecifierKind("CustomTool", "src/foo/bar")).toBe("path");
  });

  it("uses heuristics for unknown tools with domain-like specifier", () => {
    expect(inferSpecifierKind("CustomTool", "example.com")).toBe("domain");
  });

  it("falls back to literal for unknown tools with plain specifier", () => {
    expect(inferSpecifierKind("CustomTool", "something")).toBe("literal");
  });
});

describe("serializeRule", () => {
  it("serializes a rule with specifier", () => {
    const rule = parseRule("allow Bash git *");
    expect(serializeRule(rule)).toBe("allow Bash git *");
  });

  it("serializes a rule without specifier", () => {
    const rule = parseRule("deny SubAgent");
    expect(serializeRule(rule)).toBe("deny SubAgent");
  });

  it("roundtrips a complex rule", () => {
    const original = "ask Edit packages/core/**";
    const rule = parseRule(original);
    expect(serializeRule(rule)).toBe(original);
  });
});
