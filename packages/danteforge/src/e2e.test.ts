import { describe, it, expect } from "vitest";
import { runAntiStubScanner } from "./anti-stub-scanner.js";
import { runConstitutionCheck } from "./constitution.js";
import { runLocalPDSEScorer } from "./pdse-scorer.js";
import { runAutoforgeIAL, buildFailureContext, type AutoforgeContext } from "./autoforge.js";
import { queryLessons, formatLessonsForPrompt } from "./lessons.js";
import type { AutoforgeConfig, ModelConfig, ModelRouterConfig } from "@dantecode/config-types";
import type { ModelRouter } from "./pdse-scorer.js";

// ---------------------------------------------------------------------------
// E2E Integration Test — Full DanteForge Pipeline
// Tests the entire pipeline without mocking internal modules:
//   anti-stub scan → constitution check → PDSE score → autoforge IAL
// ---------------------------------------------------------------------------

// Clean production code that should pass all gates
const CLEAN_PRODUCTION_CODE = `
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

interface ConfigOptions {
  required: boolean;
  defaults?: Record<string, unknown>;
}

export function loadProjectConfig(
  projectRoot: string,
  options: ConfigOptions = { required: true },
): Record<string, unknown> {
  const configPath = resolve(projectRoot, "config.json");

  if (!existsSync(configPath)) {
    if (options.required) {
      throw new Error(\`Configuration file not found: \${configPath}\`);
    }
    return options.defaults ?? {};
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Configuration must be a JSON object");
  }

  return { ...(options.defaults ?? {}), ...(parsed as Record<string, unknown>) };
}

export function validateConfig(
  config: Record<string, unknown>,
  requiredKeys: string[],
): { valid: boolean; missing: string[] } {
  const missing = requiredKeys.filter((key) => !(key in config));
  return { valid: missing.length === 0, missing };
}

export function mergeConfigs(
  ...configs: Record<string, unknown>[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const config of configs) {
    for (const [key, value] of Object.entries(config)) {
      result[key] = value;
    }
  }
  return result;
}
`.trim();

// Code with stub violations
const STUBBED_CODE = `
export function processData(input: string): string {
  // TODO: implement data processing
  return input;
}

export function validate(data: unknown): boolean {
  // FIXME: add validation logic
  return true;
}
`.trim();

// Code with a hardcoded secret
const CODE_WITH_SECRET = `
export function getApiClient(): string {
  const apiKey = "sk-live-abc123def456ghi789jkl012mno345pqr678";
  return apiKey;
}
`.trim();

// Code with soft issues but no hard violations
const CODE_WITH_SOFT_ISSUES = `
export function calculate(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {
  const step1 = a + b;
  const step2 = step1 * c;
  const step3 = step2 - d;
  const step4 = step3 / e;
  const step5 = step4 + f;
  const step6 = step5 * g;
  const step7 = step6 - h;
  const result = step7 * 2;
  return result;
}
`.trim();

