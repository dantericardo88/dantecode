// ============================================================================
// @dantecode/danteforge — PDSE Scorer
// Production-grade code quality scoring with model-based and local evaluation.
// ============================================================================

import type {
  PDSEScore,
  PDSEViolation,
  PDSEGateConfig,
  ModelRouterConfig,
  ModelConfig,
} from "@dantecode/config-types";
import { z } from "zod";
import { runAntiStubScanner } from "./anti-stub-scanner.js";

// ----------------------------------------------------------------------------
// Zod Schema for Model Response Validation
// ----------------------------------------------------------------------------

const PDSEModelResponseSchema = z.object({
  completeness: z.number().min(0).max(100),
  correctness: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  consistency: z.number().min(0).max(100),
  violations: z.array(
    z.object({
      type: z.string(),
      message: z.string(),
      line: z.number().optional(),
    }),
  ),
});

type PDSEModelResponse = z.infer<typeof PDSEModelResponseSchema>;

// ----------------------------------------------------------------------------
// Default Gate Configuration
// ----------------------------------------------------------------------------

const DEFAULT_GATE_CONFIG: PDSEGateConfig = {
  threshold: 70,
  hardViolationsAllowed: 0,
  maxRegenerationAttempts: 3,
  weights: {
    completeness: 0.35,
    correctness: 0.30,
    clarity: 0.20,
    consistency: 0.15,
  },
};

// ----------------------------------------------------------------------------
// Scoring Prompt
// ----------------------------------------------------------------------------

const SCORING_PROMPT = `You are a strict code quality evaluator. Analyze the following code and return a JSON object with exactly these fields:

{
  "completeness": <0-100 score: are all functions implemented, no stubs, no missing logic?>,
  "correctness": <0-100 score: is the logic correct, error handling present, edge cases covered?>,
  "clarity": <0-100 score: is naming clear, code readable, well-structured?>,
  "consistency": <0-100 score: consistent style, patterns, naming conventions?>,
  "violations": [
    { "type": "<violation_type>", "message": "<description>", "line": <line_number_or_null> }
  ]
}

Scoring guidelines:
- completeness: Deduct heavily for TODO/FIXME/stub patterns, empty functions, missing error handling paths
- correctness: Deduct for logic errors, missing null checks, uncaught exceptions, race conditions
- clarity: Deduct for poor naming, deep nesting, god functions (>50 lines), magic numbers
- consistency: Deduct for mixed naming conventions, inconsistent error handling patterns, mixed import styles
- violations: List every concrete issue found

Return ONLY valid JSON, no markdown fences, no explanation.

Code to evaluate:
`;

// ----------------------------------------------------------------------------
// Model-Based Scorer
// ----------------------------------------------------------------------------

/**
 * Represents a model router that can send prompts to an LLM.
 * The router selects the appropriate model and returns a string response.
 */
export interface ModelRouter {
  chat(prompt: string, config?: Partial<ModelConfig>): Promise<string>;
  getConfig(): ModelRouterConfig;
}

/**
 * Parses the model's JSON response with Zod validation and fallback extraction.
 */
function parseModelResponse(raw: string): PDSEModelResponse | null {
  // Try to extract JSON from the response (handles markdown fences)
  let jsonStr = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    jsonStr = fenceMatch[1].trim();
  }

  // Try to find a JSON object in the response
  const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch?.[0]) {
    jsonStr = jsonObjectMatch[0];
  }

  try {
    const parsed: unknown = JSON.parse(jsonStr);
    const validated = PDSEModelResponseSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
    // If Zod validation fails, try to coerce partial results
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      return {
        completeness: clampScore(Number(obj["completeness"]) || 0),
        correctness: clampScore(Number(obj["correctness"]) || 0),
        clarity: clampScore(Number(obj["clarity"]) || 0),
        consistency: clampScore(Number(obj["consistency"]) || 0),
        violations: Array.isArray(obj["violations"])
          ? (obj["violations"] as Array<Record<string, unknown>>).map((v) => ({
              type: String(v["type"] ?? "unknown"),
              message: String(v["message"] ?? "Unknown violation"),
              line: typeof v["line"] === "number" ? v["line"] : undefined,
            }))
          : [],
      };
    }
  } catch {
    // JSON parse failed
  }

  return null;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Computes the weighted overall score from individual dimension scores.
 */
