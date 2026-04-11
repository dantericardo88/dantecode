import { PDSEViolation, AutoforgeIteration, PDSEScore, BladeAutoforgeConfig, BladeProgressState, GStackResult, LessonType, ModelConfig, ModelRouterConfig, Lesson, LessonsQuery, LessonSeverity, AutoforgeConfig, GStackCommand, PDSEGateConfig } from '@dantecode/config-types';

type Database = Record<string, never>;
interface StubPattern {
    regex: RegExp;
    message: string;
    violationType: PDSEViolation["type"];
    excludeExtensions?: string[];
}
interface AntiStubScanResult {
    hardViolations: PDSEViolation[];
    softViolations: PDSEViolation[];
    passed: boolean;
    scannedLines: number;
    filePath?: string;
}
declare const HARD_VIOLATION_PATTERNS: StubPattern[];
declare const SOFT_VIOLATION_PATTERNS: StubPattern[];
declare function runAntiStubScanner(content: string, _projectRoot: string, filePath?: string): AntiStubScanResult;
declare function scanFile(filePath: string, projectRoot: string): AntiStubScanResult;
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
declare const CREDENTIAL_PATTERNS: ConstitutionPattern[];
declare const BACKGROUND_PROCESS_PATTERNS: ConstitutionPattern[];
declare const DANGEROUS_OPERATION_PATTERNS: ConstitutionPattern[];
declare const ALL_PATTERNS: ConstitutionPattern[];
declare function runConstitutionCheck(code: string, filePath?: string): ConstitutionCheckResult;
interface ModelRouter {
    chat(prompt: string, config?: Partial<ModelConfig>): Promise<string>;
    getConfig(): ModelRouterConfig;
}
declare function runPDSEScorer(code: string, _router: ModelRouter, projectRoot: string, gateConfig?: Partial<PDSEGateConfig>): Promise<PDSEScore>;
declare function runLocalPDSEScorer(code: string, projectRoot: string): PDSEScore;
declare function runGStackSingle(command: GStackCommand, projectRoot: string): Promise<GStackResult>;
declare function runGStack(_code: string, commands: GStackCommand[], projectRoot: string): Promise<GStackResult[]>;
declare function allGStackPassed(results: GStackResult[]): boolean;
declare function summarizeGStackResults(results: GStackResult[]): string;
declare function initLessonsDB(_projectRoot: string): Promise<Database>;
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
declare function generateProgressBar(percentComplete: number): string;
declare function formatBladeProgressLine(state: BladeProgressState): string;
interface AutoforgeResult {
    finalCode: string;
    iterations: number;
    succeeded: boolean;
    iterationHistory: AutoforgeIteration[];
    finalScore: PDSEScore | null;
    totalDurationMs: number;
    terminationReason: "passed" | "max_iterations" | "constitution_violation" | "error";
}
interface AutoforgeContext {
    taskDescription: string;
    filePath?: string;
    language?: string;
    framework?: string;
    additionalContext?: string;
}
declare function buildFailureContext(currentCode: string, score: PDSEScore | null, gstackResults: GStackResult[], lessons: Lesson[], context: AutoforgeContext): string;
declare function runAutoforgeIAL(code: string, context: AutoforgeContext, config: AutoforgeConfig, router: ModelRouter, projectRoot: string, onProgress?: (state: BladeProgressState) => void): Promise<AutoforgeResult>;
declare class BladeProgressEmitter {
    private readonly _config;
    private readonly _emit;
    private _currentPhase;
    private _lastPdseScore;
    private _estimatedCostUsd;
    private _currentTask;
    constructor(_config: BladeAutoforgeConfig, _emit: (state: BladeProgressState) => void);
    onIterationStart(iteration: number): void;
    onToolRound(round: number, toolName: string): void;
    onGStackResult(result: GStackResult): void;
    onPDSEScore(score: PDSEScore): void;
    onCostUpdate(costUsd: number): void;
    onComplete(result: AutoforgeResult): void;
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
declare function detectPatterns(messages: ConversationMessage[]): DetectedPattern[];
declare function detectAndRecordPatterns(messages: ConversationMessage[], projectRoot: string): Promise<Lesson[]>;

export { ALL_PATTERNS, type AntiStubScanResult, type AutoforgeContext, type AutoforgeResult, BACKGROUND_PROCESS_PATTERNS, BladeProgressEmitter, ALL_PATTERNS as CONSTITUTION_PATTERNS, CREDENTIAL_PATTERNS, type ConstitutionCheckResult, type ConstitutionSeverity, type ConstitutionViolation, type ConstitutionViolationType, type ConversationMessage, DANGEROUS_OPERATION_PATTERNS, type DetectedPattern, HARD_VIOLATION_PATTERNS, type ModelRouter, SOFT_VIOLATION_PATTERNS, type StubPattern, allGStackPassed, buildFailureContext, clearLessons, deleteLesson, detectAndRecordPatterns, detectPatterns, formatBladeProgressLine, formatLessonsForPrompt, generateProgressBar, getLessonCount, initLessonsDB, queryLessons, recordLesson, recordPreference, recordSuccessPattern, runAntiStubScanner, runAutoforgeIAL, runConstitutionCheck, runGStack, runGStackSingle, runLocalPDSEScorer, runPDSEScorer, scanFile, summarizeGStackResults };
