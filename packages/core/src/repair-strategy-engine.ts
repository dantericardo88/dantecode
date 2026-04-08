// ============================================================================
// @dantecode/core — RepairStrategyEngine
//
// Routes verification failures to the correct repair strategy based on the
// error type, stage, and error patterns. Produces targeted repair prompts
// for each category rather than generic "fix the errors" messages.
//
// Error taxonomy (adapted from Aider + SWE-bench failure analysis):
//   - TypeScript type errors → type annotation / inference fixes
//   - Import errors → missing imports, path resolution
//   - Undefined variable → declaration / scope fixes
//   - Lint violations → rule-specific remediation
//   - Test assertion errors → implementation alignment
//   - Test setup errors → mock / fixture repair
//   - Runtime crashes → null-check, boundary guard
// ============================================================================

import type { VerificationStage, VerificationStageResult } from "./verification-engine.js";
import type { ParsedError } from "./error-parser.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Fine-grained error category for targeted repair routing. */
export type ErrorCategory =
  | "type_mismatch"
  | "missing_import"
  | "missing_export"
  | "undefined_symbol"
  | "lint_violation"
  | "test_assertion"
  | "test_setup"
  | "runtime_crash"
  | "build_failure"
  | "unknown";

/** A classified error with repair metadata. */
export interface ClassifiedError {
  raw: ParsedError;
  category: ErrorCategory;
  /** Suggested repair action (brief, suitable for prompt heading). */
  repairAction: string;
  /** Priority — lower = fix first. Critical errors block subsequent stages. */
  priority: 1 | 2 | 3;
}

/** A complete repair plan for a failed stage. */
export interface RepairPlan {
  /** The stage this plan addresses. */
  stage: VerificationStage;
  /** Classified errors in priority order. */
  errors: ClassifiedError[];
  /** Dominant category (most common across errors). */
  dominantCategory: ErrorCategory;
  /** Full repair prompt suitable for injection into an LLM context. */
  prompt: string;
  /** Estimated difficulty: "easy" < 5 errors, "medium" < 15, "hard" 15+. */
  difficulty: "easy" | "medium" | "hard";
}

// ----------------------------------------------------------------------------
// Error category detection patterns
// ----------------------------------------------------------------------------

const TYPE_MISMATCH_PATTERNS = [
  /type\s+'.+?'\s+is not assignable/i,
  /argument of type\s+'.+?'\s+is not assignable/i,
  /property\s+'.+?'\s+does not exist on type/i,
  /expected\s+\d+\s+arguments?,\s+but got/i,
  /object is possibly 'null'/i,
  /object is possibly 'undefined'/i,
  /cannot read propert/i,
];

const MISSING_IMPORT_PATTERNS = [
  /cannot find module/i,
  /module '.+?' has no exported member/i,
  /has no default export/i,
  /is not a module/i,
  /could not find a declaration file/i,
];

const MISSING_EXPORT_PATTERNS = [
  /is not exported from/i,
  /does not provide an export named/i,
  /named export '.+?' not found/i,
];

const UNDEFINED_SYMBOL_PATTERNS = [
  /cannot find name\s+'.+?'/i,
  /is not defined/i,
  /block-scoped variable\s+'.+?'\s+used before its declaration/i,
];

const LINT_PATTERNS = [
  /eslint/i,
  /prettier/i,
  /no-unused-vars/i,
  /no-explicit-any/i,
  /prefer-const/i,
  /eqeqeq/i,
];

const TEST_ASSERTION_PATTERNS = [
  /expect\(.+?\)\.to/i,
  /AssertionError/i,
  /expected .+ to (equal|be|match|contain)/i,
  /received:\s+.+\n\s+expected:/i,
];

const TEST_SETUP_PATTERNS = [
  /beforeEach|afterEach|beforeAll|afterAll/i,
  /mock.+?not a function/i,
  /cannot spy the .+? property/i,
  /TypeError: .+? is not a constructor/i,
];

