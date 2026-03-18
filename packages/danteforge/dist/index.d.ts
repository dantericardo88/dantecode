import { PDSEViolation, ModelConfig, ModelRouterConfig, PDSEScore, PDSEGateConfig, GStackResult, GStackCommand, Lesson, LessonsQuery, LessonType, LessonSeverity, AutoforgeIteration, BladeProgressState, AutoforgeConfig, BladeAutoforgeConfig } from '@dantecode/config-types';
import { Database } from 'sql.js';

interface StubPattern {
    regex: RegExp;
    message: string;
    violationType: PDSEViolation["type"];
}
/**
 * Hard violations are blocking — code must not contain these patterns.
 * Any hard violation causes the anti-stub scan to fail.
 */
declare const HARD_VIOLATION_PATTERNS: StubPattern[];
/**
 * Soft violations are warnings — they do not block but are flagged for review.
 */
declare const SOFT_VIOLATION_PATTERNS: StubPattern[];
interface AntiStubScanResult {
    hardViolations: PDSEViolation[];
    softViolations: PDSEViolation[];
    passed: boolean;
    scannedLines: number;
    filePath?: string;
}
/**
 * Scans code content for stub violations against all known patterns.
 *
 * @param content - The source code content to scan
 * @param projectRoot - The project root for loading custom patterns
 * @param filePath - Optional file path for violation reporting
 * @returns AntiStubScanResult with hard/soft violations and pass/fail status
 */
declare function runAntiStubScanner(content: string, projectRoot: string, filePath?: string): AntiStubScanResult;
/**
 * Reads a file from disk and runs the anti-stub scanner on its contents.
 *
 * @param filePath - Absolute or relative path to the file
 * @param projectRoot - The project root for loading custom patterns
 * @returns AntiStubScanResult
 * @throws If the file cannot be read
 */
declare function scanFile(filePath: string, projectRoot: string): AntiStubScanResult;

/**
 * Represents a model router that can send prompts to an LLM.
 * The router selects the appropriate model and returns a string response.
 */
