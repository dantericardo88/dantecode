import { describe, expect, it } from "vitest";
import {
  evaluatePermission,
  evaluatePermissionDecision,
  ruleMatches,
  matchGlob,
  globToRegex,
} from "./permission-evaluator.js";
import type { PermissionCheck, PermissionConfig, PermissionRule } from "./types.js";
import { parseRule, parseRules } from "./rule-parser.js";

// ─── matchGlob ──────────────────────────────────────────────────────────────

describe("matchGlob", () => {
  it("matches universal wildcard *", () => {
    expect(matchGlob("*", "anything")).toBe(true);
    expect(matchGlob("*", "")).toBe(true);
  });

  it("matches universal wildcard **", () => {
    expect(matchGlob("**", "any/nested/path")).toBe(true);
  });

  it("matches exact strings", () => {
    expect(matchGlob("hello", "hello")).toBe(true);
    expect(matchGlob("hello", "world")).toBe(false);
  });

  it("matches case-insensitively", () => {
    expect(matchGlob("Hello", "hello")).toBe(true);
    expect(matchGlob("HELLO", "hello")).toBe(true);
  });

  it("matches wildcard at end", () => {
    expect(matchGlob("git *", "git push")).toBe(true);
    expect(matchGlob("git *", "git status")).toBe(true);
    expect(matchGlob("git *", "npm test")).toBe(false);
  });

  it("matches wildcard at start", () => {
    expect(matchGlob("*.ts", "index.ts")).toBe(true);
    expect(matchGlob("*.ts", "deep/nested/file.ts")).toBe(true);
    expect(matchGlob("*.ts", "file.js")).toBe(false);
  });

  it("matches wildcard in middle", () => {
    expect(matchGlob("src/*/index.ts", "src/core/index.ts")).toBe(true);
    expect(matchGlob("src/*/index.ts", "src/deeply/nested/index.ts")).toBe(true);
  });

  it("matches ** for deep paths", () => {
    expect(matchGlob("src/**/*.ts", "src/core/index.ts")).toBe(true);
    expect(matchGlob("src/**/*.ts", "src/a/b/c/deep.ts")).toBe(true);
    expect(matchGlob("src/**/*.ts", "lib/file.ts")).toBe(false);
  });

  it("matches ? for single character", () => {
    expect(matchGlob("file?.ts", "file1.ts")).toBe(true);
    expect(matchGlob("file?.ts", "fileA.ts")).toBe(true);
    expect(matchGlob("file?.ts", "file12.ts")).toBe(false);
  });

  it("escapes regex special characters", () => {
    expect(matchGlob("package.json", "package.json")).toBe(true);
    expect(matchGlob("file(1).txt", "file(1).txt")).toBe(true);
  });
});

describe("globToRegex", () => {
  it("converts ** to match everything", () => {
    const regex = globToRegex("src/**");
    expect(new RegExp(`^${regex}$`).test("src/a/b/c")).toBe(true);
  });

  it("handles escaped characters", () => {
    const regex = globToRegex("file\\*.txt");
    expect(new RegExp(`^${regex}$`).test("file*.txt")).toBe(true);
    expect(new RegExp(`^${regex}$`).test("fileXYZ.txt")).toBe(false);
  });

  it("handles ** followed by /", () => {
    const regex = globToRegex("**/test");
    const re = new RegExp(`^${regex}$`);
    expect(re.test("a/b/test")).toBe(true);
    expect(re.test("test")).toBe(true);
  });
});

// ─── ruleMatches ────────────────────────────────────────────────────────────