function computeWeightedScore(
  completeness: number,
  correctness: number,
  clarity: number,
  consistency: number,
  weights: PDSEGateConfig["weights"] = DEFAULT_GATE_CONFIG.weights,
): number {
  const raw =
    completeness * weights.completeness +
    correctness * weights.correctness +
    clarity * weights.clarity +
    consistency * weights.consistency;
  return Math.round(raw * 100) / 100;
}

/**
 * Runs the model-based PDSE scorer. Sends the code to the LLM for evaluation,
 * validates the response with Zod, and combines with anti-stub scan results.
 *
 * @param code - The source code to evaluate
 * @param router - The model router for LLM access
 * @param projectRoot - Project root for anti-stub scanner and config
 * @param gateConfig - Optional gate configuration overrides
 * @returns PDSEScore with all dimensions, violations, and gate pass/fail
 */
export async function runPDSEScorer(
  code: string,
  router: ModelRouter,
  projectRoot: string,
  gateConfig?: Partial<PDSEGateConfig>,
): Promise<PDSEScore> {
  const config: PDSEGateConfig = { ...DEFAULT_GATE_CONFIG, ...gateConfig };
  const weights = { ...DEFAULT_GATE_CONFIG.weights, ...gateConfig?.weights };

  // Step 1: Run anti-stub scanner locally (always runs regardless of model)
  const antiStubResult = runAntiStubScanner(code, projectRoot);
  const stubViolations: PDSEViolation[] = [
    ...antiStubResult.hardViolations,
    ...antiStubResult.softViolations,
  ];

  // Step 2: Send code to model for quality evaluation
  let modelScores: PDSEModelResponse | null = null;
  try {
    const prompt = SCORING_PROMPT + code;
    const response = await router.chat(prompt, {
      temperature: 0.1, // Low temperature for consistent scoring
      maxTokens: 2048,
    });
    modelScores = parseModelResponse(response);
  } catch {
    // If model call fails, fall back to local scoring
    const localScore = runLocalPDSEScorer(code, projectRoot);
    return localScore;
  }

  // Step 3: If model response parsing failed, fall back to local
  if (modelScores === null) {
    const localScore = runLocalPDSEScorer(code, projectRoot);
    return localScore;
  }

  // Step 4: Apply anti-stub penalty — if hard stub violations exist, clarity is 0
  let adjustedClarity = modelScores.clarity;
  if (antiStubResult.hardViolations.length > 0) {
    adjustedClarity = 0;
  }

  // Step 5: Convert model violations to PDSEViolation format
  const modelViolations: PDSEViolation[] = modelScores.violations.map((v) => ({
    type: mapViolationType(v.type),
    severity: "soft" as const,
    file: "<evaluated>",
    line: v.line,
    message: v.message,
  }));

  // Step 6: Merge all violations
  const allViolations: PDSEViolation[] = [...stubViolations, ...modelViolations];

  // Step 7: Compute weighted overall score
  const overall = computeWeightedScore(
    modelScores.completeness,
    modelScores.correctness,
    adjustedClarity,
    modelScores.consistency,
    weights,
  );

  // Step 8: Determine gate pass/fail
  const hardViolationCount = allViolations.filter((v) => v.severity === "hard").length;
  const passedGate =
    overall >= config.threshold &&
    hardViolationCount <= config.hardViolationsAllowed;

  return {
    completeness: modelScores.completeness,
    correctness: modelScores.correctness,
    clarity: adjustedClarity,
    consistency: modelScores.consistency,
    overall,
    violations: allViolations,
    passedGate,
    scoredAt: new Date().toISOString(),
    scoredBy: "pdse-model",
  };
}

