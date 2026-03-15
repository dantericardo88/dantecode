// ============================================================================
// @dantecode/danteforge — Autoforge IAL (Iterative Auto-correction Loop)
// The core iterative loop that runs anti-stub scanning, GStack commands,
// PDSE scoring, and lesson injection to progressively improve generated code.
// ============================================================================

import type {
  AutoforgeConfig,
  AutoforgeIteration,
  GStackResult,
  Lesson,
  PDSEScore,
  PDSEViolation,
} from "@dantecode/config-types";
import { runAntiStubScanner } from "./anti-stub-scanner.js";
import { runGStack, allGStackPassed } from "./gstack.js";
import { runPDSEScorer, type ModelRouter, runLocalPDSEScorer } from "./pdse-scorer.js";
import { queryLessons, recordLesson, formatLessonsForPrompt } from "./lessons.js";
import { runConstitutionCheck } from "./constitution.js";

// ----------------------------------------------------------------------------
// Autoforge Result
// ----------------------------------------------------------------------------

export interface AutoforgeResult {
  /** The final code produced by the autoforge loop. */
  finalCode: string;
  /** Total number of iterations executed. */
  iterations: number;
  /** Whether the code passed all quality gates. */
  succeeded: boolean;
  /** Detailed history of each iteration. */
  iterationHistory: AutoforgeIteration[];
  /** The final PDSE score achieved. */
  finalScore: PDSEScore | null;
  /** Total elapsed time across all iterations in milliseconds. */
  totalDurationMs: number;
  /** Reason the loop terminated. */
  terminationReason: "passed" | "max_iterations" | "constitution_violation" | "error";
}

// ----------------------------------------------------------------------------
// Autoforge Context (passed to the regeneration prompt)
// ----------------------------------------------------------------------------

export interface AutoforgeContext {
  /** The original user request or task description. */
  taskDescription: string;
  /** The file path where the code will be written (if known). */
  filePath?: string;
  /** The programming language. */
  language?: string;
  /** The framework in use. */
  framework?: string;
  /** Additional context from the user or session. */
  additionalContext?: string;
}

// ----------------------------------------------------------------------------
// Failure Context Builder
// ----------------------------------------------------------------------------

/**
 * Builds a detailed regeneration prompt that includes the current code,
 * PDSE score breakdown, GStack failure details, and relevant lessons.
 * This prompt is sent to the LLM to request improved code.
 *
 * @param currentCode - The code that failed quality gates
 * @param score - The PDSE score that caused failure
 * @param gstackResults - GStack command results (may contain failures)
 * @param lessons - Relevant lessons from the lessons database
 * @param context - The original autoforge context
 * @returns A complete regeneration prompt string
 */
