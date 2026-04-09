import { describe, it, expect, beforeEach } from "vitest";
import { TestRulesEngine } from "./test-rules-engine.js";

describe("TestRulesEngine", () => {
  let engine: TestRulesEngine;

  beforeEach(() => {
    engine = new TestRulesEngine();
  });

  it("built-in rules count >= 5", () => {
    const rules = engine.getBuiltinRules();
    expect(rules.length).toBeGreaterThanOrEqual(5);
  });

  it("async function without error path → violation found", () => {
    const content = `
import { describe, it, expect } from "vitest";

describe("async tests", () => {
  it("fetches data", async () => {
    const result = await fetchData();
    expect(result).toBeTruthy();
    expect(result.id).toBe(1);
    expect(result.name).toBe("test");
  });
});
`;
    const violations = engine.checkFile("my.test.ts", content);
    const asyncViolation = violations.find((v) => v.ruleId === "async-no-error-path");
    expect(asyncViolation).toBeDefined();
    expect(asyncViolation?.severity).toBe("warn");
  });

  it("test with 3+ expect calls → no too-few violation", () => {
    const content = `
import { describe, it, expect } from "vitest";

describe("suite", () => {
  it("works", () => {
    expect(1).toBe(1);
    expect(2).toBe(2);
    expect(3).toBe(3);
  });
});
`;
    const violations = engine.checkFile("my.test.ts", content);
    const tooFewViolation = violations.find((v) => v.ruleId === "too-few-assertions");
    expect(tooFewViolation).toBeUndefined();
  });

  it("test with 1 expect call → too-few violation", () => {
    const content = `
import { describe, it, expect } from "vitest";

describe("suite", () => {
  it("minimal", () => {
    expect(true).toBe(true);
  });
});
`;
    const violations = engine.checkFile("my.test.ts", content);
    const tooFewViolation = violations.find((v) => v.ruleId === "too-few-assertions");
    expect(tooFewViolation).toBeDefined();
    expect(tooFewViolation?.severity).toBe("warn");
  });

  it(".catch(() => {}) in test → error severity violation", () => {
    const content = `
import { describe, it, expect } from "vitest";

describe("suite", () => {
  it("hides error", () => {
    expect(true).toBe(true);
    expect(false).toBe(false);
    expect(null).toBeNull();
    somePromise.catch(() => {});
  });
});
`;
    const violations = engine.checkFile("my.test.ts", content);
    const catchViolation = violations.find((v) => v.ruleId === "empty-catch-in-test");
    expect(catchViolation).toBeDefined();
    expect(catchViolation?.severity).toBe("error");
  });

  it("addRule: custom rule added and enforced", () => {
    engine.addRule({
      id: "no-console-log",
      pattern: /console\.log/,
      message: "No console.log in tests",
      severity: "warn",
      category: "quality",
    });
    const content = `
import { it, expect } from "vitest";
it("logs", () => {
  console.log("debug");
  expect(1).toBe(1);
  expect(2).toBe(2);
  expect(3).toBe(3);
});
`;
    const violations = engine.checkFile("my.test.ts", content);
    const customViolation = violations.find((v) => v.ruleId === "no-console-log");
    expect(customViolation).toBeDefined();
    expect(customViolation?.message).toBe("No console.log in tests");
  });

  it("clean test file → no violations", () => {
    const content = `
import { describe, it, expect } from "vitest";

describe("clean suite", () => {
  it("handles success", () => {
    expect(1 + 1).toBe(2);
    expect("hello").toBe("hello");
    expect([1, 2, 3]).toHaveLength(3);
  });

  it("handles errors", async () => {
    await expect(Promise.reject(new Error("fail"))).rejects.toThrow("fail");
  });
});
`;
    const violations = engine.checkFile("my.test.ts", content);
    expect(violations).toHaveLength(0);
  });

  it("loadFromFile: loads rules from JSON via temp file", async () => {
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const rules = [
      {
        id: "custom-loaded",
        pattern: "console\\.warn",
        message: "No console.warn",
        severity: "warn",
        category: "quality",
      },
    ];

    const tmpFile = join(tmpdir(), `test-rules-${Date.now()}.json`);
    writeFileSync(tmpFile, JSON.stringify(rules), "utf-8");

    try {
      const testEngine = new TestRulesEngine();
      testEngine.loadFromFile(tmpFile);

      // After loading, rules should contain the custom rule
      const content = `
describe("x", () => {
  it("t", () => {
    console.warn("oops");
    expect(1).toBe(1);
    expect(2).toBe(2);
    expect(3).toBe(3);
  });
});
`;
      const violations = testEngine.checkFile("x.test.ts", content);
      const custom = violations.find((v) => v.ruleId === "custom-loaded");
      expect(custom).toBeDefined();
      expect(custom?.message).toBe("No console.warn");
    } finally {
      unlinkSync(tmpFile);
    }
  });
});