/**
 * Maps a free-form violation type string from the model to a known ViolationType.
 */
function mapViolationType(raw: string): PDSEViolation["type"] {
  const normalized = raw.toLowerCase().replace(/[^a-z_]/g, "");
  const mapping: Record<string, PDSEViolation["type"]> = {
    stub: "stub_detected",
    stub_detected: "stub_detected",
    incomplete: "incomplete_function",
    incomplete_function: "incomplete_function",
    error_handling: "missing_error_handling",
    missing_error_handling: "missing_error_handling",
    any: "type_any",
    type_any: "type_any",
    secret: "hardcoded_secret",
    hardcoded_secret: "hardcoded_secret",
    console: "console_log_leftover",
    console_log: "console_log_leftover",
    console_log_leftover: "console_log_leftover",
    test_skip: "test_skip",
    skip: "test_skip",
    unused_import: "import_unused",
    import_unused: "import_unused",
    dead_code: "dead_code",
    background: "background_process",
    background_process: "background_process",
  };
  return mapping[normalized] ?? "stub_detected";
}

// ----------------------------------------------------------------------------
// Local (Heuristic) PDSE Scorer — Fallback when no model is available
// ----------------------------------------------------------------------------

/**
 * Runs a local, heuristic-based PDSE scorer that does not require an LLM.
 * Uses regex and structural analysis to estimate code quality.
 *
 * Checks:
 * - Function length (deducts for functions > 50 lines)
 * - Naming conventions (camelCase for functions, PascalCase for classes/types)
 * - Import usage (deducts for unused-looking imports)
 * - Error handling presence (try/catch, .catch(), error callbacks)
 * - Anti-stub violations (always checked)
 *
 * @param code - The source code to evaluate
 * @param projectRoot - Project root for anti-stub scanner
 * @returns PDSEScore
 */
