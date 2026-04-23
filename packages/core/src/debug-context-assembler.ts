// ============================================================================
// packages/core/src/debug-context-assembler.ts
//
// Dim 20 — Debug / runtime context: stack trace + watch values + failing test
// → structured DebugRepairContext → outcome delta vs sessions without debug context.
//
// Decision-changing: when tool output contains a stack trace, the agent gets a
// structured [Debug Repair Context] injection instead of raw error text.
// Post-session: whether that context correlated with COMPLETED verdict.
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ParsedStackFrame {
  functionName: string;
  filePath: string;
  line: number;
  column?: number;
  isUserCode: boolean;
}

export interface DebugRepairContext {
  sessionId: string;
  errorType: string;        // "TypeError" | "AssertionError" | "FAILED" etc.
  errorMessage: string;     // first meaningful line, truncated to 200 chars
  stackFrames: ParsedStackFrame[];
  watchValues: Record<string, string>;
  failingTestName?: string;
  severityScore: number;    // 0.9 = exception+stack, 0.6 = test failure, 0.3 = generic
  assembledAt: string;
}

export interface DebugRepairOutcome {
  sessionId: string;
  hadDebugContext: boolean;
  debugContextCount: number;  // how many contexts were injected this session
  verdict: "COMPLETED" | "ATTEMPTED" | "FAILED";
  severityScore: number;      // highest-severity context in the session (0 if none)
  timestamp: string;
}

export interface DebugRepairImpactReport {
  withDebugContextRate: number;
  withoutDebugContextRate: number;
  delta: number;
  isSignificant: boolean;   // delta > 0.15
  sampleCount: number;
  computedAt: string;
}

// ── Stack trace detection ──────────────────────────────────────────────────────

const STACK_TRACE_PATTERNS = [
  /^\s+at\s+/m,                              // JS/TS: at FnName (file:line:col)
  /Traceback \(most recent call last\)/m,     // Python
  /\tat\s+[\w.$]+\([\w.]+:\d+\)/m,           // Java
  /^\s+\d+:\s+0x[0-9a-f]+ - /m,             // Rust
  /error\[E\d{4}\]/m,                        // Rust compiler
];

export function hasStackTrace(text: string): boolean {
  return STACK_TRACE_PATTERNS.some((p) => p.test(text));
}

// ── Frame parsing ─────────────────────────────────────────────────────────────

const JS_FRAME_RE = /at\s+([\w.$<>]+)?\s*\(?([^():\n\r]+):(\d+)(?::(\d+))?\)?/;
const NODE_INTERNAL_RE = /node_modules|node:internal|<anonymous>|internal\//;

function parseJsFrames(text: string): ParsedStackFrame[] {
  const frames: ParsedStackFrame[] = [];
  for (const line of text.split("\n")) {
    const m = JS_FRAME_RE.exec(line);
    if (m) {
      const filePath = (m[2] ?? "").trim();
      frames.push({
        functionName: m[1] ?? "<anonymous>",
        filePath,
        line: parseInt(m[3] ?? "0"),
        column: m[4] ? parseInt(m[4]) : undefined,
        isUserCode: Boolean(filePath) && !NODE_INTERNAL_RE.test(filePath),
      });
      if (frames.length >= 10) break;
    }
  }
  return frames;
}

// ── Error type extraction ─────────────────────────────────────────────────────

const ERROR_TYPE_RE =
  /^(TypeError|ReferenceError|SyntaxError|RangeError|AssertionError|URIError|Error|FAIL(?:ED)?|error TS\d+|test failed)/im;

const FAILING_TEST_RE =
  /●\s+(.+?)\s+›\s+(.+)|FAIL\s+\S+.*?›\s+(.+)|✗\s+(.+)/;

// ── assembleDebugContext ───────────────────────────────────────────────────────

/**
 * Parse raw tool output (Bash stderr/stdout, test runner output) into a
 * structured DebugRepairContext ready for prompt injection.
 */
