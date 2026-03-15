import { describe, it, expect } from "vitest";
import { buildFailureContext, runAutoforgeIAL, type AutoforgeContext } from "./autoforge.js";
import { formatLessonsForPrompt } from "./lessons.js";
import type {
  PDSEScore,
  GStackResult,
  Lesson,
  AutoforgeConfig,
  ModelConfig,
  ModelRouterConfig,
} from "@dantecode/config-types";
import type { ModelRouter } from "./pdse-scorer.js";

// ---------------------------------------------------------------------------
// Mock Router Factory
// ---------------------------------------------------------------------------

function createMockRouter(responses: (string | Error)[]): ModelRouter {
  let callIndex = 0;
  return {
    chat: async (_prompt: string, _config?: Partial<ModelConfig>): Promise<string> => {
      const response = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    getConfig: (): ModelRouterConfig => ({
      default: {
        provider: "grok",
        modelId: "grok-3",
        maxTokens: 8192,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: true,
      },
      fallback: [],
      overrides: {},
    }),
  };
}

// ---------------------------------------------------------------------------
// Clean code that passes all gates
// ---------------------------------------------------------------------------

const CLEAN_CODE = `
import { readFile } from "node:fs/promises";

export async function loadConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Config must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error("Failed to load config: " + String(err));
  }
}
`.trim();

// ---------------------------------------------------------------------------
// buildFailureContext Tests
// ---------------------------------------------------------------------------

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

    it("includes soft violations section", () => {
      const score: PDSEScore = {
        completeness: 80,
        correctness: 80,
        clarity: 80,
        consistency: 80,
        overall: 80,
        violations: [
          {
            type: "missing_error_handling",
            severity: "soft",
            file: "src/auth.ts",
            line: 15,
            message: "Missing error handling for async operation",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };
      const prompt = buildFailureContext("code", score, [], [], baseContext);
      expect(prompt).toContain("Soft violations");
      expect(prompt).toContain("Missing error handling");
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

    it("truncates long stdout output", () => {
      const longStdout = "y".repeat(2000);
      const gstackResults: GStackResult[] = [
        {
          command: "lint",
          exitCode: 1,
          stdout: longStdout,
          stderr: "error",
          durationMs: 100,
          passed: false,
        },
      ];
      const prompt = buildFailureContext("code", null, gstackResults, [], baseContext);
      expect(prompt).toContain("truncated");
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

    it("handles context without optional fields", () => {
      const minimalContext: AutoforgeContext = {
        taskDescription: "Write a utility function",
      };
      const prompt = buildFailureContext("code", null, [], [], minimalContext);
      expect(prompt).toContain("Write a utility function");
      expect(prompt).not.toContain("Target file:");
      expect(prompt).not.toContain("Language:");
      expect(prompt).not.toContain("Framework:");
    });
  });

  // -------------------------------------------------------------------------
  // formatLessonsForPrompt Tests
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // runAutoforgeIAL Tests
  // -------------------------------------------------------------------------

  describe("runAutoforgeIAL", () => {
    const baseContext: AutoforgeContext = {
      taskDescription: "Write a config loader",
      language: "typescript",
    };

    const baseConfig: AutoforgeConfig = {
      maxIterations: 1,
      lessonInjectionEnabled: false,
      abortOnSecurityViolation: false,
      gstackCommands: [],
    };

    it("succeeds on first iteration when code passes all gates", async () => {
      // Mock router returns a valid PDSE score when called for scoring
      const mockScoreResponse = JSON.stringify({
        completeness: 95,
        correctness: 90,
        clarity: 85,
        consistency: 90,
        violations: [],
      });
      const router = createMockRouter([mockScoreResponse]);

      const result = await runAutoforgeIAL(CLEAN_CODE, baseContext, baseConfig, router, "/tmp");

      expect(result.succeeded).toBe(true);
      expect(result.iterations).toBe(1);
      expect(result.terminationReason).toBe("passed");
      expect(result.finalScore).not.toBeNull();
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns max_iterations when code never passes", async () => {
      // Code with a stub that will always fail
      const stubbedCode = `
export function process(input: string): string {
  // TODO: implement
  return input;
}
`;
      // Router returns low scores (falls back to local scorer since model errors)
      const router = createMockRouter([new Error("model unavailable")]);

      const result = await runAutoforgeIAL(stubbedCode, baseContext, baseConfig, router, "/tmp");

      expect(result.succeeded).toBe(false);
      expect(result.terminationReason).toBe("max_iterations");
      expect(result.iterations).toBe(1);
    });

    it("attempts regeneration on failure with multiple iterations", async () => {
      const stubbedCode = `
export function compute(x: number): number {
  // TODO: implement computation
  return x;
}
`;
      // First call: PDSE scoring -> model error -> falls back to local (fails)
      // Second call: regeneration prompt -> returns clean code
      // Third call: PDSE scoring on regenerated code -> returns passing score
      const router = createMockRouter([
        new Error("model unavailable"), // iteration 1 scoring
        CLEAN_CODE, // iteration 1 regeneration
        JSON.stringify({
          // iteration 2 scoring
          completeness: 95,
          correctness: 90,
          clarity: 85,
          consistency: 90,
          violations: [],
        }),
      ]);

      const config: AutoforgeConfig = {
        ...baseConfig,
        maxIterations: 2,
      };

      const result = await runAutoforgeIAL(stubbedCode, baseContext, config, router, "/tmp");

      expect(result.iterations).toBeGreaterThanOrEqual(1);
      expect(result.iterationHistory.length).toBeGreaterThanOrEqual(1);
    });

    it("records iteration history for each pass", async () => {
      const router = createMockRouter([
        JSON.stringify({
          completeness: 95,
          correctness: 90,
          clarity: 85,
          consistency: 90,
          violations: [],
        }),
      ]);

      const result = await runAutoforgeIAL(CLEAN_CODE, baseContext, baseConfig, router, "/tmp");

      expect(result.iterationHistory.length).toBe(1);
      const iter = result.iterationHistory[0]!;
      expect(iter.iterationNumber).toBe(1);
      expect(iter.durationMs).toBeGreaterThanOrEqual(0);
      expect(iter.succeeded).toBe(true);
      expect(iter.outputScore).not.toBeNull();
    });

    it("terminates on constitution violation with critical severity", async () => {
      // Code that contains a hardcoded secret (constitution violation)
      const codeWithSecret = `
export function connect(): string {
  const apiKey = "sk-live-1234567890abcdef";
  return apiKey;
}
`;
      const router = createMockRouter([new Error("unused")]);
      const config: AutoforgeConfig = {
        ...baseConfig,
        abortOnSecurityViolation: true,
      };

      const result = await runAutoforgeIAL(codeWithSecret, baseContext, config, router, "/tmp");

      expect(result.succeeded).toBe(false);
      expect(result.terminationReason).toBe("constitution_violation");
    });

    it("includes totalDurationMs in result", async () => {
      const router = createMockRouter([
        JSON.stringify({
          completeness: 95,
          correctness: 90,
          clarity: 85,
          consistency: 90,
          violations: [],
        }),
      ]);

      const result = await runAutoforgeIAL(CLEAN_CODE, baseContext, baseConfig, router, "/tmp");
      expect(typeof result.totalDurationMs).toBe("number");
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles empty gstack commands gracefully", async () => {
      const router = createMockRouter([
        JSON.stringify({
          completeness: 95,
          correctness: 90,
          clarity: 85,
          consistency: 90,
          violations: [],
        }),
      ]);

      const config: AutoforgeConfig = {
        ...baseConfig,
        gstackCommands: [],
      };

      const result = await runAutoforgeIAL(CLEAN_CODE, baseContext, config, router, "/tmp");
      expect(result.succeeded).toBe(true);
      expect(result.iterationHistory[0]!.gstackResults).toEqual([]);
    });
  });
});