export function buildFailureContext(
  currentCode: string,
  score: PDSEScore | null,
  gstackResults: GStackResult[],
  lessons: Lesson[],
  context: AutoforgeContext,
): string {
  const sections: string[] = [];

  // Header
  sections.push(
    "# Code Regeneration Request\n\n" +
    "The previous code generation did not pass quality gates. " +
    "Please regenerate the code addressing ALL of the issues listed below.\n"
  );

  // Original task description
  sections.push(
    `## Original Task\n\n${context.taskDescription}\n`
  );

  if (context.filePath) {
    sections.push(`**Target file:** ${context.filePath}`);
  }
  if (context.language) {
    sections.push(`**Language:** ${context.language}`);
  }
  if (context.framework) {
    sections.push(`**Framework:** ${context.framework}`);
  }

  // PDSE score breakdown
  if (score) {
    sections.push(
      "\n## PDSE Quality Score (Failed)\n\n" +
      `- **Overall:** ${score.overall}/100 (gate threshold requires >= 70)\n` +
      `- **Completeness:** ${score.completeness}/100 (weight: 35%)\n` +
      `- **Correctness:** ${score.correctness}/100 (weight: 30%)\n` +
      `- **Clarity:** ${score.clarity}/100 (weight: 20%)\n` +
      `- **Consistency:** ${score.consistency}/100 (weight: 15%)\n`
    );

    // List violations
    if (score.violations.length > 0) {
      sections.push("### Violations Found\n");
      const hardViolations = score.violations.filter((v) => v.severity === "hard");
      const softViolations = score.violations.filter((v) => v.severity === "soft");

      if (hardViolations.length > 0) {
        sections.push("**HARD violations (MUST fix):**");
        for (const v of hardViolations) {
          const lineRef = v.line ? ` (line ${v.line})` : "";
          sections.push(`- [${v.type}]${lineRef}: ${v.message}`);
        }
        sections.push("");
      }

      if (softViolations.length > 0) {
        sections.push("**Soft violations (should fix):**");
        for (const v of softViolations) {
          const lineRef = v.line ? ` (line ${v.line})` : "";
          sections.push(`- [${v.type}]${lineRef}: ${v.message}`);
        }
        sections.push("");
      }
    }
  }

  // GStack failures
  const failedGStack = gstackResults.filter((r) => !r.passed);
  if (failedGStack.length > 0) {
    sections.push("## GStack Command Failures\n");
    for (const result of failedGStack) {
      sections.push(`### Command: \`${result.command}\``);
      sections.push(`- **Exit code:** ${result.exitCode}`);
      sections.push(`- **Duration:** ${result.durationMs}ms`);
      if (result.stderr.trim().length > 0) {
        // Truncate stderr to avoid enormous prompts
        const truncatedStderr = result.stderr.length > 2000
          ? result.stderr.slice(0, 2000) + "\n... (truncated)"
          : result.stderr;
        sections.push(`- **Error output:**\n\`\`\`\n${truncatedStderr}\n\`\`\``);
      }
      if (result.stdout.trim().length > 0) {
        const truncatedStdout = result.stdout.length > 1000
          ? result.stdout.slice(0, 1000) + "\n... (truncated)"
          : result.stdout;
        sections.push(`- **Standard output:**\n\`\`\`\n${truncatedStdout}\n\`\`\``);
      }
      sections.push("");
    }
  }

  // Injected lessons
  const lessonsText = formatLessonsForPrompt(lessons);
  if (lessonsText.length > 0) {
    sections.push(lessonsText);
  }

  // The current code
  sections.push(
    "\n## Current Code (needs fixes)\n\n" +
    "```\n" + currentCode + "\n```\n"
  );

  // Instructions
  sections.push(
    "\n## Instructions\n\n" +
    "1. Fix ALL hard violations listed above — these are blocking.\n" +
    "2. Address soft violations where possible.\n" +
    "3. Ensure the code passes all GStack commands (build, test, lint).\n" +
    "4. Apply corrections from the lessons section.\n" +
    "5. Return ONLY the complete, corrected source code.\n" +
    "6. Do NOT include markdown fences, explanations, or comments about changes.\n" +
    "7. The code must be complete — no stubs, no TODOs, no placeholders.\n"
  );

  return sections.join("\n");
}

// ----------------------------------------------------------------------------
// Extract Code from Model Response
// ----------------------------------------------------------------------------

/**
 * Extracts code from a model response, stripping markdown fences and
 * explanatory text if present.
 */