export function assembleDebugContext(
  rawOutput: string,
  watchValues: Record<string, string>,
  sessionId: string,
): DebugRepairContext {
  const errorTypeMatch = ERROR_TYPE_RE.exec(rawOutput);
  const errorType = errorTypeMatch?.[0]?.trim() ?? "Error";

  const firstLine = rawOutput.split("\n").find((l) => l.trim().length > 0)?.trim() ?? rawOutput.slice(0, 200);
  const errorMessage = firstLine.slice(0, 200);

  const stackFrames = parseJsFrames(rawOutput);

  const testMatch = FAILING_TEST_RE.exec(rawOutput);
  const failingTestName = testMatch
    ? (testMatch[1] && testMatch[2]
        ? `${testMatch[1].trim()} › ${testMatch[2].trim()}`
        : (testMatch[3] ?? testMatch[4] ?? "").trim())
    : undefined;

  const hasException = /TypeError|ReferenceError|SyntaxError|RangeError|AssertionError/.test(rawOutput);
  const hasTestFail = /\bFAIL(?:ED)?\b|●\s/.test(rawOutput);
  const severityScore = hasException ? 0.9 : hasTestFail ? 0.6 : 0.3;

  return {
    sessionId,
    errorType,
    errorMessage,
    stackFrames,
    watchValues,
    failingTestName: failingTestName || undefined,
    severityScore,
    assembledAt: new Date().toISOString(),
  };
}

// ── formatDebugContextForPrompt ───────────────────────────────────────────────

/**
 * Render a DebugRepairContext as a concise structured prompt block.
 * Injects into agent context as a [Debug Repair Context] system message.
 */
export function formatDebugContextForPrompt(ctx: DebugRepairContext): string {
  const lines: string[] = [
    `[Debug Repair Context — severity: ${ctx.severityScore.toFixed(1)}]`,
    `Error: ${ctx.errorType}: ${ctx.errorMessage.slice(0, 120)}`,
  ];

  if (ctx.failingTestName) {
    lines.push(`Failing test: ${ctx.failingTestName}`);
  }

  const userFrames = ctx.stackFrames.filter((f) => f.isUserCode).slice(0, 3);
  if (userFrames.length > 0) {
    lines.push("Stack (user code):");
    for (const f of userFrames) {
      lines.push(`  ${f.functionName} at ${f.filePath}:${f.line}`);
    }
  } else if (ctx.stackFrames.length > 0) {
    const top = ctx.stackFrames[0]!;
    lines.push(`Top frame: ${top.functionName} at ${top.filePath}:${top.line}`);
  }

  const watchEntries = Object.entries(ctx.watchValues).slice(0, 5);
  if (watchEntries.length > 0) {
    lines.push("Watch values:");
    for (const [k, v] of watchEntries) {
      lines.push(`  ${k} = ${String(v).slice(0, 60)}`);
    }
  }

  return lines.join("\n");
}

// ── Persistence ───────────────────────────────────────────────────────────────

const OUTCOMES_FILE = ".danteforge/debug-repair-outcomes.jsonl";

export function recordDebugRepairOutcome(outcome: DebugRepairOutcome, projectRoot: string): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "debug-repair-outcomes.jsonl"), JSON.stringify(outcome) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadDebugRepairOutcomes(projectRoot: string): DebugRepairOutcome[] {
  const path = join(resolve(projectRoot), OUTCOMES_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DebugRepairOutcome);
  } catch {
    return [];
  }
}

// ── Impact computation ────────────────────────────────────────────────────────

export function computeDebugRepairImpact(outcomes: DebugRepairOutcome[]): DebugRepairImpactReport {
  const withDebug = outcomes.filter((o) => o.hadDebugContext);
  const withoutDebug = outcomes.filter((o) => !o.hadDebugContext);

  const completedRate = (arr: DebugRepairOutcome[]) =>
    arr.length === 0 ? 0 : arr.filter((o) => o.verdict === "COMPLETED").length / arr.length;

  const withDebugContextRate = completedRate(withDebug);
  const withoutDebugContextRate = completedRate(withoutDebug);
  const delta = withDebugContextRate - withoutDebugContextRate;

  return {
    withDebugContextRate,
    withoutDebugContextRate,
    delta,
    isSignificant: delta > 0.15,
    sampleCount: outcomes.length,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Read the debug-repair-outcomes log and return the impact report.
 * Outcome delta > 0.15 means injecting debug context meaningfully helps repair success.
 */
export function getDebugRepairSuccessRate(projectRoot: string): DebugRepairImpactReport {
  return computeDebugRepairImpact(loadDebugRepairOutcomes(projectRoot));
}
