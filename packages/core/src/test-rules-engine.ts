/**
 * test-rules-engine.ts
 *
 * Static analysis rules for test files — catches common test anti-patterns
 * like missing error paths, too few assertions, and bare catch blocks.
 */

import { readFileSync } from "node:fs";

export interface TestRule {
  id: string;
  pattern: RegExp;
  message: string;
  severity: "warn" | "error";
  category: "coverage" | "async" | "error-handling" | "assertions" | "quality";
}

export interface RuleViolation {
  ruleId: string;
  message: string;
  severity: "warn" | "error";
  line?: number;
}

export class TestRulesEngine {
  private rules: TestRule[] = [];

  constructor() {
    this.rules = this.getBuiltinRules();
  }

  addRule(rule: TestRule): void {
    this.rules.push(rule);
  }

  checkFile(_filePath: string, content: string): RuleViolation[] {
    const violations: RuleViolation[] = [];
    const lines = content.split("\n");

    for (const rule of this.rules) {
      // Custom per-rule logic
      switch (rule.id) {
        case "async-no-error-path": {
          const hasAsync = /\basync\b/.test(content);
          const hasErrorPath = /\.rejects|\.toThrow/.test(content);
          if (hasAsync && !hasErrorPath) {
            violations.push({ ruleId: rule.id, message: rule.message, severity: rule.severity });
          }
          break;
        }

        case "too-few-assertions": {
          const hasDescribe = /\bdescribe\s*\(/.test(content);
          if (hasDescribe) {
            const expectCount = (content.match(/\bexpect\s*\(/g) ?? []).length;
            if (expectCount < 3) {
              violations.push({ ruleId: rule.id, message: rule.message, severity: rule.severity });
            }
          }
          break;
        }

        case "promise-all-no-settled": {
          if (/Promise\.all\s*\(/.test(content) && !/Promise\.allSettled\s*\(/.test(content)) {
            violations.push({ ruleId: rule.id, message: rule.message, severity: rule.severity });
          }
          break;
        }

        case "snapshot-no-description": {
          // Match .toMatchSnapshot() with no argument (empty parens or whitespace only)
          if (/\.toMatchSnapshot\s*\(\s*\)/.test(content)) {
            violations.push({ ruleId: rule.id, message: rule.message, severity: rule.severity });
          }
          break;
        }

        case "empty-catch-in-test": {
          // Find line numbers for bare catch
          lines.forEach((line, idx) => {
            if (/\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}/.test(line)) {
              violations.push({
                ruleId: rule.id,
                message: rule.message,
                severity: rule.severity,
                line: idx + 1,
              });
            }
          });
          break;
        }

        default: {
          // Generic pattern matching for custom rules
          lines.forEach((line, idx) => {
            if (rule.pattern.test(line)) {
              violations.push({
                ruleId: rule.id,
                message: rule.message,
                severity: rule.severity,
                line: idx + 1,
              });
            }
          });
          break;
        }
      }
    }

    return violations;
  }

  getBuiltinRules(): TestRule[] {
    return [
      {
        id: "async-no-error-path",
        pattern: /\basync\b/,
        message: "Missing error path test for async function",
        severity: "warn",
        category: "async",
      },
      {
        id: "too-few-assertions",
        pattern: /\bdescribe\s*\(/,
        message: "Test file has fewer than 3 assertions",
        severity: "warn",
        category: "assertions",
      },
      {
        id: "promise-all-no-settled",
        pattern: /Promise\.all\s*\(/,
        message: "Consider Promise.allSettled for resilient test setup",
        severity: "warn",
        category: "quality",
      },
      {
        id: "snapshot-no-description",
        pattern: /\.toMatchSnapshot\s*\(\s*\)/,
        message: "Snapshot test missing description",
        severity: "warn",
        category: "quality",
      },
      {
        id: "empty-catch-in-test",
        pattern: /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}/,
        message: "Bare catch in test hides failures",
        severity: "error",
        category: "error-handling",
      },
    ];
  }

  loadFromFile(rulesFile: string): void {
    const raw = readFileSync(rulesFile, "utf-8");
    const parsed = JSON.parse(raw) as TestRule[];
    if (Array.isArray(parsed)) {
      for (const rule of parsed) {
        // Rehydrate RegExp from string if needed
        const patternStr = (rule as unknown as { pattern: string | RegExp }).pattern;
        const pattern =
          patternStr instanceof RegExp
            ? patternStr
            : new RegExp(String(patternStr));
        this.rules.push({ ...rule, pattern });
      }
    }
  }
}

export const testRulesEngine = new TestRulesEngine();