function extractCodeFromResponse(response: string): string {
  // Try to extract from markdown code fence
  const fenceMatch = response.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  // If no fence found, try to detect if response starts with code
  const trimmed = response.trim();

  // If the response starts with an import/export or common code patterns,
  // assume the entire response is code
  if (
    /^(?:import|export|const|let|var|function|class|interface|type|enum|\/\/|\/\*|#!)/m.test(trimmed)
  ) {
    // Strip any trailing explanation after the code
    // Look for a line that starts with an explanation marker
    const lines = trimmed.split("\n");
    const codeLines: string[] = [];
    let hitExplanation = false;

    for (const line of lines) {
      if (
        hitExplanation ||
        /^(?:Note:|Changes:|This |I |Here |The above|Explanation:)/i.test(line.trim())
      ) {
        hitExplanation = true;
        continue;
      }
      codeLines.push(line);
    }

    return codeLines.join("\n").trim();
  }

  // Fall back to the entire response
  return trimmed;
}

// ----------------------------------------------------------------------------
// Main Autoforge IAL Loop
// ----------------------------------------------------------------------------

/**
 * Runs the Autoforge Iterative Auto-correction Loop (IAL).
 *
 * For each iteration (1 to maxIterations):
 *   1. Run anti-stub scanner on the current code
 *   2. Run GStack commands (build, test, lint, etc.)
 *   3. Run PDSE scorer for quality evaluation
 *   4. If all gates pass -> return succeeded
 *   5. If fail -> query relevant lessons, build failure context, regenerate via router
 *   6. If final iteration fails -> record lesson about the failure, return failed
 *
 * @param code - The initial code to evaluate and potentially improve
 * @param context - Task context for regeneration prompts
 * @param config - Autoforge configuration (max iterations, GStack commands, etc.)
 * @param router - The model router for LLM-based scoring and regeneration
 * @param projectRoot - The project root directory
 * @returns AutoforgeResult with final code, iteration count, and success status
 */
export async function runAutoforgeIAL(
  code: string,
  context: AutoforgeContext,
  config: AutoforgeConfig,
  router: ModelRouter,
  projectRoot: string,
): Promise<AutoforgeResult> {
  const iterationHistory: AutoforgeIteration[] = [];
  let currentCode = code;
  let finalScore: PDSEScore | null = null;
  const totalStartTime = Date.now();

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    const iterStartTime = Date.now();

    // ---------- Step 1: Anti-Stub Scan ----------
    const antiStubResult = runAntiStubScanner(currentCode, projectRoot);
    const inputViolations: PDSEViolation[] = [
      ...antiStubResult.hardViolations,
      ...antiStubResult.softViolations,
    ];

    // ---------- Step 1b: Constitution Check (if enabled) ----------
    if (config.abortOnSecurityViolation) {
      const constitutionResult = runConstitutionCheck(currentCode);
      if (!constitutionResult.passed) {
        // Convert constitution violations to PDSE violations for recording
        const constitutionViolations: PDSEViolation[] = constitutionResult.violations.map((v) => ({
          type: v.type === "credential_exposure" ? "hardcoded_secret" as const : "background_process" as const,
          severity: "hard" as const,
          file: "<evaluated>",
          line: v.line,
          message: v.message,
          pattern: v.pattern,
        }));

        inputViolations.push(...constitutionViolations);

        // If constitution check fails and abort is enabled, terminate immediately
        // unless this is not the last iteration and we can try to fix it
        if (constitutionResult.violations.some((v) => v.severity === "critical")) {
          const iterDuration = Date.now() - iterStartTime;
          iterationHistory.push({
            iterationNumber: iteration,
            inputViolations,
            gstackResults: [],
            lessonsInjected: [],
            outputScore: {
              completeness: 0,
              correctness: 0,
              clarity: 0,
              consistency: 0,
              overall: 0,
              violations: inputViolations,
              passedGate: false,
              scoredAt: new Date().toISOString(),
              scoredBy: "constitution",
            },
            succeeded: false,
            durationMs: iterDuration,
          });

          return {
            finalCode: currentCode,
            iterations: iteration,
            succeeded: false,
            iterationHistory,
            finalScore: null,
            totalDurationMs: Date.now() - totalStartTime,
            terminationReason: "constitution_violation",
          };
        }
      }
    }

    // ---------- Step 2: Run GStack Commands ----------
    let gstackResults: GStackResult[] = [];
    if (config.gstackCommands.length > 0) {
      gstackResults = await runGStack(currentCode, config.gstackCommands, projectRoot);
    }

    // ---------- Step 3: Run PDSE Scorer ----------
    let score: PDSEScore;
    try {
      score = await runPDSEScorer(currentCode, router, projectRoot);
    } catch {
      // Fall back to local scorer if model-based scoring fails
      score = runLocalPDSEScorer(currentCode, projectRoot);
    }
    finalScore = score;

    // ---------- Step 4: Check if all gates pass ----------
    const gstackPassed = allGStackPassed(gstackResults);
    const allPassed = score.passedGate && gstackPassed;

    const iterDuration = Date.now() - iterStartTime;

    iterationHistory.push({
      iterationNumber: iteration,
      inputViolations,
      gstackResults,
      lessonsInjected: [],
      outputScore: score,
      succeeded: allPassed,
      durationMs: iterDuration,
    });

    if (allPassed) {
      return {
        finalCode: currentCode,
        iterations: iteration,
        succeeded: true,
        iterationHistory,
        finalScore: score,
        totalDurationMs: Date.now() - totalStartTime,
        terminationReason: "passed",
      };
    }

    // ---------- Step 5: If fail and not last iteration -> regenerate ----------
    if (iteration < config.maxIterations) {
      // Query relevant lessons for injection
      let lessons: Lesson[] = [];
      if (config.lessonInjectionEnabled) {
        lessons = await queryLessons({
          projectRoot,
          language: context.language,
          filePattern: context.filePath,
          limit: 10,
        });
      }

      // Update the last iteration with injected lesson IDs
      const lastIter = iterationHistory[iterationHistory.length - 1];
      if (lastIter) {
        lastIter.lessonsInjected = lessons.map((l) => l.id);
      }

      // Build the regeneration prompt
      const failurePrompt = buildFailureContext(
        currentCode,
        score,
        gstackResults,
        lessons,
        context,
      );

      // Send to model for regeneration
      try {
        const response = await router.chat(failurePrompt, {
          temperature: 0.3, // Slightly higher temp for creative fixes
          maxTokens: 16384, // Allow large outputs
        });

        const regeneratedCode = extractCodeFromResponse(response);

        // Only accept regeneration if it's non-empty and different
        if (regeneratedCode.length > 0 && regeneratedCode !== currentCode) {
          currentCode = regeneratedCode;
        }
      } catch {
        // If regeneration fails, continue with the current code
        // The next iteration will re-score and potentially fail again
      }
    }

    // ---------- Step 6: Final iteration failed -> record lesson ----------
    if (iteration === config.maxIterations && !allPassed) {
      // Record a lesson about this failure for future reference
      const hardViolations = score.violations.filter((v) => v.severity === "hard");
      const failedCommands = gstackResults.filter((r) => !r.passed);

      if (hardViolations.length > 0) {
        const topViolation = hardViolations[0]!;
        recordLesson(
          {
            projectRoot,
            pattern: `Anti-stub violation: ${topViolation.type} — ${topViolation.message}`,
            correction: `Ensure generated code does not contain ${topViolation.type} patterns. ` +
              `The code must be complete with no stubs, TODOs, or placeholder implementations.`,
            filePattern: context.filePath,
            language: context.language,
            framework: context.framework,
            occurrences: 1,
            lastSeen: new Date().toISOString(),
            severity: "error",
            source: "autoforge",
          },
          projectRoot,
        );
      }

      if (failedCommands.length > 0) {
        const topFailed = failedCommands[0]!;
        const stderrSummary = topFailed.stderr.slice(0, 200);
        recordLesson(
          {
            projectRoot,
            pattern: `GStack failure: ${topFailed.command} exited with code ${topFailed.exitCode}`,
            correction: `Ensure generated code passes the command: ${topFailed.command}. ` +
              `Previous error: ${stderrSummary}`,
            filePattern: context.filePath,
            language: context.language,
            framework: context.framework,
            occurrences: 1,
            lastSeen: new Date().toISOString(),
            severity: "warning",
            source: "autoforge",
          },
          projectRoot,
        );
      }

      return {
        finalCode: currentCode,
        iterations: iteration,
        succeeded: false,
        iterationHistory,
        finalScore: score,
        totalDurationMs: Date.now() - totalStartTime,
        terminationReason: "max_iterations",
      };
    }
  }

  // Should never reach here, but handle gracefully
  return {
    finalCode: currentCode,
    iterations: config.maxIterations,
    succeeded: false,
    iterationHistory,
    finalScore,
    totalDurationMs: Date.now() - totalStartTime,
    terminationReason: "max_iterations",
  };
}
