// ============================================================================
// packages/core/src/browser-capture-tracker.ts
// Dim 14 — Browser runtime capture: console errors, network failures,
//          structured repair prompts, outcome persistence
// Patterns from: browser-use (BrowserStateSummary.browser_errors[]),
//               openhands (BrowserOutputObservation.last_browser_action_error),
//               e2b (CommandResult typed stream output)
// ============================================================================

import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BrowserErrorSeverity = "error" | "warning" | "info";
export type BrowserErrorSource = "console" | "network" | "uncaught" | "unhandledrejection";

export interface BrowserRuntimeError {
  message: string;
  severity: BrowserErrorSeverity;
  source: BrowserErrorSource;
  url?: string;
  line?: number;
  column?: number;
  stack?: string;
  timestamp: string;
}

export interface NetworkFailure {
  url: string;
  method: string;
  statusCode: number | null;
  errorMessage: string;
  durationMs?: number;
  resourceType?: "fetch" | "xhr" | "script" | "stylesheet" | "other";
  timestamp: string;
}

export interface BrowserCaptureSummary {
  previewUrl: string;
  port: number;
  capturedAt: string;
  consoleErrors: BrowserRuntimeError[];
  networkFailures: NetworkFailure[];
  hasBlockingErrors: boolean;
}

export interface PreviewFailureRecord {
  sessionId: string;
  previewUrl: string;
  port: number;
  errorCount: number;
  networkFailureCount: number;
  topError: string;
  repairAttempted: boolean;
  repairSucceeded?: boolean;
  recordedAt: string;
}

export interface RepairPrompt {
  summary: string;
  errorContext: string;
  suggestedAction: string;
  fullPrompt: string;
}

// ── Console Error Pattern Detection ──────────────────────────────────────────

const BLOCKING_ERROR_PATTERNS = [
  /\bunhandled\s+(?:promise\s+)?rejection\b/i,
  /\bfailed\s+to\s+fetch\b/i,
  /\bSyntaxError\b/,
  /\bReferenceError\b/,
  /\bTypeError\b/,
  /\bnetwork\s+error\b/i,
  /\bCORS\s+policy\b/i,
  /404|500|502|503/,
];

const SEVERITY_MAP: Record<string, BrowserErrorSeverity> = {
  error: "error",
  warning: "warning",
  warn: "warning",
  info: "info",
  log: "info",
};

export function classifyConsoleMessage(text: string, level = "error"): BrowserRuntimeError {
  const severity = SEVERITY_MAP[level] ?? "error";
  const isUncaught = /uncaught\s+(?:TypeError|ReferenceError|SyntaxError)/i.test(text);
  const isRejection = /unhandled\s+(?:promise\s+)?rejection/i.test(text);

  return {
    message: text,
    severity,
    source: isUncaught ? "uncaught" : isRejection ? "unhandledrejection" : "console",
    timestamp: new Date().toISOString(),
  };
}

export function classifyNetworkError(
  url: string,
  method: string,
  statusCode: number | null,
  errorMsg = "",
): NetworkFailure {
  return {
    url,
    method: method.toUpperCase(),
    statusCode,
    errorMessage: errorMsg || (statusCode ? `HTTP ${statusCode}` : "Network error"),
    resourceType: url.endsWith(".js") ? "script" : url.endsWith(".css") ? "stylesheet" : "fetch",
    timestamp: new Date().toISOString(),
  };
}

export function isBlockingError(error: BrowserRuntimeError): boolean {
  return (
    error.severity === "error" &&
    BLOCKING_ERROR_PATTERNS.some((p) => p.test(error.message))
  );
}

// ── Capture Summary Builder ───────────────────────────────────────────────────

export function buildCaptureSummary(
  port: number,
  consoleErrors: BrowserRuntimeError[],
  networkFailures: NetworkFailure[],
): BrowserCaptureSummary {
  return {
    previewUrl: `http://localhost:${port}`,
    port,
    capturedAt: new Date().toISOString(),
    consoleErrors,
    networkFailures,
    hasBlockingErrors:
      consoleErrors.some(isBlockingError) ||
      networkFailures.some((f) => f.statusCode != null && f.statusCode >= 500),
  };
}

// ── Dev Server Stdout Error Extraction ───────────────────────────────────────

const STDOUT_ERROR_PATTERNS = [
  { pattern: /error\s+TS\d+/i, source: "console" as BrowserErrorSource },
  { pattern: /\[vite\]\s+(?:error|failed)/i, source: "console" as BrowserErrorSource },
  { pattern: /\[webpack\]\s+error/i, source: "console" as BrowserErrorSource },
  { pattern: /\bmodule\s+not\s+found\b/i, source: "uncaught" as BrowserErrorSource },
  { pattern: /\bcannot\s+find\s+module\b/i, source: "uncaught" as BrowserErrorSource },
  { pattern: /\bfailed\s+to\s+compile\b/i, source: "console" as BrowserErrorSource },
  { pattern: /\bERROR\s+in\b/i, source: "console" as BrowserErrorSource },
];

