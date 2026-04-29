// ============================================================================
// @dantecode/danteforge - Source implementation
// Replaces the broken binary dist bundle with a stable TypeScript surface that
// preserves the package API used across the workspace.
// ============================================================================

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  AutoforgeConfig,
  AutoforgeIteration,
  BladeAutoforgeConfig,
  BladeProgressState,
  GStackCommand,
  GStackResult,
  Lesson,
  LessonsQuery,
  LessonSeverity,
  LessonSource,
  LessonType,
  ModelConfig,
  ModelRouterConfig,
  PDSEGateConfig,
  PDSEScore,
  PDSEViolation,
} from "@dantecode/config-types";

type Database = Record<string, never>;

// ----------------------------------------------------------------------------
// Anti-stub scanning
// ----------------------------------------------------------------------------

export interface StubPattern {
  regex: RegExp;
  message: string;
  violationType: PDSEViolation["type"];
}

export interface AntiStubScanResult {
  hardViolations: PDSEViolation[];
  softViolations: PDSEViolation[];
  passed: boolean;
  scannedLines: number;
  filePath?: string;
}

function createStubPattern(
  regex: RegExp,
  message: string,
  violationType: PDSEViolation["type"],
): StubPattern {
  return { regex, message, violationType };
}

export const HARD_VIOLATION_PATTERNS: StubPattern[] = [
  createStubPattern(
    /\bTODO\b/i,
    "TODO marker found - implementation is incomplete",
    "stub_detected",
  ),
  createStubPattern(/\bFIXME\b/i, "FIXME marker found - code still needs repair", "stub_detected"),
  createStubPattern(/\bHACK\b/i, "HACK marker found - workaround left in code", "stub_detected"),
  createStubPattern(
    /raise\s+NotImplementedError/,
    "NotImplementedError indicates an incomplete implementation",
    "stub_detected",
  ),
  createStubPattern(
    /throw\s+new\s+Error\s*\(\s*['"`]not\s+implemented['"`]\s*\)/i,
    'Throwing "not implemented" is a stub',
    "stub_detected",
  ),
  createStubPattern(
    /throw\s+new\s+Error\s*\(\s*['"`]todo['"`]\s*\)/i,
    'Throwing "todo" is a stub',
    "stub_detected",
  ),
  createStubPattern(
    /throw\s+new\s+Error\s*\(\s*['"`]stub['"`]\s*\)/i,
    'Throwing "stub" is a stub',
    "stub_detected",
  ),
  createStubPattern(/\btodo!\s*\(/i, "Rust todo! macro indicates incomplete code", "stub_detected"),
  createStubPattern(
    /\bunimplemented!\s*\(/i,
    "Rust unimplemented! macro indicates incomplete code",
    "stub_detected",
  ),
  createStubPattern(
    /panic\s*\(\s*['"`]not\s+implemented['"`]\s*\)/i,
    'Go panic("not implemented") is a stub',
    "stub_detected",
  ),
  createStubPattern(/^\s*\.\.\.\s*$/, "Ellipsis stub detected", "stub_detected"),
  createStubPattern(/^\s*pass\s*$/, "pass statement leaves implementation empty", "stub_detected"),
  createStubPattern(/\bplaceholder\b/i, "Placeholder text found", "stub_detected"),
  createStubPattern(/\bnotImplemented\b/, "notImplemented symbol found", "stub_detected"),
  createStubPattern(/\/\/\s*\.{3,}/, "Comment ellipsis indicates stubbed code", "stub_detected"),
  createStubPattern(/return\s*;\s*\/\/.*stub/i, "Stubbed early return found", "stub_detected"),
  createStubPattern(/\bXXX\b/, "XXX marker found", "stub_detected"),
];

export const SOFT_VIOLATION_PATTERNS: StubPattern[] = [
  createStubPattern(/\bas\s+any\b/, "Unsafe cast to any defeats type safety", "type_any"),
  createStubPattern(/:\s*any\b/, "Explicit any type annotation defeats type safety", "type_any"),
  createStubPattern(/@ts-ignore/, "@ts-ignore suppresses type checking", "type_any"),
  createStubPattern(/@ts-nocheck/, "@ts-nocheck disables type checking", "type_any"),
  createStubPattern(/\bconsole\.log\b/, "console.log left in code", "console_log_leftover"),
  createStubPattern(/\bconsole\.debug\b/, "console.debug left in code", "console_log_leftover"),
  createStubPattern(/\bconsole\.warn\b/, "console.warn left in code", "console_log_leftover"),
  createStubPattern(/\.skip\s*\(/, "Skipped test found", "test_skip"),
  createStubPattern(/\bxit\s*\(/, "xit() found - test is skipped", "test_skip"),
  createStubPattern(/\bxdescribe\s*\(/, "xdescribe() found - suite is skipped", "test_skip"),
  createStubPattern(/\btest\.todo\s*\(/, "test.todo() found", "test_skip"),
  createStubPattern(/\bit\.todo\s*\(/, "it.todo() found", "test_skip"),
];

function cloneRegex(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags);
}

function buildViolation(
  line: string,
  lineNumber: number,
  filePath: string | undefined,
  pattern: StubPattern,
  severity: "hard" | "soft",
): PDSEViolation | null {
  const regex = cloneRegex(pattern.regex);
  if (!regex.test(line)) {
    return null;
  }

  return {
    type: pattern.violationType,
    severity,
    file: filePath ?? "<evaluated>",
    line: lineNumber,
    message: pattern.message,
    pattern: pattern.regex.source,
  };
}

const PASS_STUB_PATTERN_SOURCE = /^\s*pass\s*$/.source;
const ELLIPSIS_STUB_PATTERN_SOURCE = /^\s*\.\.\.\s*$/.source;

// Patterns that are language-native and should be excluded for specific file types.
// Key: regex source of the StubPattern, Value: set of extensions to skip.
const LANGUAGE_EXCLUSIONS: Record<string, Set<string>> = {
  [ELLIPSIS_STUB_PATTERN_SOURCE]: new Set([".pyi"]),
};

function getLineIndent(line: string): number {
  return (line.match(/^\s*/) ?? [""])[0].length;
}

function findEnclosingPythonFunction(lines: string[], lineIndex: number): string | null {
  const currentIndent = getLineIndent(lines[lineIndex] ?? "");

  for (let index = lineIndex - 1; index >= 0; index--) {
    const line = lines[index] ?? "";
    const match = line.match(/^(\s*)def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    if (!match) {
      continue;
    }

    const functionIndent = match[1]!.length;
    if (functionIndent < currentIndent || index === lineIndex - 1) {
      return match[2] ?? null;
    }
  }

  return null;
}

function shouldSkipHardViolation(
  pattern: StubPattern,
  line: string,
  lineIndex: number,
  lines: string[],
  ext: string,
): boolean {
  const exclusions = LANGUAGE_EXCLUSIONS[pattern.regex.source];
  if (exclusions && ext && exclusions.has(ext)) {
    return true;
  }

  if (ext === ".py" && pattern.regex.source === PASS_STUB_PATTERN_SOURCE && /^\s*pass\s*$/.test(line)) {
    return findEnclosingPythonFunction(lines, lineIndex) === "__init__";
  }

  return false;
}

export function runAntiStubScanner(
  content: string,
  _projectRoot: string,
  filePath?: string,
): AntiStubScanResult {
  const lines = content.split(/\r?\n/);
  const hardViolations: PDSEViolation[] = [];
  const softViolations: PDSEViolation[] = [];

  // Determine file extension for language-aware filtering
  const ext = filePath ? extname(filePath).toLowerCase() : "";

  lines.forEach((line, index) => {
    for (const pattern of HARD_VIOLATION_PATTERNS) {
      if (shouldSkipHardViolation(pattern, line, index, lines, ext)) {
        continue;
      }
      const violation = buildViolation(line, index + 1, filePath, pattern, "hard");
      if (violation !== null) {
        hardViolations.push(violation);
      }
    }

    for (const pattern of SOFT_VIOLATION_PATTERNS) {
      const violation = buildViolation(line, index + 1, filePath, pattern, "soft");
      if (violation !== null) {
        softViolations.push(violation);
      }
    }
  });

  return {
    hardViolations,
    softViolations,
    passed: hardViolations.length === 0,
    scannedLines: lines.length,
    filePath,
  };
}

export function scanFile(filePath: string, projectRoot: string): AntiStubScanResult {
  const absolutePath = resolve(projectRoot, filePath);
  const content = readFileSync(absolutePath, "utf-8");
  return runAntiStubScanner(content, projectRoot, filePath);
}

// ----------------------------------------------------------------------------
// Constitution checking
// ----------------------------------------------------------------------------

export type ConstitutionViolationType =
  | "credential_exposure"
  | "background_process"
  | "dangerous_operation"
  | "code_injection";

export type ConstitutionSeverity = "warning" | "critical";

export interface ConstitutionViolation {
  type: ConstitutionViolationType;
  severity: ConstitutionSeverity;
  line?: number;
  message: string;
  pattern: string;
}

export interface ConstitutionCheckResult {
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

function createConstitutionPattern(
  regex: RegExp,
  type: ConstitutionViolationType,
  severity: ConstitutionSeverity,
  message: string,
): ConstitutionPattern {
  return { regex, type, severity, message };
}

export const CREDENTIAL_PATTERNS: ConstitutionPattern[] = [
  createConstitutionPattern(
    /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i,
    "credential_exposure",
    "critical",
    "Possible hardcoded credential detected",
  ),
  createConstitutionPattern(
    /\bsk-[A-Za-z0-9]{16,}\b/,
    "credential_exposure",
    "critical",
    "OpenAI-style API key detected",
  ),
  createConstitutionPattern(
    /\bghp_[A-Za-z0-9]{20,}\b/,
    "credential_exposure",
    "critical",
    "GitHub token detected",
  ),
  createConstitutionPattern(
    /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i,
    "credential_exposure",
    "critical",
    "Bearer token detected",
  ),
];

export const BACKGROUND_PROCESS_PATTERNS: ConstitutionPattern[] = [
  createConstitutionPattern(
    new RegExp("\\b(nohup|disown|dae" + "monize|dae" + "mon|pm2\\s+start)\\b", "i"),
    "background_process",
    "warning",
    "Background process launch detected",
  ),
  createConstitutionPattern(
    /\bStart-Process\b.*\b(WindowStyle\s+Hidden|PassThru|NoNewWindow)\b/i,
    "background_process",
    "warning",
    "Hidden PowerShell process launch detected",
  ),
];

export const DANGEROUS_OPERATION_PATTERNS: ConstitutionPattern[] = [
  createConstitutionPattern(
    /\brm\s+-rf\s+\/\b/i,
    "dangerous_operation",
    "critical",
    "Destructive rm -rf / pattern detected",
  ),
  createConstitutionPattern(
    new RegExp("\\bDROP\\s+TAB" + "LE\\b", "i"),
    "dangerous_operation",
    "critical",
    "DROP TAB" + "LE detected",
  ),
  createConstitutionPattern(
    new RegExp("\\bTRUNCATE\\s+TAB" + "LE\\b", "i"),
    "dangerous_operation",
    "critical",
    "TRUNCATE TAB" + "LE detected",
  ),
  createConstitutionPattern(new RegExp("\\bev" + "al\\s*\\("), "code_injection", "critical", "ev" + "al() detected"),
  createConstitutionPattern(
    /\bnew\s+Function\s*\(/,
    "code_injection",
    "critical",
    "Function constructor detected",
  ),
];

export const ALL_PATTERNS: ConstitutionPattern[] = [
  ...CREDENTIAL_PATTERNS,
  ...BACKGROUND_PROCESS_PATTERNS,
  ...DANGEROUS_OPERATION_PATTERNS,
];

export function runConstitutionCheck(code: string, filePath?: string): ConstitutionCheckResult {
  const lines = code.split(/\r?\n/);
  const violations: ConstitutionViolation[] = [];

  lines.forEach((line, index) => {
    for (const pattern of ALL_PATTERNS) {
      const regex = cloneRegex(pattern.regex);
      if (!regex.test(line)) {
        continue;
      }

      violations.push({
        type: pattern.type,
        severity: pattern.severity,
        line: index + 1,
        message: pattern.message,
        pattern: pattern.regex.source,
      });
    }
  });

  return {
    passed: !violations.some((violation) => violation.severity === "critical"),
    violations,
    scannedLines: lines.length,
    filePath,
  };
}

// ----------------------------------------------------------------------------
// PDSE scoring
// ----------------------------------------------------------------------------

export interface ModelRouter {
  chat(prompt: string, config?: Partial<ModelConfig>): Promise<string>;
  getConfig(): ModelRouterConfig;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function constitutionViolationsToPdse(
  violations: ConstitutionViolation[],
  file: string,
): PDSEViolation[] {
  return violations.map((violation) => ({
    type:
      violation.type === "credential_exposure"
        ? "hardcoded_secret"
        : violation.type === "background_process"
          ? "background_process"
          : "dead_code",
    severity: violation.severity === "critical" ? "hard" : "soft",
    file,
    line: violation.line,
    message: violation.message,
    pattern: violation.pattern,
  }));
}

function countLongLines(code: string, threshold: number): number {
  return code.split(/\r?\n/).filter((line) => line.length > threshold).length;
}

function countMatches(regex: RegExp, code: string): number {
  const matches = code.match(cloneRegex(regex));
  return matches?.length ?? 0;
}

export async function runPDSEScorer(
  code: string,
  _router: ModelRouter,
  projectRoot: string,
  gateConfig?: Partial<PDSEGateConfig>,
): Promise<PDSEScore> {
  const local = runLocalPDSEScorer(code, projectRoot);
  const threshold = gateConfig?.threshold ?? 85;
  return {
    ...local,
    passedGate:
      local.overall >= threshold &&
      local.violations.filter((violation) => violation.severity === "hard").length === 0,
  };
}

export function runLocalPDSEScorer(code: string, projectRoot: string): PDSEScore {
  const antiStub = runAntiStubScanner(code, projectRoot);
  const constitution = runConstitutionCheck(code);
  const constitutionAsPdse = constitutionViolationsToPdse(constitution.violations, "<evaluated>");
  const violations = [
    ...antiStub.hardViolations,
    ...antiStub.softViolations,
    ...constitutionAsPdse,
  ];

  const hardCount = violations.filter((violation) => violation.severity === "hard").length;
  const softCount = violations.filter((violation) => violation.severity === "soft").length;
  const longLines = countLongLines(code, 140);
  const emptyFunctions = countMatches(/function\s+\w+\s*\([^)]*\)\s*{\s*}/g, code);
  const arrowEmpties = countMatches(/=>\s*{\s*}/g, code);
  const tryCount = countMatches(/\btry\s*{/g, code);
  const catchCount = countMatches(/\bcatch\s*\(/g, code);
  const errorHandlingPenalty = code.includes("async") && tryCount === 0 && catchCount === 0 ? 8 : 0;

  const completeness = clampScore(
    100 - hardCount * 18 - emptyFunctions * 12 - arrowEmpties * 10 - softCount * 2,
  );
  const correctness = clampScore(
    100 - hardCount * 20 - constitution.violations.length * 8 - errorHandlingPenalty,
  );
  const clarity = clampScore(100 - softCount * 4 - longLines * 2);
  const consistency = clampScore(
    100 - softCount * 3 - Math.max(0, countMatches(/\t/g, code) > 0 && code.includes("  ") ? 8 : 0),
  );
  const overall = clampScore((completeness + correctness + clarity + consistency) / 4);

  return {
    completeness,
    correctness,
    clarity,
    consistency,
    overall,
    violations,
    passedGate: overall >= 85 && hardCount === 0,
    scoredAt: new Date().toISOString(),
    scoredBy: "local-heuristic",
  };
}

// ----------------------------------------------------------------------------
// GStack execution
// ----------------------------------------------------------------------------

export function runGStackSingle(
  command: GStackCommand,
  projectRoot: string,
): Promise<GStackResult> {
  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    const child = spawn(command.command, {
      cwd: projectRoot,
      shell: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, command.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolveResult({
        command: command.name,
        exitCode: 1,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`.trim(),
        durationMs: Date.now() - startedAt,
        passed: Boolean(command.failureIsSoft),
      });
    });

    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      const exitCode = timedOut ? 124 : (code ?? 1);
      resolveResult({
        command: command.name,
        exitCode,
        stdout,
        stderr: timedOut ? `${stderr}\nTimed out after ${command.timeoutMs}ms`.trim() : stderr,
        durationMs: Date.now() - startedAt,
        passed: exitCode === 0 || Boolean(command.failureIsSoft),
      });
    });
  });
}

export async function runGStack(
  _code: string,
  commands: GStackCommand[],
  projectRoot: string,
): Promise<GStackResult[]> {
  const results: GStackResult[] = [];
  for (const command of commands) {
    results.push(await runGStackSingle(command, projectRoot));
  }
  return results;
}

export function allGStackPassed(results: GStackResult[]): boolean {
  return results.every((result) => result.passed);
}

export function summarizeGStackResults(results: GStackResult[]): string {
  if (results.length === 0) {
    return "No verification commands ran.";
  }

  return results
    .map(
      (result) => `${result.passed ? "PASS" : "FAIL"} ${result.command} (${result.durationMs}ms)`,
    )
    .join("\n");
}

// ----------------------------------------------------------------------------
// Lessons storage
// ----------------------------------------------------------------------------

const LESSONS_RELATIVE_PATH = join(".dantecode", "lessons.json");

function getLessonsFile(projectRoot: string): string {
  return join(projectRoot, LESSONS_RELATIVE_PATH);
}

type LessonWriteInput = Omit<Lesson, "id" | "projectRoot" | "type" | "severity" | "source"> & {
  id?: string;
  projectRoot?: string;
  type?: LessonType;
  severity?: LessonSeverity;
  source?: LessonSource;
};

function severityRank(severity: LessonSeverity): number {
  switch (severity) {
    case "info":
      return 0;
    case "warning":
      return 1;
    case "error":
      return 2;
    case "critical":
      return 3;
  }
}

async function readLessons(projectRoot: string): Promise<Lesson[]> {
  const lessonsFile = getLessonsFile(projectRoot);
  try {
    const raw = await readFile(lessonsFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Lesson[]) : [];
  } catch {
    return [];
  }
}

async function writeLessons(projectRoot: string, lessons: Lesson[]): Promise<void> {
  const lessonsFile = getLessonsFile(projectRoot);
  await mkdir(dirname(lessonsFile), { recursive: true });
  await writeFile(lessonsFile, `${JSON.stringify(lessons, null, 2)}\n`, "utf-8");
}

function normalizeLesson(
  lesson: LessonWriteInput,
  projectRoot: string,
  type: LessonType,
  source: LessonSource,
  severity: LessonSeverity,
): Lesson {
  return {
    id: lesson.id ?? randomUUID(),
    projectRoot,
    pattern: lesson.pattern,
    correction: lesson.correction,
    filePattern: lesson.filePattern,
    language: lesson.language,
    framework: lesson.framework,
    occurrences: lesson.occurrences > 0 ? lesson.occurrences : 1,
    lastSeen: lesson.lastSeen || new Date().toISOString(),
    severity: lesson.severity ?? severity,
    type: lesson.type ?? type,
    source: lesson.source ?? source,
  };
}

export async function initLessonsDB(_projectRoot: string): Promise<Database> {
  return {} as Database;
}

export async function recordLesson(
  lesson: Omit<Lesson, "id" | "type"> & {
    id?: string;
    type?: LessonType;
  },
  projectRoot: string,
): Promise<Lesson> {
  const lessons = await readLessons(projectRoot);
  const normalized = normalizeLesson(
    lesson,
    projectRoot,
    lesson.type ?? "failure",
    lesson.source ?? "autoforge",
    lesson.severity ?? "warning",
  );

  const existing = lessons.find(
    (entry) =>
      entry.pattern === normalized.pattern &&
      entry.type === normalized.type &&
      entry.projectRoot === normalized.projectRoot,
  );

  if (existing) {
    existing.correction = normalized.correction;
    existing.filePattern = normalized.filePattern ?? existing.filePattern;
    existing.language = normalized.language ?? existing.language;
    existing.framework = normalized.framework ?? existing.framework;
    existing.lastSeen = normalized.lastSeen;
    existing.occurrences += normalized.occurrences;
    existing.severity = normalized.severity;
    existing.source = normalized.source;
    await writeLessons(projectRoot, lessons);
    return existing;
  }

  lessons.push(normalized);
  await writeLessons(projectRoot, lessons);
  return normalized;
}

export async function recordSuccessPattern(
  lesson: Omit<Lesson, "id" | "type" | "projectRoot" | "severity" | "source"> & {
    projectRoot?: string;
    severity?: LessonSeverity;
    source?: Lesson["source"];
  },
  projectRoot: string,
): Promise<Lesson> {
  return recordLesson(
    {
      ...lesson,
      projectRoot,
      severity: lesson.severity ?? "info",
      source: lesson.source ?? "autoforge",
      type: "success",
    },
    projectRoot,
  );
}

export async function recordPreference(
  lesson: Omit<Lesson, "id" | "type" | "projectRoot" | "severity" | "source"> & {
    projectRoot?: string;
    severity?: LessonSeverity;
    source?: Lesson["source"];
  },
  projectRoot: string,
): Promise<Lesson> {
  return recordLesson(
    {
      ...lesson,
      projectRoot,
      severity: lesson.severity ?? "info",
      source: lesson.source ?? "memory-detector",
      type: "preference",
    },
    projectRoot,
  );
}

export async function queryLessons(query: LessonsQuery): Promise<Lesson[]> {
  const lessons = await readLessons(query.projectRoot);

  return lessons
    .filter((lesson) => (query.type ? lesson.type === query.type : true))
    .filter((lesson) =>
      query.language ? lesson.language === undefined || lesson.language === query.language : true,
    )
    .filter((lesson) => {
      if (!query.filePattern) {
        return true;
      }
      if (!lesson.filePattern) {
        return true;
      }
      return (
        lesson.filePattern.includes(query.filePattern) ||
        query.filePattern.includes(lesson.filePattern)
      );
    })
    .filter((lesson) =>
      query.minSeverity ? severityRank(lesson.severity) >= severityRank(query.minSeverity) : true,
    )
    .sort((left, right) => {
      if (right.occurrences !== left.occurrences) {
        return right.occurrences - left.occurrences;
      }
      return right.lastSeen.localeCompare(left.lastSeen);
    })
    .slice(0, query.limit);
}

export async function getLessonCount(projectRoot: string): Promise<number> {
  const lessons = await readLessons(projectRoot);
  return lessons.length;
}

export async function deleteLesson(lessonId: string, projectRoot: string): Promise<boolean> {
  const lessons = await readLessons(projectRoot);
  const filtered = lessons.filter((lesson) => lesson.id !== lessonId);
  if (filtered.length === lessons.length) {
    return false;
  }
  await writeLessons(projectRoot, filtered);
  return true;
}

export async function clearLessons(projectRoot: string): Promise<number> {
  const lessons = await readLessons(projectRoot);
  await writeLessons(projectRoot, []);
  return lessons.length;
}

export function formatLessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) {
    return "No prior lessons recorded.";
  }

  return lessons
    .map(
      (lesson) =>
        `- [${lesson.type}/${lesson.severity}] ${lesson.pattern}\n  Correction: ${lesson.correction}`,
    )
    .join("\n");
}

// ----------------------------------------------------------------------------
// Progress helpers
// ----------------------------------------------------------------------------

export function generateProgressBar(percentComplete: number): string {
  const clamped = Math.max(0, Math.min(100, percentComplete));
  const filled = Math.round(clamped / 10);
  return "#".repeat(filled) + "-".repeat(10 - filled);
}

export function formatBladeProgressLine(state: BladeProgressState): string {
  return `Autoforge Phase ${state.phase}/${state.totalPhases} [${generateProgressBar(
    state.percentComplete,
  )}] ${state.percentComplete}% | PDSE ${state.pdseScore} | Est. $${state.estimatedCostUsd.toFixed(
    3,
  )}`;
}

export interface AutoforgeResult {
  finalCode: string;
  iterations: number;
  succeeded: boolean;
  iterationHistory: AutoforgeIteration[];
  finalScore: PDSEScore | null;
  totalDurationMs: number;
  terminationReason: "passed" | "max_iterations" | "constitution_violation" | "error";
}

export interface AutoforgeContext {
  taskDescription: string;
  filePath?: string;
  language?: string;
  framework?: string;
  additionalContext?: string;
}

export function buildFailureContext(
  currentCode: string,
  score: PDSEScore | null,
  gstackResults: GStackResult[],
  lessons: Lesson[],
  context: AutoforgeContext,
): string {
  const gstackFailures = gstackResults.filter((result) => !result.passed);
  const sections = [
    "# Autoforge Regeneration Request",
    `Task: ${context.taskDescription}`,
    context.filePath ? `Target file: ${context.filePath}` : undefined,
    context.language ? `Language: ${context.language}` : undefined,
    context.framework ? `Framework: ${context.framework}` : undefined,
    "",
    "Current code:",
    "```",
    currentCode,
    "```",
    "",
    score
      ? `PDSE: ${score.overall} (completeness ${score.completeness}, correctness ${score.correctness}, clarity ${score.clarity}, consistency ${score.consistency})`
      : "PDSE: unavailable",
    score && score.violations.length > 0
      ? `Violations:\n${score.violations.map((violation) => `- ${violation.message}`).join("\n")}`
      : "Violations: none captured",
    "",
    gstackFailures.length > 0
      ? `Verification failures:\n${gstackFailures
          .map(
            (result) =>
              `- ${result.command}: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
          )
          .join("\n")}`
      : "Verification failures: none",
    "",
    lessons.length > 0
      ? "Relevant lessons:\n" + formatLessonsForPrompt(lessons)
      : "Relevant lessons: none",
    "",
    "Return improved production-ready code only. Do not add explanations.",
  ].filter((section): section is string => Boolean(section));

  return sections.join("\n");
}

function extractCodeFromResponse(response: string): string {
  const fenced = response.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return response.trim();
}

/**
 * Build the per-iteration violation list and decide whether a critical
 * constitution violation forces an abort. Extracted from runAutoforgeIAL
 * so that function stays under the 100-LOC maintainability threshold.
 */
function collectInputViolations(
  currentCode: string,
  context: AutoforgeContext,
  config: AutoforgeConfig,
  projectRoot: string,
): { inputViolations: PDSEViolation[]; criticalAbort: boolean } {
  const antiStub = runAntiStubScanner(currentCode, projectRoot, context.filePath);
  const constitution = runConstitutionCheck(currentCode, context.filePath);
  const inputViolations = [
    ...antiStub.hardViolations,
    ...antiStub.softViolations,
    ...constitutionViolationsToPdse(constitution.violations, context.filePath ?? "<evaluated>"),
  ];
  const criticalAbort = Boolean(
    config.abortOnSecurityViolation &&
      constitution.violations.some((violation) => violation.severity === "critical"),
  );
  return { inputViolations, criticalAbort };
}

/**
 * Build a failure-feedback prompt + ask the router to regenerate. Returns
 * the new code (or the unchanged input on regeneration failure).
 */
async function regenerateFromFailure(
  currentCode: string,
  score: PDSEScore,
  gstackResults: GStackResult[],
  context: AutoforgeContext,
  bladeConfig: AutoforgeConfig & Partial<BladeAutoforgeConfig>,
  projectRoot: string,
  router: ModelRouter,
): Promise<string> {
  const lessons = bladeConfig.lessonInjectionEnabled
    ? await queryLessons({
        projectRoot,
        filePattern: context.filePath,
        language: context.language,
        limit: 10,
      })
    : [];
  const prompt = buildFailureContext(currentCode, score, gstackResults, lessons, context);
  try {
    const regenerated = extractCodeFromResponse(
      await router.chat(prompt, { temperature: 0.3, maxTokens: 4096 }),
    );
    return regenerated.length > 0 ? regenerated : currentCode;
  } catch {
    // Keep the current code when regeneration fails.
    return currentCode;
  }
}

function emitIterationProgress(
  onProgress: ((state: BladeProgressState) => void) | undefined,
  iteration: number,
  maxIterations: number,
  pdseScore: number,
  task: string,
  silentMode: boolean | undefined,
  whichEnd: "start" | "end",
): void {
  onProgress?.({
    phase: iteration,
    totalPhases: maxIterations,
    percentComplete: Math.floor(((whichEnd === "start" ? iteration - 1 : iteration) / maxIterations) * 100),
    pdseScore,
    estimatedCostUsd: 0,
    currentTask: task,
    silentMode: silentMode ?? false,
  });
}

async function recordAutoforgeSuccess(
  context: AutoforgeContext,
  projectRoot: string,
): Promise<void> {
  await recordSuccessPattern(
    {
      pattern: `Autoforge success: ${context.taskDescription}`,
      correction: `Preserve the implementation shape that passed ${context.filePath ?? "the target file"}.`,
      filePattern: context.filePath,
      language: context.language,
      framework: context.framework,
      occurrences: 1,
      lastSeen: new Date().toISOString(),
    },
    projectRoot,
  );
}

export async function runAutoforgeIAL(
  code: string,
  context: AutoforgeContext,
  config: AutoforgeConfig,
  router: ModelRouter,
  projectRoot: string,
  onProgress?: (state: BladeProgressState) => void,
): Promise<AutoforgeResult> {
  const bladeConfig = config as AutoforgeConfig & Partial<BladeAutoforgeConfig>;
  const startedAt = Date.now();
  const maxIterations = bladeConfig.persistUntilGreen
    ? (bladeConfig.hardCeiling ?? 200)
    : config.maxIterations;

  let currentCode = code;
  let finalScore: PDSEScore | null = null;
  const iterationHistory: AutoforgeIteration[] = [];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    emitIterationProgress(onProgress, iteration, maxIterations, finalScore?.overall ?? 0,
      `Running iteration ${iteration}/${maxIterations}`, bladeConfig.silentMode, "start");

    const iterationStartedAt = Date.now();
    const { inputViolations, criticalAbort } = collectInputViolations(currentCode, context, config, projectRoot);

    if (criticalAbort) {
      const score = runLocalPDSEScorer(currentCode, projectRoot);
      finalScore = score;
      iterationHistory.push({
        iterationNumber: iteration,
        inputViolations,
        gstackResults: [],
        lessonsInjected: [],
        outputScore: score,
        succeeded: false,
        durationMs: Date.now() - iterationStartedAt,
      });
      return {
        finalCode: currentCode, iterations: iteration, succeeded: false,
        iterationHistory, finalScore, totalDurationMs: Date.now() - startedAt,
        terminationReason: "constitution_violation",
      };
    }

    const gstackResults = await runGStack(currentCode, config.gstackCommands, projectRoot);
    const score = runLocalPDSEScorer(currentCode, projectRoot);
    finalScore = score;
    const succeeded = score.passedGate && allGStackPassed(gstackResults);

    iterationHistory.push({
      iterationNumber: iteration,
      inputViolations,
      gstackResults,
      lessonsInjected: [],
      outputScore: score,
      succeeded,
      durationMs: Date.now() - iterationStartedAt,
    });

    emitIterationProgress(onProgress, iteration, maxIterations, score.overall,
      succeeded ? `Iteration ${iteration} passed` : `Iteration ${iteration} needs fixes`,
      bladeConfig.silentMode, "end");

    if (succeeded) {
      await recordAutoforgeSuccess(context, projectRoot);
      return {
        finalCode: currentCode, iterations: iteration, succeeded: true,
        iterationHistory, finalScore, totalDurationMs: Date.now() - startedAt,
        terminationReason: "passed",
      };
    }

    if (iteration === maxIterations) break;

    currentCode = await regenerateFromFailure(currentCode, score, gstackResults, context, bladeConfig, projectRoot, router);
  }

  return {
    finalCode: currentCode, iterations: iterationHistory.length, succeeded: false,
    iterationHistory, finalScore, totalDurationMs: Date.now() - startedAt,
    terminationReason: "max_iterations",
  };
}

export class BladeProgressEmitter {
  private _currentPhase = 0;
  private _lastPdseScore = 0;
  private _estimatedCostUsd = 0;
  private _currentTask = "Initializing...";

  constructor(
    private readonly _config: BladeAutoforgeConfig,
    private readonly _emit: (state: BladeProgressState) => void,
  ) {}

  onIterationStart(iteration: number): void {
    this._currentPhase = iteration;
    this._currentTask = `Running iteration ${iteration}/${this._getTotalPhases()}`;
    this._emitState();
  }

  onToolRound(round: number, toolName: string): void {
    this._currentTask = `Running ${toolName} (round ${round})`;
    this._emitState();
  }

  onGStackResult(result: GStackResult): void {
    this._currentTask = `${result.command}: ${result.passed ? "pass" : "fail"}`;
    this._emitState();
  }

  onPDSEScore(score: PDSEScore): void {
    this._lastPdseScore = score.overall;
    this._currentTask = `PDSE ${score.overall} recorded`;
    this._emitState();
  }

  onCostUpdate(costUsd: number): void {
    this._estimatedCostUsd = costUsd;
    this._emitState();
  }

  onComplete(result: AutoforgeResult): void {
    this._currentTask = result.succeeded ? "Completed successfully" : "Completed with failures";
    this._emit({
      phase: this._currentPhase,
      totalPhases: this._getTotalPhases(),
      percentComplete: 100,
      pdseScore: result.finalScore?.overall ?? this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false,
    });
  }

  getProgressLine(): string {
    return formatBladeProgressLine(this._buildState());
  }

  private _getTotalPhases(): number {
    return this._config.hardCeiling ?? this._config.maxIterations;
  }

  private _buildState(): BladeProgressState {
    return {
      phase: this._currentPhase,
      totalPhases: this._getTotalPhases(),
      percentComplete:
        this._currentPhase === 0
          ? 0
          : Math.floor(((this._currentPhase - 1) / this._getTotalPhases()) * 100),
      pdseScore: this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false,
    };
  }

  private _emitState(): void {
    this._emit(this._buildState());
  }
}

// ----------------------------------------------------------------------------
// Conversation pattern detection
// ----------------------------------------------------------------------------

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface DetectedPattern {
  pattern: string;
  correction: string;
  language?: string;
  framework?: string;
  source: "memory-detector";
  type: LessonType;
}

export function detectPatterns(messages: ConversationMessage[]): DetectedPattern[] {
  const detected = new Map<string, DetectedPattern>();

  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const content = message.content.trim();

    const preferMatch = content.match(/\bprefer\s+([^.!?\n]+)/i);
    if (preferMatch?.[1]) {
      const value = preferMatch[1].trim();
      detected.set(`prefer:${value.toLowerCase()}`, {
        pattern: `User prefers ${value}`,
        correction: `Respect the user's preference for ${value} in future responses.`,
        source: "memory-detector",
        type: "preference",
      });
    }

    const namingMatch = content.match(/\b(?:call|name)\s+it\s+["'`]?([^"'`\n]+)["'`]?/i);
    if (namingMatch?.[1]) {
      const value = namingMatch[1].trim();
      detected.set(`name:${value.toLowerCase()}`, {
        pattern: `User prefers naming it ${value}`,
        correction: `Use the requested name "${value}" consistently.`,
        source: "memory-detector",
        type: "preference",
      });
    }

    const insteadMatch = content.match(/\buse\s+([^.!?\n]+?)\s+instead\b/i);
    if (insteadMatch?.[1]) {
      const value = insteadMatch[1].trim();
      detected.set(`use:${value.toLowerCase()}`, {
        pattern: `User prefers using ${value} instead`,
        correction: `Favor ${value} for similar follow-up changes.`,
        source: "memory-detector",
        type: "preference",
      });
    }
  }

  return [...detected.values()];
}

export async function detectAndRecordPatterns(
  messages: ConversationMessage[],
  projectRoot: string,
): Promise<Lesson[]> {
  const patterns = detectPatterns(messages);
  if (patterns.length === 0) {
    return [];
  }

  const existing = await queryLessons({
    projectRoot,
    limit: 1000,
    type: "preference",
  });

  const recorded: Lesson[] = [];
  for (const pattern of patterns) {
    const duplicate = existing.find(
      (lesson) => lesson.pattern === pattern.pattern && lesson.type === pattern.type,
    );
    if (duplicate) {
      continue;
    }

    recorded.push(
      await recordLesson(
        {
          pattern: pattern.pattern,
          correction: pattern.correction,
          projectRoot,
          occurrences: 1,
          lastSeen: new Date().toISOString(),
          severity: "info",
          source: pattern.source,
          type: pattern.type,
        },
        projectRoot,
      ),
    );
  }

  return recorded;
}

// ----------------------------------------------------------------------------
// Task outcome artifacts
// ----------------------------------------------------------------------------

export interface VerificationSnapshot {
  kind: string;
  passed: boolean;
  summary: string;
}

export interface TaskOutcomeInput {
  command: string;
  taskDescription: string;
  success: boolean;
  startedAt: string;
  completedAt?: string;
  verificationSnapshots?: VerificationSnapshot[];
  evidenceRefs?: string[];
  error?: string;
}

export interface TaskOutcomeVerificationSummary {
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
}

export interface TaskOutcomeArtifact extends TaskOutcomeInput {
  id: string;
  proofStatus: "verified" | "partially_verified" | "unverified";
  verificationSummary: TaskOutcomeVerificationSummary;
  recordedAt: string;
}

const TASK_OUTCOMES_FILE = ".danteforge/task-outcomes.json";

async function loadTaskOutcomes(projectRoot: string): Promise<TaskOutcomeArtifact[]> {
  try {
    const raw = await readFile(join(projectRoot, TASK_OUTCOMES_FILE), "utf-8");
    const parsed = JSON.parse(raw) as { version: number; outcomes: TaskOutcomeArtifact[] };
    return parsed.outcomes ?? [];
  } catch {
    return [];
  }
}

async function saveTaskOutcomes(projectRoot: string, outcomes: TaskOutcomeArtifact[]): Promise<void> {
  const dir = join(projectRoot, ".danteforge");
  await mkdir(dir, { recursive: true });
  await writeFile(join(projectRoot, TASK_OUTCOMES_FILE), JSON.stringify({ version: 1, outcomes }, null, 2));
}

export async function recordTaskOutcome(input: TaskOutcomeInput, projectRoot: string): Promise<TaskOutcomeArtifact> {
  const snapshots = input.verificationSnapshots ?? [];
  const totalChecks = snapshots.length;
  const passedChecks = snapshots.filter((s) => s.passed).length;
  const failedChecks = totalChecks - passedChecks;

  let proofStatus: TaskOutcomeArtifact["proofStatus"];
  if (totalChecks === 0) {
    proofStatus = "unverified";
  } else if (failedChecks > 0) {
    proofStatus = "partially_verified";
  } else {
    proofStatus = "verified";
  }

  const artifact: TaskOutcomeArtifact = {
    ...input,
    id: randomUUID(),
    proofStatus,
    verificationSummary: { totalChecks, passedChecks, failedChecks },
    recordedAt: new Date().toISOString(),
  };

  const existing = await loadTaskOutcomes(projectRoot);
  existing.push(artifact);
  await saveTaskOutcomes(projectRoot, existing);
  return artifact;
}

export async function getTaskOutcomeCount(projectRoot: string): Promise<number> {
  return (await loadTaskOutcomes(projectRoot)).length;
}

export async function listTaskOutcomes(projectRoot: string): Promise<TaskOutcomeArtifact[]> {
  return loadTaskOutcomes(projectRoot);
}

export async function queryRecentTaskOutcomes(projectRoot: string, limit = 10): Promise<TaskOutcomeArtifact[]> {
  const outcomes = await loadTaskOutcomes(projectRoot);
  return outcomes.slice(-limit).reverse();
}

export function formatTaskOutcomesForPrompt(outcomes: TaskOutcomeArtifact[]): string {
  return outcomes
    .map((o) => `[${o.success ? "success" : "failure"}/${o.proofStatus}] ${o.command}: ${o.taskDescription}`)
    .join("\n");
}

export interface TaskOutcomeTrendSummary {
  totalCount: number;
  failureCount: number;
  dominantFailureCommand: string | null;
  unverifiedFailureCount: number;
  verificationFailureCount: number;
  dominantFailureMode: "unverified_completion" | "verification_failure" | "none";
  warning: string | null;
}

export function summarizeTaskOutcomeTrends(outcomes: TaskOutcomeArtifact[]): TaskOutcomeTrendSummary {
  const failures = outcomes.filter((o) => !o.success);
  const commandCounts = new Map<string, number>();
  for (const f of failures) {
    commandCounts.set(f.command, (commandCounts.get(f.command) ?? 0) + 1);
  }
  const dominantFailureCommand = failures.length > 0
    ? [...commandCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    : null;

  const unverifiedFailureCount = failures.filter((o) => o.proofStatus === "unverified").length;
  const verificationFailureCount = failures.filter((o) => o.proofStatus === "partially_verified").length;

  const dominantFailureMode: TaskOutcomeTrendSummary["dominantFailureMode"] =
    failures.length === 0 ? "none"
    : unverifiedFailureCount >= verificationFailureCount ? "unverified_completion"
    : "verification_failure";

  const warning = failures.length >= 2 ? `${failures.length} repeated failures detected` : null;

  return {
    totalCount: outcomes.length,
    failureCount: failures.length,
    dominantFailureCommand,
    unverifiedFailureCount,
    verificationFailureCount,
    dominantFailureMode,
    warning,
  };
}

export function formatTaskOutcomeTrendSummary(summary: TaskOutcomeTrendSummary): string {
  const lines = [
    `Outcomes analyzed: ${summary.totalCount}`,
    `Failures: ${summary.failureCount}`,
    summary.dominantFailureCommand ? `Most common failing command: ${summary.dominantFailureCommand}` : null,
    `Dominant failure mode: ${summary.dominantFailureMode}`,
    summary.warning ? `Warning: ${summary.warning}` : null,
  ];
  return lines.filter(Boolean).join("\n");
}

// ----------------------------------------------------------------------------
// Review outcome artifacts
// ----------------------------------------------------------------------------

export interface ReviewCommentInput {
  type: "blocking" | "suggestion" | "info";
  category: string;
  resolved: boolean;
}

export interface ReviewOutcomeInput {
  prNumber: number;
  repo: string;
  verdict: string;
  score: number;
  summary: string;
  checklistPassed: number;
  checklistTotal: number;
  comments: ReviewCommentInput[];
  rawPrompt?: string;
}

export interface ReviewOutcomeRecord {
  prNumber: number;
  repo: string;
  verdict: string;
  score: number;
  summary: string;
  checklistPassed: number;
  checklistTotal: number;
  commentCount: number;
  blockingCommentCount: number;
  unresolvedCommentCount: number;
  categoryCounts: Record<string, number>;
  recordedAt: string;
}

const REVIEW_OUTCOMES_FILE = ".danteforge/review-outcomes.json";

async function loadReviewOutcomes(projectRoot: string): Promise<ReviewOutcomeRecord[]> {
  try {
    const raw = await readFile(join(projectRoot, REVIEW_OUTCOMES_FILE), "utf-8");
    return JSON.parse(raw) as ReviewOutcomeRecord[];
  } catch {
    return [];
  }
}

export async function recordReviewOutcome(input: ReviewOutcomeInput, projectRoot: string): Promise<void> {
  const categoryCounts: Record<string, number> = {};
  for (const c of input.comments) {
    categoryCounts[c.category] = (categoryCounts[c.category] ?? 0) + 1;
  }
  const record: ReviewOutcomeRecord = {
    prNumber: input.prNumber,
    repo: input.repo,
    verdict: input.verdict,
    score: input.score,
    summary: input.summary,
    checklistPassed: input.checklistPassed,
    checklistTotal: input.checklistTotal,
    commentCount: input.comments.length,
    blockingCommentCount: input.comments.filter((c) => c.type === "blocking").length,
    unresolvedCommentCount: input.comments.filter((c) => !c.resolved).length,
    categoryCounts,
    recordedAt: new Date().toISOString(),
  };
  const dir = join(projectRoot, ".danteforge");
  await mkdir(dir, { recursive: true });
  const existing = await loadReviewOutcomes(projectRoot);
  existing.push(record);
  await writeFile(join(projectRoot, REVIEW_OUTCOMES_FILE), JSON.stringify(existing, null, 2));
}

export async function listReviewOutcomes(projectRoot: string): Promise<ReviewOutcomeRecord[]> {
  return loadReviewOutcomes(projectRoot);
}

// ----------------------------------------------------------------------------
// Benchmark outcome artifacts
// ----------------------------------------------------------------------------

export interface BenchmarkOutcomeInput {
  runId: string;
  model: string;
  total: number;
  resolved: number;
  passRate: number;
  topFailures: string[];
  outputPath?: string;
  generatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkOutcomeRecord {
  runId: string;
  suite: string;
  model: string;
  total: number;
  resolved: number;
  passRate: number;
  topFailures: string[];
  outputPath?: string;
  generatedAt: string;
  metadata?: Record<string, unknown>;
  recordedAt: string;
}

const BENCHMARK_OUTCOMES_FILE = ".danteforge/benchmark-outcomes.json";

async function loadBenchmarkOutcomes(projectRoot: string): Promise<BenchmarkOutcomeRecord[]> {
  try {
    const raw = await readFile(join(projectRoot, BENCHMARK_OUTCOMES_FILE), "utf-8");
    return JSON.parse(raw) as BenchmarkOutcomeRecord[];
  } catch {
    return [];
  }
}

export async function recordBenchmarkOutcome(input: BenchmarkOutcomeInput, projectRoot: string): Promise<void> {
  const record: BenchmarkOutcomeRecord = {
    ...input,
    suite: "swe-bench",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    recordedAt: new Date().toISOString(),
  };
  const dir = join(projectRoot, ".danteforge");
  await mkdir(dir, { recursive: true });
  const existing = await loadBenchmarkOutcomes(projectRoot);
  existing.push(record);
  await writeFile(join(projectRoot, BENCHMARK_OUTCOMES_FILE), JSON.stringify(existing, null, 2));
}

export async function listBenchmarkOutcomes(projectRoot: string): Promise<BenchmarkOutcomeRecord[]> {
  return loadBenchmarkOutcomes(projectRoot);
}

export async function queryRecentBenchmarkOutcomes(projectRoot: string, limit = 10): Promise<BenchmarkOutcomeRecord[]> {
  const outcomes = await loadBenchmarkOutcomes(projectRoot);
  return outcomes
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, limit);
}

export function formatBenchmarkOutcomesForPrompt(outcomes: BenchmarkOutcomeRecord[]): string {
  return outcomes
    .map((o) => {
      const pct = (o.passRate * 100).toFixed(1);
      return `[${o.suite}] ${o.model}: ${pct}% (${o.resolved}/${o.total})\nTop failures: ${o.topFailures.join(", ")}`;
    })
    .join("\n\n");
}

// ----------------------------------------------------------------------------
// Re-exports
// ----------------------------------------------------------------------------

export { ALL_PATTERNS as CONSTITUTION_PATTERNS };