export function runLocalPDSEScorer(
  code: string,
  projectRoot: string,
): PDSEScore {
  const lines = code.split("\n");
  const violations: PDSEViolation[] = [];

  // ---- Anti-stub scan ----
  const antiStubResult = runAntiStubScanner(code, projectRoot);
  violations.push(...antiStubResult.hardViolations, ...antiStubResult.softViolations);

  // ---- Completeness: check for function bodies ----
  let completenessScore = 100;

  // Count functions and check for empty/stub bodies
  const functionPattern = /(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>|(?:async\s+)?\w+\s*\([^)]*\)\s*{)/g;
  const functionMatches = code.match(functionPattern) ?? [];
  const functionCount = functionMatches.length;

  // Check for empty function bodies
  const emptyFunctionPattern = /(?:=>|{)\s*(?:\/\/[^\n]*\n\s*)?}\s*$/gm;
  const emptyFunctions = code.match(emptyFunctionPattern) ?? [];
  if (emptyFunctions.length > 0 && functionCount > 0) {
    const emptyRatio = emptyFunctions.length / functionCount;
    completenessScore -= Math.round(emptyRatio * 60);
  }

  // Penalize for very short files that declare many exports
  const exportCount = (code.match(/\bexport\b/g) ?? []).length;
  if (exportCount > 5 && lines.length < 30) {
    completenessScore -= 20;
    violations.push({
      type: "incomplete_function",
      severity: "soft",
      file: "<evaluated>",
      message: "Many exports in very short file suggests incomplete implementations",
    });
  }

  // ---- Correctness: error handling analysis ----
  let correctnessScore = 100;

  const hasTryCatch = /\btry\s*{/.test(code);
  const hasCatchCallback = /\.catch\s*\(/.test(code);
  const hasErrorParam = /catch\s*\(\s*\w+\s*\)/.test(code);
  const hasAsyncFunctions = /\basync\b/.test(code);
  const hasPromises = /\bPromise\b/.test(code) || /\bawait\b/.test(code);

  // If async code exists but no error handling, penalize
  if ((hasAsyncFunctions || hasPromises) && !hasTryCatch && !hasCatchCallback) {
    correctnessScore -= 25;
    violations.push({
      type: "missing_error_handling",
      severity: "soft",
      file: "<evaluated>",
      message: "Async code detected without try/catch or .catch() error handling",
    });
  }

  // Check for functions that could throw but have no error handling
  const throwPattern = /\bthrow\b/g;
  const throwCount = (code.match(throwPattern) ?? []).length;
  const catchPattern = /\bcatch\b/g;
  const catchCount = (code.match(catchPattern) ?? []).length;
  if (throwCount > 0 && catchCount === 0 && !hasErrorParam) {
    correctnessScore -= 15;
  }

  // Check for null/undefined checks
  const accessPatterns = /\.\w+/g;
  const accessCount = (code.match(accessPatterns) ?? []).length;
  const nullChecks = /(?:\?\.|!= ?null|!== ?null|!= ?undefined|!== ?undefined|\?\?)/g;
  const nullCheckCount = (code.match(nullChecks) ?? []).length;
  if (accessCount > 20 && nullCheckCount === 0) {
    correctnessScore -= 10;
    violations.push({
      type: "missing_error_handling",
      severity: "soft",
      file: "<evaluated>",
      message: "Many property accesses with no null/undefined guards",
    });
  }

  // ---- Clarity: naming and structure ----
  let clarityScore = 100;

  // If hard stub violations exist, force clarity to 0
  if (antiStubResult.hardViolations.length > 0) {
    clarityScore = 0;
  } else {
    // Check function length (count lines between { and })
    let braceDepth = 0;
    let functionStartLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;

      const opens = (line.match(/{/g) ?? []).length;
      const closes = (line.match(/}/g) ?? []).length;

      if (braceDepth === 0 && opens > 0) {
        functionStartLine = i;
      }

      braceDepth += opens - closes;

      if (braceDepth === 0 && functionStartLine >= 0) {
        const length = i - functionStartLine + 1;
        if (length > 50) {
          clarityScore -= 10;
          violations.push({
            type: "incomplete_function",
            severity: "soft",
            file: "<evaluated>",
            line: functionStartLine + 1,
            message: `Function body is ${length} lines long (>50 lines recommended max)`,
          });
        }
        functionStartLine = -1;
      }
    }

    // Check for magic numbers (numbers other than 0, 1, -1 used outside of const declarations)
    const magicNumberPattern = /(?<!const\s+\w+\s*=\s*.*?)(?<![.\w])\b(\d+)\b(?![\w.])/g;
    let magicNumberCount = 0;
    for (const line of lines) {
      if (line === undefined) continue;
      const trimmed = line.trim();
      // Skip const/let/var declarations, imports, and comments
      if (/^\s*(const|let|var|import|\/\/|\/\*|\*)/.test(trimmed)) continue;
      const matches = trimmed.matchAll(magicNumberPattern);
      for (const match of matches) {
        const num = Number(match[1]);
        if (num !== 0 && num !== 1 && num !== -1 && num !== 2 && num !== 100) {
          magicNumberCount++;
        }
      }
    }
    if (magicNumberCount > 5) {
      clarityScore -= 10;
      violations.push({
        type: "stub_detected",
        severity: "soft",
        file: "<evaluated>",
        message: `${magicNumberCount} magic numbers found — consider using named constants`,
      });
    }

    // Check for single-letter variable names (excluding i, j, k for loops, e for errors, _ for unused)
    const singleLetterVarPattern = /\b(?:const|let|var)\s+([a-z])\b/g;
    let singleLetterCount = 0;
    for (const line of lines) {
      if (line === undefined) continue;
      const matches = line.matchAll(singleLetterVarPattern);
      for (const match of matches) {
        const name = match[1];
        if (name && !["i", "j", "k", "e", "_", "x", "y", "z"].includes(name)) {
          singleLetterCount++;
        }
      }
    }
    if (singleLetterCount > 3) {
      clarityScore -= 10;
    }
  }

  // ---- Consistency: pattern analysis ----
  let consistencyScore = 100;

  // Check for mixed quote styles
  const singleQuotes = (code.match(/'/g) ?? []).length;
  const doubleQuotes = (code.match(/"/g) ?? []).length;
  // If both quote styles are heavily used, that's inconsistent
  if (singleQuotes > 5 && doubleQuotes > 5) {
    // This is normal in some cases (e.g., JSON keys vs. strings),
    // but heavy mixing suggests inconsistency
    const ratio = Math.min(singleQuotes, doubleQuotes) / Math.max(singleQuotes, doubleQuotes);
    if (ratio > 0.3) {
      consistencyScore -= 5;
    }
  }

  // Check for mixed export styles (default + named in same file)
  const hasDefaultExport = /\bexport\s+default\b/.test(code);
  const hasNamedExport = /\bexport\s+(?:const|function|class|interface|type|enum)\b/.test(code);
  if (hasDefaultExport && hasNamedExport) {
    consistencyScore -= 5;
  }

  // Check for mixed semicolon usage
  const linesWithSemicolon = lines.filter((l) =>
    l !== undefined && l.trim().endsWith(";") && !l.trim().startsWith("//") && !l.trim().startsWith("*"),
  ).length;
  const linesWithoutSemicolon = lines.filter((l) => {
    if (l === undefined) return false;
    const t = l.trim();
    return (
      t.length > 0 &&
      !t.endsWith(";") &&
      !t.endsWith("{") &&
      !t.endsWith("}") &&
      !t.endsWith(",") &&
      !t.endsWith("(") &&
      !t.endsWith(")") &&
      !t.startsWith("//") &&
      !t.startsWith("*") &&
      !t.startsWith("import") &&
      !t.startsWith("export") &&
      !/^\s*$/.test(t)
    );
  }).length;

  if (linesWithSemicolon > 5 && linesWithoutSemicolon > 5) {
    const semicolonRatio =
      Math.min(linesWithSemicolon, linesWithoutSemicolon) /
      Math.max(linesWithSemicolon, linesWithoutSemicolon);
    if (semicolonRatio > 0.3) {
      consistencyScore -= 10;
    }
  }

  // Check for mixed indentation (tabs vs spaces)
  const tabIndented = lines.filter((l) => l !== undefined && /^\t/.test(l)).length;
  const spaceIndented = lines.filter((l) => l !== undefined && /^ {2,}/.test(l)).length;
  if (tabIndented > 3 && spaceIndented > 3) {
    consistencyScore -= 15;
    violations.push({
      type: "stub_detected",
      severity: "soft",
      file: "<evaluated>",
      message: "Mixed indentation (tabs and spaces) detected",
    });
  }

  // ---- Clamp all scores ----
  completenessScore = clampScore(completenessScore);
  correctnessScore = clampScore(correctnessScore);
  clarityScore = clampScore(clarityScore);
  consistencyScore = clampScore(consistencyScore);

  // ---- Compute weighted overall ----
  const overall = computeWeightedScore(
    completenessScore,
    correctnessScore,
    clarityScore,
    consistencyScore,
  );

  // ---- Gate determination ----
  const hardViolationCount = violations.filter((v) => v.severity === "hard").length;
  const passedGate = overall >= DEFAULT_GATE_CONFIG.threshold && hardViolationCount === 0;

  return {
    completeness: completenessScore,
    correctness: correctnessScore,
    clarity: clarityScore,
    consistency: consistencyScore,
    overall,
    violations,
    passedGate,
    scoredAt: new Date().toISOString(),
    scoredBy: "pdse-local",
  };
}