describe("ruleMatches", () => {
  const baseCheck: PermissionCheck = {
    toolName: "Bash",
    command: "npm test",
    mode: "review",
  };

  it("matches when tool name matches and no specifier", () => {
    const rule = parseRule("allow Bash");
    expect(ruleMatches(rule, baseCheck)).toBe(true);
  });

  it("does not match when tool name differs", () => {
    const rule = parseRule("allow Write");
    expect(ruleMatches(rule, baseCheck)).toBe(false);
  });

  it("matches command specifier against check.command", () => {
    const rule = parseRule("allow Bash npm *");
    expect(ruleMatches(rule, baseCheck)).toBe(true);
  });

  it("does not match command specifier when command is absent", () => {
    const rule = parseRule("allow Bash npm *");
    const check: PermissionCheck = { toolName: "Bash", mode: "review" };
    expect(ruleMatches(rule, check)).toBe(false);
  });

  it("matches path specifier against check.filePath", () => {
    const rule = parseRule("deny Write src/secret/*");
    const check: PermissionCheck = {
      toolName: "Write",
      filePath: "src/secret/keys.ts",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(true);
  });

  it("does not match path specifier when filePath is absent", () => {
    const rule = parseRule("deny Write src/secret/*");
    const check: PermissionCheck = { toolName: "Write", mode: "review" };
    expect(ruleMatches(rule, check)).toBe(false);
  });

  it("does not match path specifier when path does not match", () => {
    const rule = parseRule("deny Write src/secret/*");
    const check: PermissionCheck = {
      toolName: "Write",
      filePath: "src/public/readme.md",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(false);
  });

  it("matches skill specifier against check.skillName", () => {
    const rule = parseRule("allow Skill my-skill");
    const check: PermissionCheck = {
      toolName: "Skill",
      skillName: "my-skill",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(true);
  });

  it("does not match skill specifier against different skill", () => {
    const rule = parseRule("allow Skill my-skill");
    const check: PermissionCheck = {
      toolName: "Skill",
      skillName: "other-skill",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(false);
  });

  it("matches literal specifier against command", () => {
    const rule: PermissionRule = {
      raw: "ask GitPush *",
      decision: "ask",
      toolName: "GitPush",
      specifier: "*",
      specifierKind: "literal",
    };
    const check: PermissionCheck = {
      toolName: "GitPush",
      command: "git push origin main",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(true);
  });

  it("matches literal specifier against filePath when command is absent", () => {
    const rule: PermissionRule = {
      raw: "ask GitCommit *",
      decision: "ask",
      toolName: "GitCommit",
      specifier: "*",
      specifierKind: "literal",
    };
    const check: PermissionCheck = {
      toolName: "GitCommit",
      filePath: "src/index.ts",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(true);
  });

  it("does not match literal specifier when no fields available", () => {
    const rule: PermissionRule = {
      raw: "ask GitCommit something",
      decision: "ask",
      toolName: "GitCommit",
      specifier: "something",
      specifierKind: "literal",
    };
    const check: PermissionCheck = { toolName: "GitCommit", mode: "review" };
    expect(ruleMatches(rule, check)).toBe(false);
  });

  it("matches domain specifier against command for WebFetch-like tools", () => {
    const rule = parseRule("deny WebFetch *evil.com*");
    const check: PermissionCheck = {
      toolName: "WebFetch",
      command: "https://malware.evil.com/payload",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(true);
  });

  it("does not match domain specifier when domain differs", () => {
    const rule = parseRule("deny WebFetch *evil.com*");
    const check: PermissionCheck = {
      toolName: "WebFetch",
      command: "https://safe.example.com/page",
      mode: "review",
    };
    expect(ruleMatches(rule, check)).toBe(false);
  });
});

// ─── evaluatePermission ─────────────────────────────────────────────────────

describe("evaluatePermission", () => {
  it("returns default decision when no rules match", () => {
    const config: PermissionConfig = {
      rules: [],
      defaultDecision: "ask",
    };
    const check: PermissionCheck = {
      toolName: "Bash",
      command: "echo hello",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("ask");
    expect(result.matchedRules).toHaveLength(0);
    expect(result.decidingRule).toBeUndefined();
    expect(result.usedDefault).toBe(true);
  });

  it("returns allow when a single allow rule matches", () => {
    const config: PermissionConfig = {
      rules: parseRules(["allow Bash echo *"]),
      defaultDecision: "deny",
    };
    const check: PermissionCheck = {
      toolName: "Bash",
      command: "echo hello",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("allow");
    expect(result.matchedRules).toHaveLength(1);
    expect(result.usedDefault).toBe(false);
  });

  it("deny beats allow (priority: deny > allow)", () => {
    const config: PermissionConfig = {
      rules: parseRules(["allow Bash *", "deny Bash rm *"]),
      defaultDecision: "ask",
    };
    const check: PermissionCheck = {
      toolName: "Bash",
      command: "rm -rf /tmp/stuff",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("deny");
    expect(result.matchedRules).toHaveLength(2);
    expect(result.decidingRule?.decision).toBe("deny");
  });

  it("deny beats ask (priority: deny > ask)", () => {
    const config: PermissionConfig = {
      rules: parseRules(["ask Write src/*", "deny Write src/secret/*"]),
      defaultDecision: "allow",
    };
    const check: PermissionCheck = {
      toolName: "Write",
      filePath: "src/secret/keys.ts",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("deny");
  });

  it("ask beats allow (priority: ask > allow)", () => {
    const config: PermissionConfig = {
      rules: parseRules(["allow Write src/*", "ask Write src/core/*"]),
      defaultDecision: "deny",
    };
    const check: PermissionCheck = {
      toolName: "Write",
      filePath: "src/core/index.ts",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("ask");
  });

  it("only allow rule matches -> allow (not default)", () => {
    const config: PermissionConfig = {
      rules: parseRules(["allow Bash npm test"]),
      defaultDecision: "deny",
    };
    const check: PermissionCheck = {
      toolName: "Bash",
      command: "npm test",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("allow");
    expect(result.usedDefault).toBe(false);
  });

  it("non-matching rules fall through to default", () => {
    const config: PermissionConfig = {
      rules: parseRules(["allow Bash npm *"]),
      defaultDecision: "deny",
    };
    const check: PermissionCheck = {
      toolName: "Write",
      filePath: "src/index.ts",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("deny");
    expect(result.usedDefault).toBe(true);
  });

  it("tool-level deny rule blocks all invocations of that tool", () => {
    const config: PermissionConfig = {
      rules: parseRules(["deny SubAgent"]),
      defaultDecision: "allow",
    };
    const check: PermissionCheck = {
      toolName: "SubAgent",
      command: "anything",
      mode: "autoforge",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("deny");
  });

  it("returns decidingRule correctly", () => {
    const config: PermissionConfig = {
      rules: parseRules(["allow Bash echo *", "ask Bash git *"]),
      defaultDecision: "deny",
    };
    const check: PermissionCheck = {
      toolName: "Bash",
      command: "git push origin main",
      mode: "review",
    };
    const result = evaluatePermission(check, config);
    expect(result.decision).toBe("ask");
    expect(result.decidingRule?.raw).toBe("ask Bash git *");
    expect(result.matchedRules).toHaveLength(1);
  });

  it("handles multiple deny rules gracefully", () => {
    const config: PermissionConfig = {
      rules: parseRules(["deny Bash rm *", "deny Bash sudo *"]),
      defaultDecision: "allow",
    };
    // "sudo rm -rf /" matches "sudo *" but not "rm *" (rm is not at the start)
    const check1: PermissionCheck = {
      toolName: "Bash",
      command: "sudo rm -rf /",
      mode: "yolo",
    };
    const result1 = evaluatePermission(check1, config);
    expect(result1.decision).toBe("deny");
    expect(result1.matchedRules).toHaveLength(1);

    // Test with a command that matches both rules
    const config2: PermissionConfig = {
      rules: parseRules(["deny Bash *rm*", "deny Bash *sudo*"]),
      defaultDecision: "allow",
    };
    const check2: PermissionCheck = {
      toolName: "Bash",
      command: "sudo rm -rf /",
      mode: "yolo",
    };
    const result2 = evaluatePermission(check2, config2);
    expect(result2.decision).toBe("deny");
    expect(result2.matchedRules).toHaveLength(2);
  });

  it("uses defaultDecision 'allow' when configured", () => {
    const config: PermissionConfig = {
      rules: [],
      defaultDecision: "allow",
    };
    const check: PermissionCheck = {
      toolName: "Read",
      filePath: "anything.ts",
      mode: "yolo",
    };
    expect(evaluatePermission(check, config).decision).toBe("allow");
  });
});

// ─── evaluatePermissionDecision ─────────────────────────────────────────────

describe("evaluatePermissionDecision", () => {
  it("returns decision directly without metadata", () => {
    const config: PermissionConfig = {
      rules: parseRules(["deny Bash rm *"]),
      defaultDecision: "allow",
    };
    const check: PermissionCheck = {
      toolName: "Bash",
      command: "rm -rf /tmp",
      mode: "review",
    };
    expect(evaluatePermissionDecision(check, config)).toBe("deny");
  });

  it("returns default when no rules match", () => {
    const config: PermissionConfig = {
      rules: [],
      defaultDecision: "ask",
    };
    const check: PermissionCheck = {
      toolName: "Write",
      filePath: "index.ts",
      mode: "review",
    };
    expect(evaluatePermissionDecision(check, config)).toBe("ask");
  });

  it("returns highest priority across multiple matches", () => {
    const config: PermissionConfig = {
      rules: parseRules(["allow Bash *", "ask Bash git *", "deny Bash git push *"]),
      defaultDecision: "allow",
    };
    const check: PermissionCheck = {
      toolName: "Bash",
      command: "git push --force",
      mode: "review",
    };
    expect(evaluatePermissionDecision(check, config)).toBe("deny");
  });
});