// ----------------------------------------------------------------------------
// RepairStrategyEngine
// ----------------------------------------------------------------------------

/**
 * RepairStrategyEngine
 *
 * Classifies errors from a failed verification stage and builds targeted
 * repair prompts. Called by SelfHealingLoop to produce fixFn arguments.
 */
export class RepairStrategyEngine {
  /**
   * Classify and build a repair prompt for a failed stage result.
   */
  buildRepairPrompt(stage: VerificationStage, result: VerificationStageResult): string {
    const plan = this.buildRepairPlan(stage, result);
    return plan.prompt;
  }

  /**
   * Build a full repair plan from a failed stage result.
   */
  buildRepairPlan(stage: VerificationStage, result: VerificationStageResult): RepairPlan {
    const classified = result.parsedErrors.map((e) => this.classifyError(e, stage));

    // If no parsedErrors, try to extract from raw output
    if (classified.length === 0) {
      return this.buildFallbackPlan(stage, result);
    }

    // Sort by priority ascending (1 = most critical)
    classified.sort((a, b) => a.priority - b.priority);

    const dominantCategory = this.computeDominantCategory(classified);
    const difficulty = classified.length < 5 ? "easy" : classified.length < 15 ? "medium" : "hard";

    const prompt = this.buildPromptFromPlan(stage, classified, dominantCategory, result);

    return { stage, errors: classified, dominantCategory, prompt, difficulty };
  }

