// Sprint AI — Dim 20: Debug-guided repair advisor
// When a debug snapshot contains exception info, suggest a targeted fix hint
// based on the exception type and stack frame location.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface DebugRepairHint {
  exceptionType: string;
  suggestedFix: string;
  targetFile?: string;
  targetLine?: number;
  confidence: number; // 0-1
}

export interface DebugRepairLogEntry {
  timestamp: string;
  exceptionType: string;
  targetFile?: string;
  targetLine?: number;
  suggestedFix: string;
  confidence: number;
}

const EXCEPTION_FIX_MAP: Record<string, string> = {
  TypeError: "Check for null/undefined values before accessing properties. Add a null guard or optional chaining (?.).",
  ReferenceError: "Ensure the variable is declared before use. Check import/require statements.",
  SyntaxError: "Fix the syntax error at the indicated line. Check for missing brackets, commas, or semicolons.",
  RangeError: "Check array bounds and numeric ranges. Ensure loop termination conditions are correct.",
  URIError: "Validate the URI string before calling encodeURIComponent/decodeURIComponent.",
  EvalError: "Replace dynamic code execution with a safer alternative like JSON.parse() or a lookup table.",
  NetworkError: "Check network connectivity and URL validity. Add error handling for fetch/axios calls.",
  "Cannot read properties of undefined": "Add a null guard: check if the object exists before accessing its properties.",
  "Cannot read properties of null": "The value is null. Add `if (value !== null)` before accessing properties.",
  "is not a function": "Verify the function exists and is exported. Check the import statement.",
  "is not defined": "Add the missing import or variable declaration.",
  "Stack overflow": "Check for infinite recursion. Add a base case or depth limit to the recursive function.",
  ENOENT: "The file does not exist. Check the path and ensure the file was created before reading.",
  EACCES: "Permission denied. Check file/directory permissions.",
  ECONNREFUSED: "Connection refused. Ensure the server is running on the expected port.",
};

function classifyException(message: string): { type: string; fix: string } {
  for (const [pattern, fix] of Object.entries(EXCEPTION_FIX_MAP)) {
    if (message.includes(pattern)) {
      return { type: pattern, fix };
    }
  }
  const colonIdx = message.indexOf(":");
  const type = colonIdx > 0 ? message.slice(0, colonIdx).trim() : "UnknownError";
  return {
    type,
    fix: `Inspect the exception at the indicated location. Review the call stack for the root cause.`,
  };
}

export interface SnapLike {
  exceptionMessage?: string;
  stopReason?: string;
  frames?: Array<{ source?: string; line?: number; name?: string }>;
}

/**
 * Analyze a debug snapshot and return a targeted repair hint.
 * Called after debug context injection in agent-loop.
 */
export function suggestDebugFix(snapshot: SnapLike): DebugRepairHint | null {
  if (!snapshot.exceptionMessage && snapshot.stopReason !== "exception") {
    return null;
  }
  const msg = snapshot.exceptionMessage ?? "Unknown exception";
  const { type, fix } = classifyException(msg);
  const topFrame = snapshot.frames?.[0];

  // Confidence: higher if we have a known exception type
  const knownType = Object.keys(EXCEPTION_FIX_MAP).some((k) => msg.includes(k));
  const confidence = knownType ? 0.8 : 0.4;

  return {
    exceptionType: type,
    suggestedFix: fix,
    targetFile: topFrame?.source,
    targetLine: topFrame?.line,
    confidence,
  };
}

// ─── Sprint BL — Structured repair suggestions ───────────────────────────────

export interface RepairSuggestion {
  priority: "critical" | "high" | "medium";
  category: "null-check" | "type-error" | "undefined" | "boundary" | "async";
  description: string;
  codeHint: string;   // 1-line code suggestion
  confidence: number; // 0-1
}

/**
 * Inspect the snapshot's exceptionMessage and generate structured repair suggestions.
 * Multiple patterns can match; results are sorted by priority (critical first).
 */
export function generateRepairSuggestions(snapshot: SnapLike): RepairSuggestion[] {
  const msg = (snapshot.exceptionMessage ?? "").toLowerCase();
  if (!msg) return [];

  const suggestions: RepairSuggestion[] = [];

  if (msg.includes("cannot read") || (msg.includes("null") && !msg.includes("undefined is not"))) {
    suggestions.push({
      priority: "critical",
      category: "null-check",
      description: "Object is null — add a null guard before property access.",
      codeHint: "if (value !== null && value !== undefined) { /* use value */ }",
      confidence: 0.85,
    });
  }

  if (msg.includes("undefined is not")) {
    suggestions.push({
      priority: "critical",
      category: "undefined",
      description: "Value is undefined — verify the variable is initialized before use.",
      codeHint: "const safe = value ?? defaultValue;",
      confidence: 0.85,
    });
  }

  if (msg.includes("is not a function")) {
    suggestions.push({
      priority: "high",
      category: "type-error",
      description: "Attempted to call a non-function — verify the import and type of the callee.",
      codeHint: "if (typeof fn === 'function') fn();",
      confidence: 0.8,
    });
  }

  if (msg.includes("index out of") || msg.includes("rangeerror")) {
    suggestions.push({
      priority: "high",
      category: "boundary",
      description: "Index is out of range — add bounds checking before array/string access.",
      codeHint: "if (index >= 0 && index < arr.length) { /* access arr[index] */ }",
      confidence: 0.8,
    });
  }

  if (msg.includes("promise") || msg.includes("async") || msg.includes("await")) {
    suggestions.push({
      priority: "medium",
      category: "async",
      description: "Async/Promise error — ensure all async calls are awaited and errors are caught.",
      codeHint: "try { const result = await asyncFn(); } catch (err) { handleError(err); }",
      confidence: 0.7,
    });
  }

  // Sort: critical first, then high, then medium
  const ORDER = { critical: 0, high: 1, medium: 2 };
  suggestions.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);
  return suggestions;
}

/**
 * Format repair suggestions as a markdown bullet list for prompt injection.
 */
export function formatRepairSuggestionsForPrompt(suggestions: RepairSuggestion[]): string {
  if (suggestions.length === 0) return "_No repair suggestions available._";
  return suggestions
    .map(
      (s) =>
        `- **[${s.priority.toUpperCase()}]** \`${s.category}\`: ${s.description}\n  _Hint_: \`${s.codeHint}\` (confidence: ${Math.round(s.confidence * 100)}%)`,
    )
    .join("\n");
}

/**
 * Emit a repair hint to the debug-repair-log.json artifact and return formatted text.
 */
export function emitDebugRepairHint(hint: DebugRepairHint, projectRoot = process.cwd()): string {
  try {
    const dir = join(projectRoot, ".danteforge");
    mkdirSync(dir, { recursive: true });
    const entry: DebugRepairLogEntry = {
      timestamp: new Date().toISOString(),
      ...hint,
    };
    appendFileSync(join(dir, "debug-repair-log.json"), JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }

  const loc = hint.targetFile
    ? ` at ${hint.targetFile}${hint.targetLine ? `:${hint.targetLine}` : ""}`
    : "";
  return `[Debug repair hint] ${hint.exceptionType}${loc} — ${hint.suggestedFix} (confidence: ${Math.round(hint.confidence * 100)}%)`;
}