// Mock router for IAL tests
function createMockRouter(responses: (string | Error)[]): ModelRouter {
  let callIndex = 0;
  return {
    chat: async (_prompt: string, _config?: Partial<ModelConfig>): Promise<string> => {
      const response = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      if (response instanceof Error) throw response;
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
// Tests
// ---------------------------------------------------------------------------

describe("E2E: DanteForge Pipeline Integration", () => {
  // -------------------------------------------------------------------------
  // Stage 1: Anti-Stub Scanner → Constitution Check → PDSE Scorer (individual)
  // -------------------------------------------------------------------------

  describe("Stage 1: Individual gate validation", () => {
    it("clean code passes anti-stub scan", () => {
      const result = runAntiStubScanner(CLEAN_PRODUCTION_CODE, "/tmp");
      expect(result.passed).toBe(true);
      expect(result.hardViolations).toHaveLength(0);
    });

    it("stubbed code fails anti-stub scan with hard violations", () => {
      const result = runAntiStubScanner(STUBBED_CODE, "/tmp");
      expect(result.passed).toBe(false);
      expect(result.hardViolations.length).toBeGreaterThan(0);
      const violationMessages = result.hardViolations.map((v) => v.message);
      expect(violationMessages.some((m) => /TODO/i.test(m))).toBe(true);
    });

    it("clean code passes constitution check", () => {
      const result = runConstitutionCheck(CLEAN_PRODUCTION_CODE);
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("code with secret fails constitution check", () => {
      const result = runConstitutionCheck(CODE_WITH_SECRET);
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      const hasCritical = result.violations.some((v) => v.severity === "critical");
      expect(hasCritical).toBe(true);
    });

    it("clean code gets a passing PDSE score (local scorer)", () => {
      const score = runLocalPDSEScorer(CLEAN_PRODUCTION_CODE, "/tmp");
      expect(score.passedGate).toBe(true);
      expect(score.overall).toBeGreaterThanOrEqual(70);
      expect(score.completeness).toBeGreaterThan(0);
      expect(score.correctness).toBeGreaterThan(0);
      expect(score.clarity).toBeGreaterThan(0);
      expect(score.consistency).toBeGreaterThan(0);
    });

    it("stubbed code gets a failing PDSE score (local scorer)", () => {
      const score = runLocalPDSEScorer(STUBBED_CODE, "/tmp");
      expect(score.passedGate).toBe(false);
      expect(score.violations.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Stage 2: Pipeline chaining — sequential gate execution
  // -------------------------------------------------------------------------

  describe("Stage 2: Sequential pipeline chaining", () => {
    it("clean code passes all three gates in sequence", () => {
      // Step 1: Anti-stub
      const antiStub = runAntiStubScanner(CLEAN_PRODUCTION_CODE, "/tmp");
      expect(antiStub.passed).toBe(true);

      // Step 2: Constitution
      const constitution = runConstitutionCheck(CLEAN_PRODUCTION_CODE);
      expect(constitution.passed).toBe(true);

      // Step 3: PDSE
      const pdse = runLocalPDSEScorer(CLEAN_PRODUCTION_CODE, "/tmp");
      expect(pdse.passedGate).toBe(true);

      // All passed
      expect(antiStub.passed && constitution.passed && pdse.passedGate).toBe(true);
    });

    it("stubbed code is caught at the anti-stub gate (first gate)", () => {
      const antiStub = runAntiStubScanner(STUBBED_CODE, "/tmp");
      expect(antiStub.passed).toBe(false);
      // Pipeline would stop here in production — no need to run further gates
    });

    it("secret code passes anti-stub but fails constitution (second gate)", () => {
      const antiStub = runAntiStubScanner(CODE_WITH_SECRET, "/tmp");
      // No TODO/FIXME markers, so anti-stub passes
      expect(antiStub.passed).toBe(true);

      const constitution = runConstitutionCheck(CODE_WITH_SECRET);
      expect(constitution.passed).toBe(false);
      // Pipeline would stop here — no need to score with PDSE
    });

    it("code with soft issues passes anti-stub and constitution and gets scored", () => {
      const antiStub = runAntiStubScanner(CODE_WITH_SOFT_ISSUES, "/tmp");
      expect(antiStub.passed).toBe(true);

      const constitution = runConstitutionCheck(CODE_WITH_SOFT_ISSUES);
      expect(constitution.passed).toBe(true);

      const pdse = runLocalPDSEScorer(CODE_WITH_SOFT_ISSUES, "/tmp");
      // Should get a numeric score from the local scorer
      expect(typeof pdse.overall).toBe("number");
      expect(pdse.overall).toBeGreaterThan(0);
      expect(pdse.scoredBy).toBe("pdse-local");
    });
  });

  // -------------------------------------------------------------------------
  // Stage 3: Full Autoforge IAL — end-to-end iterative loop
  // -------------------------------------------------------------------------

  describe("Stage 3: Full Autoforge IAL integration", () => {
    const baseContext: AutoforgeContext = {
      taskDescription: "Write a configuration loader utility",
      language: "typescript",
      filePath: "src/config-loader.ts",
    };

    const baseConfig: AutoforgeConfig = {
      enabled: true,
      maxIterations: 1,
      lessonInjectionEnabled: false,
      abortOnSecurityViolation: false,
      gstackCommands: [],
    };

    it("clean code passes IAL on first iteration", async () => {
      const router = createMockRouter([
        JSON.stringify({
          completeness: 95,
          correctness: 90,
          clarity: 85,
          consistency: 90,
          violations: [],
        }),
      ]);

      const result = await runAutoforgeIAL(
        CLEAN_PRODUCTION_CODE,
        baseContext,
        baseConfig,
        router,
        "/tmp",
      );

      expect(result.succeeded).toBe(true);
      expect(result.terminationReason).toBe("passed");
      expect(result.iterations).toBe(1);
      expect(result.finalCode).toBe(CLEAN_PRODUCTION_CODE);
      expect(result.finalScore).not.toBeNull();
      expect(result.finalScore!.passedGate).toBe(true);
    });

    it("stubbed code fails IAL with max_iterations", async () => {
      const router = createMockRouter([new Error("model unavailable")]);

      const result = await runAutoforgeIAL(STUBBED_CODE, baseContext, baseConfig, router, "/tmp");

      expect(result.succeeded).toBe(false);
      expect(result.terminationReason).toBe("max_iterations");
      expect(result.iterationHistory.length).toBe(1);
      expect(result.iterationHistory[0]!.succeeded).toBe(false);
      expect(result.iterationHistory[0]!.inputViolations.length).toBeGreaterThan(0);
    });

    it("code with secret terminates IAL with constitution_violation", async () => {
      const router = createMockRouter([new Error("unused")]);
      const config: AutoforgeConfig = {
        ...baseConfig,
        abortOnSecurityViolation: true,
      };

      const result = await runAutoforgeIAL(CODE_WITH_SECRET, baseContext, config, router, "/tmp");

      expect(result.succeeded).toBe(false);
      expect(result.terminationReason).toBe("constitution_violation");
    });

    it("IAL regenerates stubbed code using mock router and passes on iteration 2", async () => {
      const router = createMockRouter([
        new Error("model unavailable"), // iteration 1: PDSE scoring fails, falls back to local
        CLEAN_PRODUCTION_CODE, // iteration 1: regeneration returns clean code
        JSON.stringify({
          // iteration 2: PDSE scoring passes
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

      const result = await runAutoforgeIAL(STUBBED_CODE, baseContext, config, router, "/tmp");

      expect(result.iterations).toBe(2);
      expect(result.succeeded).toBe(true);
      expect(result.terminationReason).toBe("passed");
      expect(result.iterationHistory.length).toBe(2);
      // First iteration failed, second succeeded
      expect(result.iterationHistory[0]!.succeeded).toBe(false);
      expect(result.iterationHistory[1]!.succeeded).toBe(true);
    });

    it("IAL with lesson injection queries lessons database", async () => {
      const router = createMockRouter([new Error("model unavailable")]);
      const config: AutoforgeConfig = {
        ...baseConfig,
        maxIterations: 2,
        lessonInjectionEnabled: true,
      };

      const result = await runAutoforgeIAL(STUBBED_CODE, baseContext, config, router, "/tmp");

      // Should still fail (router error) but the lesson injection path was exercised
      expect(result.succeeded).toBe(false);
      expect(result.iterations).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Stage 4: Failure context generation (glue between gates and regeneration)
  // -------------------------------------------------------------------------

  describe("Stage 4: Failure context bridges gates to regeneration", () => {
    it("builds regeneration prompt from real anti-stub + PDSE results", () => {
      runAntiStubScanner(STUBBED_CODE, "/tmp"); // verifies it doesn't throw
      const pdse = runLocalPDSEScorer(STUBBED_CODE, "/tmp");
      const context: AutoforgeContext = {
        taskDescription: "Fix the data processor",
        language: "typescript",
      };

      const prompt = buildFailureContext(STUBBED_CODE, pdse, [], [], context);

      // Should contain task description
      expect(prompt).toContain("Fix the data processor");
      // Should contain PDSE score data
      expect(prompt).toContain("Completeness");
      expect(prompt).toContain("Correctness");
      // Should contain the current code
      expect(prompt).toContain("processData");
      // Should contain regeneration instructions
      expect(prompt).toContain("Fix ALL hard violations");
    });

    it("includes formatted lessons from the lessons system", async () => {
      const lessons = await queryLessons({ projectRoot: "/tmp", limit: 5 });
      const lessonsText = formatLessonsForPrompt(lessons);
      // Even if no lessons exist, the pipeline handles it gracefully
      expect(typeof lessonsText).toBe("string");
    });
  });

  // -------------------------------------------------------------------------
  // Stage 5: Cross-gate consistency
  // -------------------------------------------------------------------------

  describe("Stage 5: Cross-gate consistency", () => {
    it("anti-stub violations appear as input violations in IAL iteration history", async () => {
      const router = createMockRouter([new Error("unused")]);
      const config: AutoforgeConfig = {
        enabled: true,
        maxIterations: 1,
        lessonInjectionEnabled: false,
        abortOnSecurityViolation: false,
        gstackCommands: [],
      };

      const result = await runAutoforgeIAL(STUBBED_CODE, baseContext, config, router, "/tmp");

      const firstIter = result.iterationHistory[0]!;
      expect(firstIter.inputViolations.length).toBeGreaterThan(0);
      // Anti-stub violations should be present
      const hasStubViolation = firstIter.inputViolations.some((v) => v.type === "stub_detected");
      expect(hasStubViolation).toBe(true);
    });

    it("constitution violations appear as input violations with abort", async () => {
      const router = createMockRouter([new Error("unused")]);
      const config: AutoforgeConfig = {
        enabled: true,
        maxIterations: 1,
        lessonInjectionEnabled: false,
        abortOnSecurityViolation: true,
        gstackCommands: [],
      };

      const result = await runAutoforgeIAL(CODE_WITH_SECRET, baseContext, config, router, "/tmp");

      expect(result.terminationReason).toBe("constitution_violation");
      const firstIter = result.iterationHistory[0]!;
      // Should have constitution-derived violations in the input
      expect(firstIter.inputViolations.length).toBeGreaterThan(0);
    });

    it("PDSE scorer and anti-stub scanner agree on stub detection", () => {
      const antiStub = runAntiStubScanner(STUBBED_CODE, "/tmp");
      const pdse = runLocalPDSEScorer(STUBBED_CODE, "/tmp");

      // Both should detect issues
      expect(antiStub.passed).toBe(false);
      expect(pdse.passedGate).toBe(false);

      // Both should report violations
      expect(antiStub.hardViolations.length).toBeGreaterThan(0);
      expect(pdse.violations.length).toBeGreaterThan(0);
    });
  });

  const baseContext: AutoforgeContext = {
    taskDescription: "Write a utility",
    language: "typescript",
  };
});