export function extractErrorsFromDevOutput(stdout: string): BrowserRuntimeError[] {
  const errors: BrowserRuntimeError[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    for (const { pattern, source } of STDOUT_ERROR_PATTERNS) {
      if (pattern.test(line)) {
        errors.push({ message: line.trim(), severity: "error", source, timestamp: new Date().toISOString() });
        break;
      }
    }
  }
  return errors;
}

// ── Repair Prompt Builder ─────────────────────────────────────────────────────

export function buildRepairPrompt(summary: BrowserCaptureSummary): RepairPrompt {
  const topErrors = summary.consoleErrors
    .filter((e) => e.severity === "error")
    .slice(0, 3)
    .map((e) => `  - [${e.source}] ${e.message}`)
    .join("\n");

  const topNetworkFails = summary.networkFailures
    .slice(0, 2)
    .map((f) => `  - ${f.method} ${f.url} → ${f.statusCode ?? "network error"}`)
    .join("\n");

  const hasErrors = topErrors.length > 0;
  const hasNetwork = topNetworkFails.length > 0;

  const errorContext = [
    hasErrors ? `Console errors:\n${topErrors}` : "",
    hasNetwork ? `Network failures:\n${topNetworkFails}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const summary_text =
    `Preview at ${summary.previewUrl} has ` +
    [
      summary.consoleErrors.filter((e) => e.severity === "error").length > 0
        ? `${summary.consoleErrors.filter((e) => e.severity === "error").length} console error(s)`
        : "",
      summary.networkFailures.length > 0
        ? `${summary.networkFailures.length} network failure(s)`
        : "",
    ]
      .filter(Boolean)
      .join(" and ");

  const suggestedAction = summary.hasBlockingErrors
    ? "Fix the blocking runtime errors before verifying the feature works."
    : "Investigate the non-blocking errors and network failures if they affect functionality.";

  const fullPrompt = [
    `[BROWSER PREVIEW FAILURE] ${summary_text}`,
    "",
    errorContext,
    "",
    suggestedAction,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  return {
    summary: summary_text,
    errorContext,
    suggestedAction,
    fullPrompt,
  };
}

// ── JSONL Persistence ─────────────────────────────────────────────────────────

function failurePath(projectRoot: string): string {
  return join(projectRoot, ".danteforge", "preview-failures.jsonl");
}

export function recordPreviewFailure(
  record: Omit<PreviewFailureRecord, "recordedAt">,
  projectRoot: string,
): PreviewFailureRecord {
  const full: PreviewFailureRecord = { ...record, recordedAt: new Date().toISOString() };
  try {
    const dir = join(projectRoot, ".danteforge");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(failurePath(projectRoot), JSON.stringify(full) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
  return full;
}

export function loadPreviewFailures(projectRoot: string): PreviewFailureRecord[] {
  const path = failurePath(projectRoot);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as PreviewFailureRecord);
  } catch {
    return [];
  }
}

export function getPreviewRepairSuccessRate(records: PreviewFailureRecord[]): number {
  const attempted = records.filter((r) => r.repairAttempted);
  if (attempted.length === 0) return 0;
  const succeeded = attempted.filter((r) => r.repairSucceeded === true).length;
  return succeeded / attempted.length;
}

// ── Session Statistics ────────────────────────────────────────────────────────

export interface PreviewSessionStats {
  totalSessions: number;
  repairAttemptRate: number;
  repairSuccessRate: number;
  topErrorTypes: string[];
  avgErrorsPerSession: number;
}

export function getPreviewSessionStats(records: PreviewFailureRecord[]): PreviewSessionStats {
  const total = records.length;
  if (total === 0) {
    return { totalSessions: 0, repairAttemptRate: 0, repairSuccessRate: 0, topErrorTypes: [], avgErrorsPerSession: 0 };
  }

  const attempted = records.filter((r) => r.repairAttempted);
  const repairAttemptRate = attempted.length / total;

  const succeeded = attempted.filter((r) => r.repairSucceeded === true).length;
  const repairSuccessRate = attempted.length === 0 ? 0 : succeeded / attempted.length;

  const avgErrorsPerSession = records.reduce((sum, r) => sum + r.errorCount, 0) / total;

  // Count first "word:" token of topError field (e.g. "TypeError:" from "TypeError: x is not a function")
  const typeCounts = new Map<string, number>();
  for (const r of records) {
    if (!r.topError) continue;
    const firstToken = r.topError.split(/[\s:]/)[0];
    if (firstToken) {
      const key = `${firstToken}:`;
      typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
    }
  }
  const topErrorTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  return { totalSessions: total, repairAttemptRate, repairSuccessRate, topErrorTypes, avgErrorsPerSession };
}