interface ModelRouter {
    chat(prompt: string, config?: Partial<ModelConfig>): Promise<string>;
    getConfig(): ModelRouterConfig;
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
declare function runPDSEScorer(code: string, router: ModelRouter, projectRoot: string, gateConfig?: Partial<PDSEGateConfig>): Promise<PDSEScore>;
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
declare function runLocalPDSEScorer(code: string, projectRoot: string): PDSEScore;

/**
 * Runs a single GStack command as a child process, capturing stdout, stderr,
 * exit code, and duration. Respects the command's timeout — kills the process
 * if it exceeds timeoutMs.
 *
 * @param command - The GStackCommand to execute
 * @param projectRoot - Working directory for the process
 * @returns GStackResult with captured output and pass/fail status
 */
declare function runGStackSingle(command: GStackCommand, projectRoot: string): Promise<GStackResult>;
/**
 * Executes an array of GStack commands sequentially, collecting results.
 * Each command runs after the previous one completes. If a hard-failure
 * command fails, subsequent commands still execute (for full diagnostics).
 *
 * @param code - The code being tested (unused directly but included for context)
 * @param commands - Array of GStackCommand definitions
 * @param projectRoot - Working directory for all commands
 * @returns Array of GStackResult for each command
 */
declare function runGStack(_code: string, commands: GStackCommand[], projectRoot: string): Promise<GStackResult[]>;
/**
 * Returns true if every GStack result passed.
 */
declare function allGStackPassed(results: GStackResult[]): boolean;
/**
 * Returns a summary string of GStack results for logging.
 */
declare function summarizeGStackResults(results: GStackResult[]): string;

declare function initLessonsDB(projectRoot: string): Promise<Database>;
declare function recordLesson(lesson: Omit<Lesson, "id" | "type"> & {
    id?: string;
    type?: LessonType;
}, projectRoot: string): Promise<Lesson>;
declare function recordSuccessPattern(lesson: Omit<Lesson, "id" | "type" | "projectRoot" | "severity" | "source"> & {
    projectRoot?: string;
    severity?: LessonSeverity;
    source?: Lesson["source"];
}, projectRoot: string): Promise<Lesson>;
declare function recordPreference(lesson: Omit<Lesson, "id" | "type" | "projectRoot" | "severity" | "source"> & {
    projectRoot?: string;
    severity?: LessonSeverity;
    source?: Lesson["source"];
}, projectRoot: string): Promise<Lesson>;
declare function queryLessons(query: LessonsQuery): Promise<Lesson[]>;
declare function getLessonCount(projectRoot: string): Promise<number>;
declare function deleteLesson(lessonId: string, projectRoot: string): Promise<boolean>;
declare function clearLessons(projectRoot: string): Promise<number>;
declare function formatLessonsForPrompt(lessons: Lesson[]): string;

/**
 * Generates a 10-block unicode progress bar string.
 * Example: percentComplete=65 → "██████░░░░"
 */
declare function generateProgressBar(percentComplete: number): string;
/**
 * Formats a BladeProgressState into the canonical single-line status string.
 * Output: "Autoforge Phase 2/5  [██████░░░░]  62%  •  PDSE 91  •  Est. $0.003"
 */
declare function formatBladeProgressLine(state: BladeProgressState): string;
interface AutoforgeResult {
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
interface AutoforgeContext {
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
declare function buildFailureContext(currentCode: string, score: PDSEScore | null, gstackResults: GStackResult[], lessons: Lesson[], context: AutoforgeContext): string;
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
declare function runAutoforgeIAL(code: string, context: AutoforgeContext, config: AutoforgeConfig, router: ModelRouter, projectRoot: string, onProgress?: (state: BladeProgressState) => void): Promise<AutoforgeResult>;

/**
 * BladeProgressEmitter encapsulates the Blade v1.2 progress UX.
 * Wraps an AutoforgeConfig and emits BladeProgressState events to the provided
 * emit callback on every significant lifecycle event.
 *
 * Usage:
 *   const emitter = new BladeProgressEmitter(config, (state) => postMessage(state));
 *   emitter.onIterationStart(1);
 *   emitter.onPDSEScore(score);
 *   emitter.onComplete(result);
 */
declare class BladeProgressEmitter {
    private readonly _config;
    private readonly _emit;
    private _currentPhase;
    private _lastPdseScore;
    private _estimatedCostUsd;
    private _currentTask;
    constructor(config: BladeAutoforgeConfig, emit: (state: BladeProgressState) => void);
    /** Called when a new autoforge iteration begins. */
    onIterationStart(iteration: number): void;
    /** Called after each tool round completes. */
    onToolRound(round: number, toolName: string): void;
    /** Called with GStack results after each GStack run. */
    onGStackResult(result: GStackResult): void;
    /** Called after PDSE scoring completes. */
    onPDSEScore(score: PDSEScore): void;
    /** Called with cost update from ModelRouterImpl. */
    onCostUpdate(costUsd: number): void;
    /** Called when the autoforge run completes (pass or fail). */
    onComplete(result: AutoforgeResult): void;
    /** Returns the formatted single-line progress string. */
    getProgressLine(): string;
    private _getTotalPhases;
    private _buildState;
    private _emitState;
}

interface ConversationMessage {
    role: "user" | "assistant" | "system";
    content: string;
}
interface DetectedPattern {
    pattern: string;
    correction: string;
    language?: string;
    framework?: string;
    source: "memory-detector";
    type: LessonType;
}
/**
 * Analyze conversation messages and extract preference patterns.
 * Focuses on user corrections, naming conventions, framework preferences,
 * and tool chain choices.
 */
declare function detectPatterns(messages: ConversationMessage[]): DetectedPattern[];
/**
 * Detect patterns from a conversation and persist them as lessons.
 * Skips patterns that are already recorded (avoids duplicates).
 */
declare function detectAndRecordPatterns(messages: ConversationMessage[], projectRoot: string): Promise<Lesson[]>;

type ConstitutionViolationType = "credential_exposure" | "background_process" | "dangerous_operation" | "code_injection";
type ConstitutionSeverity = "warning" | "critical";
interface ConstitutionViolation {
    type: ConstitutionViolationType;
    severity: ConstitutionSeverity;
    line?: number;
    message: string;
    pattern: string;
}
interface ConstitutionCheckResult {
    passed: boolean;
    violations: ConstitutionViolation[];
    scannedLines: number;
    filePath?: string;
}
interface ConstitutionPattern {
    regex: RegExp;
    type: ConstitutionViolationType;
    severity: ConstitutionSeverity;
    message: string;
}
/**
 * Credential exposure patterns detect hardcoded secrets, API keys, passwords,
 * and tokens in string literals or assignments.
 */
declare const CREDENTIAL_PATTERNS: ConstitutionPattern[];
/**
 * Background process patterns detect commands or code that spawns
 * detached/background processes, which could be used for persistence.
 */
declare const BACKGROUND_PROCESS_PATTERNS: ConstitutionPattern[];
/**
 * Dangerous operation patterns detect destructive commands and
 * potential code injection vectors.
 */
declare const DANGEROUS_OPERATION_PATTERNS: ConstitutionPattern[];
declare const ALL_PATTERNS: ConstitutionPattern[];
/**
 * Runs the constitution check against code content. Scans every line for
 * security violations including:
 * - Credential exposure (hardcoded API keys, passwords, tokens)
 * - Background process patterns (nohup, disown, daemon, detached)
 * - Dangerous operations (rm -rf /, DROP TABLE, eval with user input)
 * - Code injection vectors (exec with template literals, innerHTML with user input)
 *
 * @param code - The source code to check
 * @param filePath - Optional file path for violation reporting
 * @returns ConstitutionCheckResult with pass/fail and violation details
 */
declare function runConstitutionCheck(code: string, filePath?: string): ConstitutionCheckResult;

export { type AntiStubScanResult, type AutoforgeContext, type AutoforgeResult, BACKGROUND_PROCESS_PATTERNS, BladeProgressEmitter, ALL_PATTERNS as CONSTITUTION_PATTERNS, CREDENTIAL_PATTERNS, type ConstitutionCheckResult, type ConstitutionSeverity, type ConstitutionViolation, type ConstitutionViolationType, type ConversationMessage, DANGEROUS_OPERATION_PATTERNS, type DetectedPattern, HARD_VIOLATION_PATTERNS, type ModelRouter, SOFT_VIOLATION_PATTERNS, type StubPattern, allGStackPassed, buildFailureContext, clearLessons, deleteLesson, detectAndRecordPatterns, detectPatterns, formatBladeProgressLine, formatLessonsForPrompt, generateProgressBar, getLessonCount, initLessonsDB, queryLessons, recordLesson, recordPreference, recordSuccessPattern, runAntiStubScanner, runAutoforgeIAL, runConstitutionCheck, runGStack, runGStackSingle, runLocalPDSEScorer, runPDSEScorer, scanFile, summarizeGStackResults };