  /**
   * Classify a single parsed error into a repair category.
   */
  classifyError(error: ParsedError, stage: VerificationStage): ClassifiedError {
    const msg = error.message ?? "";
    const rawText = `${error.message ?? ""} ${error.code ?? ""}`;

    // Stage-specific overrides
    if (stage === "lint") {
      return {
        raw: error,
        category: "lint_violation",
        repairAction: `Fix ESLint rule: ${error.code ?? "unknown rule"}`,
        priority: 2,
      };
    }

    // Type errors
    if (TYPE_MISMATCH_PATTERNS.some((p) => p.test(msg))) {
      return {
        raw: error,
        category: "type_mismatch",
        repairAction: `Fix type mismatch at ${error.file ?? "unknown"}:${error.line ?? "?"}`,
        priority: 1,
      };
    }

    if (MISSING_IMPORT_PATTERNS.some((p) => p.test(rawText))) {
      return {
        raw: error,
        category: "missing_import",
        repairAction: `Fix missing import: ${error.message.slice(0, 60)}`,
        priority: 1,
      };
    }

    if (MISSING_EXPORT_PATTERNS.some((p) => p.test(msg))) {
      return {
        raw: error,
        category: "missing_export",
        repairAction: `Fix missing export: ${error.message.slice(0, 60)}`,
        priority: 1,
      };
    }

    if (UNDEFINED_SYMBOL_PATTERNS.some((p) => p.test(msg))) {
      return {
        raw: error,
        category: "undefined_symbol",
        repairAction: `Declare or import symbol: ${error.message.slice(0, 60)}`,
        priority: 1,
      };
    }

    if (TEST_SETUP_PATTERNS.some((p) => p.test(msg))) {
      return {
        raw: error,
        category: "test_setup",
        repairAction: `Fix test setup/mock: ${error.message.slice(0, 60)}`,
        priority: 2,
      };
    }

    if (TEST_ASSERTION_PATTERNS.some((p) => p.test(msg))) {
      return {
        raw: error,
        category: "test_assertion",
        repairAction: `Fix test assertion: ${error.message.slice(0, 60)}`,
        priority: 3,
      };
    }

    if (LINT_PATTERNS.some((p) => p.test(rawText))) {
      return {
        raw: error,
        category: "lint_violation",
        repairAction: `Fix lint: ${error.message.slice(0, 60)}`,
        priority: 2,
      };
    }

    return {
      raw: error,
      category: "unknown",
      repairAction: `Fix: ${error.message.slice(0, 80)}`,
      priority: 3,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private computeDominantCategory(errors: ClassifiedError[]): ErrorCategory {
    const counts = new Map<ErrorCategory, number>();
    for (const e of errors) {
      counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    }
    let dominant: ErrorCategory = "unknown";
    let max = 0;
    for (const [cat, count] of counts) {
      if (count > max) {
        max = count;
        dominant = cat;
      }
    }
    return dominant;
  }

  private buildPromptFromPlan(
    stage: VerificationStage,
    classified: ClassifiedError[],
    dominantCategory: ErrorCategory,
    result: VerificationStageResult,
  ): string {
    const lines: string[] = [];

    // Stage header
    lines.push(this.stageHeader(stage, dominantCategory));
    lines.push("");

    // Top-priority errors (cap at 10 to avoid overwhelming the model)
    const topErrors = classified.slice(0, 10);
    for (const err of topErrors) {
      const loc = err.raw.file
        ? `${err.raw.file}${err.raw.line ? `:${err.raw.line}` : ""}`
        : "unknown location";
      lines.push(`• [${err.category}] ${loc}`);
      lines.push(`  ${err.raw.message}`);
      if (err.raw.code) lines.push(`  Code: ${err.raw.code}`);
    }

    if (classified.length > 10) {
      lines.push(`  ... and ${classified.length - 10} more errors`);
    }

    lines.push("");
    lines.push(this.repairGuidance(dominantCategory, stage));

    // Fallback: include raw output tail if no parsedErrors were specific enough
    if (classified.every((e) => e.category === "unknown")) {
      const rawTail = (result.stderr || result.stdout).slice(-2000);
      lines.push("");
      lines.push("Raw output (last 2000 chars):");
      lines.push(rawTail);
    }

    return lines.join("\n");
  }

  private buildFallbackPlan(stage: VerificationStage, result: VerificationStageResult): RepairPlan {
    const output = (result.stderr || result.stdout).slice(-2000);
    const prompt = [
      `Stage "${stage}" failed (exit ${result.exitCode}). No structured errors could be parsed.`,
      "",
      "Raw output:",
      output,
      "",
      "Analyze the output and fix the underlying cause.",
    ].join("\n");

    return {
      stage,
      errors: [],
      dominantCategory: "unknown",
      prompt,
      difficulty: "medium",
    };
  }

  private stageHeader(stage: VerificationStage, category: ErrorCategory): string {
    const headers: Record<VerificationStage, Record<ErrorCategory | "default", string>> = {
      typecheck: {
        type_mismatch: "Fix TypeScript type mismatches. Resolve the types correctly — do NOT add `any` casts.",
        missing_import: "Fix missing TypeScript imports. Ensure all referenced modules are properly imported.",
        missing_export: "Fix missing TypeScript exports. Ensure all referenced exports are declared.",
        undefined_symbol: "Fix undefined symbols. Declare or import all referenced identifiers.",
        default: "Fix TypeScript type errors. Resolve the types correctly without adding `any` casts.",
        lint_violation: "Fix TypeScript lint violations.",
        test_assertion: "Fix TypeScript test assertion errors.",
        test_setup: "Fix TypeScript test setup errors.",
        runtime_crash: "Fix TypeScript runtime errors.",
        build_failure: "Fix TypeScript build failures.",
        unknown: "Fix TypeScript errors.",
      },
      lint: {
        lint_violation: "Fix ESLint violations. Follow the project's rules strictly — do not disable rules.",
        default: "Fix linting violations.",
        type_mismatch: "Fix lint type violations.",
        missing_import: "Fix lint import violations.",
        missing_export: "Fix lint export violations.",
        undefined_symbol: "Fix lint undefined symbol violations.",
        test_assertion: "Fix lint test assertion violations.",
        test_setup: "Fix lint test setup violations.",
        runtime_crash: "Fix lint runtime violations.",
        build_failure: "Fix lint build violations.",
        unknown: "Fix lint violations.",
      },
      unit: {
        test_assertion: "Fix failing unit tests. Align the implementation with what the tests expect.",
        test_setup: "Fix test setup errors. Ensure mocks, fixtures, and beforeEach/afterEach are correct.",
        default: "Fix failing unit tests.",
        type_mismatch: "Fix type mismatches in unit tests.",
        missing_import: "Fix missing imports in unit tests.",
        missing_export: "Fix missing exports in unit tests.",
        undefined_symbol: "Fix undefined symbols in unit tests.",
        lint_violation: "Fix lint violations in unit tests.",
        runtime_crash: "Fix runtime crashes in unit tests.",
        build_failure: "Fix build failures in unit tests.",
        unknown: "Fix unit test failures.",
      },
      integration: {
        test_assertion: "Fix integration test failures. Check API contracts and data flow.",
        default: "Fix integration test failures.",
        type_mismatch: "Fix type mismatches in integration tests.",
        missing_import: "Fix missing imports in integration tests.",
        missing_export: "Fix missing exports in integration tests.",
        undefined_symbol: "Fix undefined symbols in integration tests.",
        lint_violation: "Fix lint violations in integration tests.",
        test_setup: "Fix test setup errors in integration tests.",
        runtime_crash: "Fix runtime crashes in integration tests.",
        build_failure: "Fix build failures in integration tests.",
        unknown: "Fix integration test failures.",
      },
      smoke: {
        runtime_crash: "Fix smoke test crashes. The basic happy-path must work end-to-end.",
        default: "Fix smoke test failures.",
        type_mismatch: "Fix type mismatches in smoke tests.",
        missing_import: "Fix missing imports in smoke tests.",
        missing_export: "Fix missing exports in smoke tests.",
        undefined_symbol: "Fix undefined symbols in smoke tests.",
        lint_violation: "Fix lint violations in smoke tests.",
        test_assertion: "Fix smoke test assertion failures.",
        test_setup: "Fix smoke test setup errors.",
        build_failure: "Fix smoke test build failures.",
        unknown: "Fix smoke test failures.",
      },
    };

    return (headers[stage][category] ?? headers[stage]["default"]) as string;
  }

  private repairGuidance(category: ErrorCategory, stage: VerificationStage): string {
    const guidance: Record<ErrorCategory, string> = {
      type_mismatch:
        "Repair approach: Look at the actual vs expected types. Widen/narrow types or update the callers to match the declared signature. Never use `as any`.",
      missing_import:
        "Repair approach: Add the correct import statement. Check the package exports if it's a third-party module. Verify the path is correct for local modules.",
      missing_export:
        "Repair approach: Add the export declaration to the source file. If the symbol was renamed, update the import to use the new name.",
      undefined_symbol:
        "Repair approach: Declare the variable/function before use, or import it from the correct module. Check for typos in the identifier name.",
      lint_violation:
        "Repair approach: Fix each ESLint rule violation. Do not use eslint-disable comments — fix the root cause.",
      test_assertion:
        "Repair approach: Compare the actual output with the expected value. If the implementation is correct, check if the test expectation needs updating (only if the behavior change is intentional).",
      test_setup:
        "Repair approach: Fix the test fixture setup. Ensure mocks return the correct type/shape. Check that beforeEach/afterEach/vi.mock() calls are correct.",
      runtime_crash:
        "Repair approach: Add null/undefined guards. Ensure all async operations are properly awaited. Check array bounds.",
      build_failure:
        "Repair approach: Check the build configuration. Ensure all required files exist and imports resolve correctly.",
      unknown:
        "Repair approach: Read the error carefully and fix the root cause. If the error message is unclear, add debug output and re-run.",
    };

    if (stage === "unit" && category === "test_assertion") {
      return guidance.test_assertion;
    }

    return guidance[category] ?? guidance.unknown;
  }
}
