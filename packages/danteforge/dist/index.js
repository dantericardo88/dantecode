// src/index.ts
import { readFileSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join, resolve } from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
function createStubPattern(regex, message, violationType) {
  return { regex, message, violationType };
}
var HARD_VIOLATION_PATTERNS = [
  createStubPattern(
    /\bTODO\b/i,
    "TODO marker found - implementation is incomplete",
    "stub_detected"
  ),
  createStubPattern(/\bFIXME\b/i, "FIXME marker found - code still needs repair", "stub_detected"),
  createStubPattern(/\bHACK\b/i, "HACK marker found - workaround left in code", "stub_detected"),
  createStubPattern(
    /raise\s+NotImplementedError/,
    "NotImplementedError indicates an incomplete implementation",
    "stub_detected"
  ),
  createStubPattern(
    /throw\s+new\s+Error\s*\(\s*['"`]not\s+implemented['"`]\s*\)/i,
    'Throwing "not implemented" is a stub',
    "stub_detected"
  ),
  createStubPattern(
    /throw\s+new\s+Error\s*\(\s*['"`]todo['"`]\s*\)/i,
    'Throwing "todo" is a stub',
    "stub_detected"
  ),
  createStubPattern(
    /throw\s+new\s+Error\s*\(\s*['"`]stub['"`]\s*\)/i,
    'Throwing "stub" is a stub',
    "stub_detected"
  ),
  createStubPattern(/^\s*\.\.\.\s*$/, "Ellipsis stub detected", "stub_detected"),
  createStubPattern(/^\s*pass\s*$/, "pass statement leaves implementation empty", "stub_detected"),
  createStubPattern(/\bplaceholder\b/i, "Placeholder text found", "stub_detected"),
  createStubPattern(/\bnotImplemented\b/, "notImplemented symbol found", "stub_detected"),
  createStubPattern(/\/\/\s*\.{3,}/, "Comment ellipsis indicates stubbed code", "stub_detected"),
  createStubPattern(/return\s*;\s*\/\/.*stub/i, "Stubbed early return found", "stub_detected"),
  createStubPattern(/\bXXX\b/, "XXX marker found", "stub_detected")
];
var SOFT_VIOLATION_PATTERNS = [
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
  createStubPattern(/\bit\.todo\s*\(/, "it.todo() found", "test_skip")
];
function cloneRegex(regex) {
  return new RegExp(regex.source, regex.flags);
}
function buildViolation(line, lineNumber, filePath, pattern, severity) {
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
    pattern: pattern.regex.source
  };
}
function runAntiStubScanner(content, _projectRoot, filePath) {
  const lines = content.split(/\r?\n/);
  const hardViolations = [];
  const softViolations = [];
  lines.forEach((line, index) => {
    for (const pattern of HARD_VIOLATION_PATTERNS) {
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
    filePath
  };
}
function scanFile(filePath, projectRoot) {
  const absolutePath = resolve(projectRoot, filePath);
  const content = readFileSync(absolutePath, "utf-8");
  return runAntiStubScanner(content, projectRoot, filePath);
}
function createConstitutionPattern(regex, type, severity, message) {
  return { regex, type, severity, message };
}
var CREDENTIAL_PATTERNS = [
  createConstitutionPattern(
    /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"`][^'"`\s]{8,}['"`]/i,
    "credential_exposure",
    "critical",
    "Possible hardcoded credential detected"
  ),
  createConstitutionPattern(
    /\bsk-[A-Za-z0-9]{16,}\b/,
    "credential_exposure",
    "critical",
    "OpenAI-style API key detected"
  ),
  createConstitutionPattern(
    /\bghp_[A-Za-z0-9]{20,}\b/,
    "credential_exposure",
    "critical",
    "GitHub token detected"
  ),
  createConstitutionPattern(
    /\bBearer\s+[A-Za-z0-9._-]{16,}\b/i,
    "credential_exposure",
    "critical",
    "Bearer token detected"
  )
];
var BACKGROUND_PROCESS_PATTERNS = [
  createConstitutionPattern(
    /\b(nohup|disown|daemonize|daemon|pm2\s+start)\b/i,
    "background_process",
    "warning",
    "Background process launch detected"
  ),
  createConstitutionPattern(
    /\bStart-Process\b.*\b(WindowStyle\s+Hidden|PassThru|NoNewWindow)\b/i,
    "background_process",
    "warning",
    "Hidden PowerShell process launch detected"
  )
];
var DANGEROUS_OPERATION_PATTERNS = [
  createConstitutionPattern(
    /\brm\s+-rf\s+\/\b/i,
    "dangerous_operation",
    "critical",
    "Destructive rm -rf / pattern detected"
  ),
  createConstitutionPattern(
    /\bDROP\s+TABLE\b/i,
    "dangerous_operation",
    "critical",
    "DROP TABLE detected"
  ),
  createConstitutionPattern(
    /\bTRUNCATE\s+TABLE\b/i,
    "dangerous_operation",
    "critical",
    "TRUNCATE TABLE detected"
  ),
  createConstitutionPattern(/\beval\s*\(/, "code_injection", "critical", "eval() detected"),
  createConstitutionPattern(
    /\bnew\s+Function\s*\(/,
    "code_injection",
    "critical",
    "Function constructor detected"
  )
];
var ALL_PATTERNS = [
  ...CREDENTIAL_PATTERNS,
  ...BACKGROUND_PROCESS_PATTERNS,
  ...DANGEROUS_OPERATION_PATTERNS
];
function runConstitutionCheck(code, filePath) {
  const lines = code.split(/\r?\n/);
  const violations = [];
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
        pattern: pattern.regex.source
      });
    }
  });
  return {
    passed: !violations.some((violation) => violation.severity === "critical"),
    violations,
    scannedLines: lines.length,
    filePath
  };
}
function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
function constitutionViolationsToPdse(violations, file) {
  return violations.map((violation) => ({
    type: violation.type === "credential_exposure" ? "hardcoded_secret" : violation.type === "background_process" ? "background_process" : "dead_code",
    severity: violation.severity === "critical" ? "hard" : "soft",
    file,
    line: violation.line,
    message: violation.message,
    pattern: violation.pattern
  }));
}
function countLongLines(code, threshold) {
  return code.split(/\r?\n/).filter((line) => line.length > threshold).length;
}
function countMatches(regex, code) {
  const matches = code.match(cloneRegex(regex));
  return matches?.length ?? 0;
}
async function runPDSEScorer(code, _router, projectRoot, gateConfig) {
  const local = runLocalPDSEScorer(code, projectRoot);
  const threshold = gateConfig?.threshold ?? 85;
  return {
    ...local,
    passedGate: local.overall >= threshold && local.violations.filter((violation) => violation.severity === "hard").length === 0
  };
}
function runLocalPDSEScorer(code, projectRoot) {
  const antiStub = runAntiStubScanner(code, projectRoot);
  const constitution = runConstitutionCheck(code);
  const constitutionAsPdse = constitutionViolationsToPdse(constitution.violations, "<evaluated>");
  const violations = [
    ...antiStub.hardViolations,
    ...antiStub.softViolations,
    ...constitutionAsPdse
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
    100 - hardCount * 18 - emptyFunctions * 12 - arrowEmpties * 10 - softCount * 2
  );
  const correctness = clampScore(
    100 - hardCount * 20 - constitution.violations.length * 8 - errorHandlingPenalty
  );
  const clarity = clampScore(100 - softCount * 4 - longLines * 2);
  const consistency = clampScore(
    100 - softCount * 3 - Math.max(0, countMatches(/\t/g, code) > 0 && code.includes("  ") ? 8 : 0)
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
    scoredAt: (/* @__PURE__ */ new Date()).toISOString(),
    scoredBy: "local-heuristic"
  };
}
function runGStackSingle(command, projectRoot) {
  return new Promise((resolveResult) => {
    const startedAt = Date.now();
    const child = spawn(command.command, {
      cwd: projectRoot,
      shell: true,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, command.timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
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
        passed: Boolean(command.failureIsSoft)
      });
    });
    child.on("close", (code) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      const exitCode = timedOut ? 124 : code ?? 1;
      resolveResult({
        command: command.name,
        exitCode,
        stdout,
        stderr: timedOut ? `${stderr}
Timed out after ${command.timeoutMs}ms`.trim() : stderr,
        durationMs: Date.now() - startedAt,
        passed: exitCode === 0 || Boolean(command.failureIsSoft)
      });
    });
  });
}
async function runGStack(_code, commands, projectRoot) {
  const results = [];
  for (const command of commands) {
    results.push(await runGStackSingle(command, projectRoot));
  }
  return results;
}
function allGStackPassed(results) {
  return results.every((result) => result.passed);
}
function summarizeGStackResults(results) {
  if (results.length === 0) {
    return "No verification commands ran.";
  }
  return results.map(
    (result) => `${result.passed ? "PASS" : "FAIL"} ${result.command} (${result.durationMs}ms)`
  ).join("\n");
}
var LESSONS_RELATIVE_PATH = join(".dantecode", "lessons.json");
function getLessonsFile(projectRoot) {
  return join(projectRoot, LESSONS_RELATIVE_PATH);
}
function severityRank(severity) {
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
async function readLessons(projectRoot) {
  const lessonsFile = getLessonsFile(projectRoot);
  try {
    const raw = await readFile(lessonsFile, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
async function writeLessons(projectRoot, lessons) {
  const lessonsFile = getLessonsFile(projectRoot);
  await mkdir(dirname(lessonsFile), { recursive: true });
  await writeFile(lessonsFile, `${JSON.stringify(lessons, null, 2)}
`, "utf-8");
}
function normalizeLesson(lesson, projectRoot, type, source, severity) {
  return {
    id: lesson.id ?? randomUUID(),
    projectRoot,
    pattern: lesson.pattern,
    correction: lesson.correction,
    filePattern: lesson.filePattern,
    language: lesson.language,
    framework: lesson.framework,
    occurrences: lesson.occurrences > 0 ? lesson.occurrences : 1,
    lastSeen: lesson.lastSeen || (/* @__PURE__ */ new Date()).toISOString(),
    severity: lesson.severity ?? severity,
    type: lesson.type ?? type,
    source: lesson.source ?? source
  };
}
async function initLessonsDB(_projectRoot) {
  return {};
}
async function recordLesson(lesson, projectRoot) {
  const lessons = await readLessons(projectRoot);
  const normalized = normalizeLesson(
    lesson,
    projectRoot,
    lesson.type ?? "failure",
    lesson.source ?? "autoforge",
    lesson.severity ?? "warning"
  );
  const existing = lessons.find(
    (entry) => entry.pattern === normalized.pattern && entry.type === normalized.type && entry.projectRoot === normalized.projectRoot
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
async function recordSuccessPattern(lesson, projectRoot) {
  return recordLesson(
    {
      ...lesson,
      projectRoot,
      severity: lesson.severity ?? "info",
      source: lesson.source ?? "autoforge",
      type: "success"
    },
    projectRoot
  );
}
async function recordPreference(lesson, projectRoot) {
  return recordLesson(
    {
      ...lesson,
      projectRoot,
      severity: lesson.severity ?? "info",
      source: lesson.source ?? "memory-detector",
      type: "preference"
    },
    projectRoot
  );
}
async function queryLessons(query) {
  const lessons = await readLessons(query.projectRoot);
  return lessons.filter((lesson) => query.type ? lesson.type === query.type : true).filter(
    (lesson) => query.language ? lesson.language === void 0 || lesson.language === query.language : true
  ).filter((lesson) => {
    if (!query.filePattern) {
      return true;
    }
    if (!lesson.filePattern) {
      return true;
    }
    return lesson.filePattern.includes(query.filePattern) || query.filePattern.includes(lesson.filePattern);
  }).filter(
    (lesson) => query.minSeverity ? severityRank(lesson.severity) >= severityRank(query.minSeverity) : true
  ).sort((left, right) => {
    if (right.occurrences !== left.occurrences) {
      return right.occurrences - left.occurrences;
    }
    return right.lastSeen.localeCompare(left.lastSeen);
  }).slice(0, query.limit);
}
async function getLessonCount(projectRoot) {
  const lessons = await readLessons(projectRoot);
  return lessons.length;
}
async function deleteLesson(lessonId, projectRoot) {
  const lessons = await readLessons(projectRoot);
  const filtered = lessons.filter((lesson) => lesson.id !== lessonId);
  if (filtered.length === lessons.length) {
    return false;
  }
  await writeLessons(projectRoot, filtered);
  return true;
}
async function clearLessons(projectRoot) {
  const lessons = await readLessons(projectRoot);
  await writeLessons(projectRoot, []);
  return lessons.length;
}
function formatLessonsForPrompt(lessons) {
  if (lessons.length === 0) {
    return "No prior lessons recorded.";
  }
  return lessons.map(
    (lesson) => `- [${lesson.type}/${lesson.severity}] ${lesson.pattern}
  Correction: ${lesson.correction}`
  ).join("\n");
}
function generateProgressBar(percentComplete) {
  const clamped = Math.max(0, Math.min(100, percentComplete));
  const filled = Math.round(clamped / 10);
  return "#".repeat(filled) + "-".repeat(10 - filled);
}
function formatBladeProgressLine(state) {
  return `Autoforge Phase ${state.phase}/${state.totalPhases} [${generateProgressBar(
    state.percentComplete
  )}] ${state.percentComplete}% | PDSE ${state.pdseScore} | Est. $${state.estimatedCostUsd.toFixed(
    3
  )}`;
}
function buildFailureContext(currentCode, score, gstackResults, lessons, context) {
  const gstackFailures = gstackResults.filter((result) => !result.passed);
  const sections = [
    "# Autoforge Regeneration Request",
    `Task: ${context.taskDescription}`,
    context.filePath ? `Target file: ${context.filePath}` : void 0,
    context.language ? `Language: ${context.language}` : void 0,
    context.framework ? `Framework: ${context.framework}` : void 0,
    "",
    "Current code:",
    "```",
    currentCode,
    "```",
    "",
    score ? `PDSE: ${score.overall} (completeness ${score.completeness}, correctness ${score.correctness}, clarity ${score.clarity}, consistency ${score.consistency})` : "PDSE: unavailable",
    score && score.violations.length > 0 ? `Violations:
${score.violations.map((violation) => `- ${violation.message}`).join("\n")}` : "Violations: none captured",
    "",
    gstackFailures.length > 0 ? `Verification failures:
${gstackFailures.map(
      (result) => `- ${result.command}: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`
    ).join("\n")}` : "Verification failures: none",
    "",
    lessons.length > 0 ? "Relevant lessons:\n" + formatLessonsForPrompt(lessons) : "Relevant lessons: none",
    "",
    "Return improved production-ready code only. Do not add explanations."
  ].filter((section) => Boolean(section));
  return sections.join("\n");
}
function extractCodeFromResponse(response) {
  const fenced = response.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }
  return response.trim();
}
async function runAutoforgeIAL(code, context, config, router, projectRoot, onProgress) {
  const bladeConfig = config;
  const startedAt = Date.now();
  const maxIterations = bladeConfig.persistUntilGreen ? bladeConfig.hardCeiling ?? 200 : config.maxIterations;
  let currentCode = code;
  let finalScore = null;
  const iterationHistory = [];
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    onProgress?.({
      phase: iteration,
      totalPhases: maxIterations,
      percentComplete: Math.floor((iteration - 1) / maxIterations * 100),
      pdseScore: finalScore?.overall ?? 0,
      estimatedCostUsd: 0,
      currentTask: `Running iteration ${iteration}/${maxIterations}`,
      silentMode: bladeConfig.silentMode ?? false
    });
    const iterationStartedAt = Date.now();
    const antiStub = runAntiStubScanner(currentCode, projectRoot, context.filePath);
    const constitution = runConstitutionCheck(currentCode, context.filePath);
    const inputViolations = [
      ...antiStub.hardViolations,
      ...antiStub.softViolations,
      ...constitutionViolationsToPdse(constitution.violations, context.filePath ?? "<evaluated>")
    ];
    if (config.abortOnSecurityViolation && constitution.violations.some((violation) => violation.severity === "critical")) {
      const score2 = runLocalPDSEScorer(currentCode, projectRoot);
      finalScore = score2;
      iterationHistory.push({
        iterationNumber: iteration,
        inputViolations,
        gstackResults: [],
        lessonsInjected: [],
        outputScore: score2,
        succeeded: false,
        durationMs: Date.now() - iterationStartedAt
      });
      return {
        finalCode: currentCode,
        iterations: iteration,
        succeeded: false,
        iterationHistory,
        finalScore,
        totalDurationMs: Date.now() - startedAt,
        terminationReason: "constitution_violation"
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
      durationMs: Date.now() - iterationStartedAt
    });
    onProgress?.({
      phase: iteration,
      totalPhases: maxIterations,
      percentComplete: Math.floor(iteration / maxIterations * 100),
      pdseScore: score.overall,
      estimatedCostUsd: 0,
      currentTask: succeeded ? `Iteration ${iteration} passed` : `Iteration ${iteration} needs fixes`,
      silentMode: bladeConfig.silentMode ?? false
    });
    if (succeeded) {
      await recordSuccessPattern(
        {
          pattern: `Autoforge success: ${context.taskDescription}`,
          correction: `Preserve the implementation shape that passed ${context.filePath ?? "the target file"}.`,
          filePattern: context.filePath,
          language: context.language,
          framework: context.framework,
          occurrences: 1,
          lastSeen: (/* @__PURE__ */ new Date()).toISOString()
        },
        projectRoot
      );
      return {
        finalCode: currentCode,
        iterations: iteration,
        succeeded: true,
        iterationHistory,
        finalScore,
        totalDurationMs: Date.now() - startedAt,
        terminationReason: "passed"
      };
    }
    if (iteration === maxIterations) {
      break;
    }
    const lessons = bladeConfig.lessonInjectionEnabled ? await queryLessons({
      projectRoot,
      filePattern: context.filePath,
      language: context.language,
      limit: 10
    }) : [];
    const prompt = buildFailureContext(currentCode, score, gstackResults, lessons, context);
    try {
      const regenerated = extractCodeFromResponse(
        await router.chat(prompt, {
          temperature: 0.3,
          maxTokens: 4096
        })
      );
      if (regenerated.length > 0) {
        currentCode = regenerated;
      }
    } catch {
    }
  }
  return {
    finalCode: currentCode,
    iterations: iterationHistory.length,
    succeeded: false,
    iterationHistory,
    finalScore,
    totalDurationMs: Date.now() - startedAt,
    terminationReason: "max_iterations"
  };
}
var BladeProgressEmitter = class {
  constructor(_config, _emit) {
    this._config = _config;
    this._emit = _emit;
  }
  _currentPhase = 0;
  _lastPdseScore = 0;
  _estimatedCostUsd = 0;
  _currentTask = "Initializing...";
  onIterationStart(iteration) {
    this._currentPhase = iteration;
    this._currentTask = `Running iteration ${iteration}/${this._getTotalPhases()}`;
    this._emitState();
  }
  onToolRound(round, toolName) {
    this._currentTask = `Running ${toolName} (round ${round})`;
    this._emitState();
  }
  onGStackResult(result) {
    this._currentTask = `${result.command}: ${result.passed ? "pass" : "fail"}`;
    this._emitState();
  }
  onPDSEScore(score) {
    this._lastPdseScore = score.overall;
    this._currentTask = `PDSE ${score.overall} recorded`;
    this._emitState();
  }
  onCostUpdate(costUsd) {
    this._estimatedCostUsd = costUsd;
    this._emitState();
  }
  onComplete(result) {
    this._currentTask = result.succeeded ? "Completed successfully" : "Completed with failures";
    this._emit({
      phase: this._currentPhase,
      totalPhases: this._getTotalPhases(),
      percentComplete: 100,
      pdseScore: result.finalScore?.overall ?? this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false
    });
  }
  getProgressLine() {
    return formatBladeProgressLine(this._buildState());
  }
  _getTotalPhases() {
    return this._config.hardCeiling ?? this._config.maxIterations;
  }
  _buildState() {
    return {
      phase: this._currentPhase,
      totalPhases: this._getTotalPhases(),
      percentComplete: this._currentPhase === 0 ? 0 : Math.floor((this._currentPhase - 1) / this._getTotalPhases() * 100),
      pdseScore: this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false
    };
  }
  _emitState() {
    this._emit(this._buildState());
  }
};
function detectPatterns(messages) {
  const detected = /* @__PURE__ */ new Map();
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
        type: "preference"
      });
    }
    const namingMatch = content.match(/\b(?:call|name)\s+it\s+["'`]?([^"'`\n]+)["'`]?/i);
    if (namingMatch?.[1]) {
      const value = namingMatch[1].trim();
      detected.set(`name:${value.toLowerCase()}`, {
        pattern: `User prefers naming it ${value}`,
        correction: `Use the requested name "${value}" consistently.`,
        source: "memory-detector",
        type: "preference"
      });
    }
    const insteadMatch = content.match(/\buse\s+([^.!?\n]+?)\s+instead\b/i);
    if (insteadMatch?.[1]) {
      const value = insteadMatch[1].trim();
      detected.set(`use:${value.toLowerCase()}`, {
        pattern: `User prefers using ${value} instead`,
        correction: `Favor ${value} for similar follow-up changes.`,
        source: "memory-detector",
        type: "preference"
      });
    }
  }
  return [...detected.values()];
}
async function detectAndRecordPatterns(messages, projectRoot) {
  const patterns = detectPatterns(messages);
  if (patterns.length === 0) {
    return [];
  }
  const existing = await queryLessons({
    projectRoot,
    limit: 1e3,
    type: "preference"
  });
  const recorded = [];
  for (const pattern of patterns) {
    const duplicate = existing.find(
      (lesson) => lesson.pattern === pattern.pattern && lesson.type === pattern.type
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
          lastSeen: (/* @__PURE__ */ new Date()).toISOString(),
          severity: "info",
          source: pattern.source,
          type: pattern.type
        },
        projectRoot
      )
    );
  }
  return recorded;
}
export {
  ALL_PATTERNS,
  BACKGROUND_PROCESS_PATTERNS,
  BladeProgressEmitter,
  ALL_PATTERNS as CONSTITUTION_PATTERNS,
  CREDENTIAL_PATTERNS,
  DANGEROUS_OPERATION_PATTERNS,
  HARD_VIOLATION_PATTERNS,
  SOFT_VIOLATION_PATTERNS,
  allGStackPassed,
  buildFailureContext,
  clearLessons,
  deleteLesson,
  detectAndRecordPatterns,
  detectPatterns,
  formatBladeProgressLine,
  formatLessonsForPrompt,
  generateProgressBar,
  getLessonCount,
  initLessonsDB,
  queryLessons,
  recordLesson,
  recordPreference,
  recordSuccessPattern,
  runAntiStubScanner,
  runAutoforgeIAL,
  runConstitutionCheck,
  runGStack,
  runGStackSingle,
  runLocalPDSEScorer,
  runPDSEScorer,
  scanFile,
  summarizeGStackResults
};
