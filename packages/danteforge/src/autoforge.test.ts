import { describe, it, expect } from "vitest";
import { buildFailureContext, type AutoforgeContext } from "./autoforge.js";
import { formatLessonsForPrompt } from "./lessons.js";
import type { PDSEScore, GStackResult, Lesson } from "@dantecode/config-types";

describe("autoforge", () => {
  describe("buildFailureContext", () => {
    const baseContext: AutoforgeContext = {
      taskDescription: "Implement a user authentication module",
      filePath: "src/auth.ts",
      language: "typescript",
      framework: "express",
    };

    it("includes the original task description", () => {
      const prompt = buildFailureContext("code", null, [], [], baseContext);
      expect(prompt).toContain("Implement a user authentication module");
    });

    it("includes file path and language info", () => {
      const prompt = buildFailureContext("code", null, [], [], baseContext);
      expect(prompt).toContain("src/auth.ts");
      expect(prompt).toContain("typescript");
      expect(prompt).toContain("express");
    });

    it("includes PDSE score breakdown when provided", () => {
      const score: PDSEScore = {
        completeness: 60,
        correctness: 70,
        clarity: 0,
        consistency: 80,
        overall: 52,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "src/auth.ts",
            line: 10,
            message: "TODO marker found",
            pattern: "\\bTODO\\b",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };
      const prompt = buildFailureContext("code", score, [], [], baseContext);
      expect(prompt).toContain("Completeness");
      expect(prompt).toContain("60");
      expect(prompt).toContain("TODO marker found");
      expect(prompt).toContain("HARD violations");
    });

    it("includes GStack failure details", () => {
      const gstackResults: GStackResult[] = [
        {
          command: "tsc --noEmit",
          exitCode: 1,
          stdout: "",
          stderr: "error TS2322: Type 'string' is not assignable to type 'number'.",
          durationMs: 500,
          passed: false,
        },
      ];
      const prompt = buildFailureContext("code", null, gstackResults, [], baseContext);
      expect(prompt).toContain("tsc --noEmit");
      expect(prompt).toContain("TS2322");
    });

    it("truncates long stderr output", () => {
      const longStderr = "x".repeat(3000);
      const gstackResults: GStackResult[] = [
        {
          command: "test",
          exitCode: 1,
          stdout: "",
          stderr: longStderr,
          durationMs: 100,
          passed: false,
        },
      ];
      const prompt = buildFailureContext("code", null, gstackResults, [], baseContext);
      expect(prompt).toContain("truncated");
      expect(prompt.length).toBeLessThan(longStderr.length + 2000);
    });

    it("includes current code in the prompt", () => {
      const code = "export function auth() { return true; }";
      const prompt = buildFailureContext(code, null, [], [], baseContext);
      expect(prompt).toContain(code);
    });

    it("includes regeneration instructions", () => {
      const prompt = buildFailureContext("code", null, [], [], baseContext);
      expect(prompt).toContain("Fix ALL hard violations");
      expect(prompt).toContain("no stubs");
      expect(prompt).toContain("complete");
    });

    it("includes injected lessons when provided", () => {
      const lessons: Lesson[] = [
        {
          id: "l1",
          projectRoot: "/tmp",
          pattern: "Missing null check in auth function",
          correction: "Always validate input before processing",
          occurrences: 3,
          lastSeen: "2026-03-15",
          severity: "error",
          source: "autoforge",
        },
      ];
      const prompt = buildFailureContext("code", null, [], lessons, baseContext);
      expect(prompt).toContain("Missing null check");
      expect(prompt).toContain("Always validate input");
    });
  });

  describe("formatLessonsForPrompt", () => {
    it("returns empty string for no lessons", () => {
      expect(formatLessonsForPrompt([])).toBe("");
    });

    it("formats lessons with severity and occurrence count", () => {
      const lessons: Lesson[] = [
        {
          id: "l1",
          projectRoot: "/tmp",
          pattern: "Pattern A",
          correction: "Fix A",
          occurrences: 5,
          lastSeen: "2026-03-15",
          severity: "error",
          source: "autoforge",
        },
      ];
      const result = formatLessonsForPrompt(lessons);
      expect(result).toContain("ERROR");
      expect(result).toContain("5x");
      expect(result).toContain("Pattern A");
      expect(result).toContain("Fix A");
    });

    it("includes file pattern and language when set", () => {
      const lessons: Lesson[] = [
        {
          id: "l1",
          projectRoot: "/tmp",
          pattern: "Pattern B",
          correction: "Fix B",
          filePattern: "*.ts",
          language: "typescript",
          framework: "react",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "manual",
        },
      ];
      const result = formatLessonsForPrompt(lessons);
      expect(result).toContain("*.ts");
      expect(result).toContain("typescript");
      expect(result).toContain("react");
    });

    it("formats multiple lessons with numbering", () => {
      const lessons: Lesson[] = [
        {
          id: "l1",
          projectRoot: "/tmp",
          pattern: "First",
          correction: "Fix 1",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "autoforge",
        },
        {
          id: "l2",
          projectRoot: "/tmp",
          pattern: "Second",
          correction: "Fix 2",
          occurrences: 2,
          lastSeen: "2026-03-15",
          severity: "error",
          source: "gstack_failure",
        },
      ];
      const result = formatLessonsForPrompt(lessons);
      expect(result).toContain("Lesson 1");
      expect(result).toContain("Lesson 2");
      expect(result).toContain("2 relevant");
    });
  });
});
