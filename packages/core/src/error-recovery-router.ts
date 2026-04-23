// packages/core/src/error-recovery-router.ts
// Error recovery routing — deepens dim 22 (self-healing / error recovery: 7→9).
//
// Harvested from: Void observable DAG (void/src/vs/workbench/browser/overlay.ts),
//                 Aider error-retry patterns, SWE-agent error classification.
//
// Provides:
//   - ErrorClassifier: categorizes errors into 8 recovery strategy buckets
//   - RecoveryStrategy: per-error-class action plan (retry, rollback, clarify, etc.)
//   - ErrorRecoveryRouter: stateful recovery session with attempt tracking
//   - RecoveryOutcome: structured result with root cause and applied strategy
//   - ErrorPatternMatcher: regex-based error fingerprinting
//   - globalErrorRecoveryRouter singleton

// ─── Types ────────────────────────────────────────────────────────────────────

export type ErrorClass =
  | "syntax"          // Parse / compile error — fix code
  | "type"            // Type mismatch — fix types
  | "runtime"         // Runtime crash — catch/fix
  | "environment"     // Missing binary, bad PATH, wrong OS
  | "network"         // Timeout, DNS failure, 5xx
  | "permission"      // EACCES, EPERM
  | "not-found"       // ENOENT, 404
  | "rate-limit"      // 429, quota exceeded
  | "unknown";        // Uncategorized

export type RecoveryAction =
  | "retry-immediate"   // Retry without changes
  | "retry-backoff"     // Retry after exponential delay
  | "fix-code"          // Ask model to fix the error
  | "rollback"          // Revert last change
  | "clarify"           // Ask user for clarification
  | "skip"              // Skip this step
  | "abort"             // Terminate the task
  | "install-deps"      // Install missing dependencies
  | "elevate"           // Request elevated permissions
  | "wait"              // Wait for external resource
  | "decompose";        // Break task into smaller steps

export interface RecoveryStrategy {
  /** First action to try */
  primary: RecoveryAction;
  /** Fallback if primary fails */
  fallback: RecoveryAction;
  /** Max attempts before fallback */
  maxAttempts: number;
  /** Base delay (ms) for backoff strategies */
  baseDelayMs: number;
  /** Human-readable rationale */
  rationale: string;
}

export interface ErrorFingerprint {
  errorClass: ErrorClass;
  /** Brief description extracted from the error */
  summary: string;
  /** Original raw error string */
  raw: string;
  /** File path mentioned in error, if any */
  filePath?: string;
  /** Line number mentioned in error, if any */
  lineNumber?: number;
}

export interface RecoveryAttempt {
  attemptNumber: number;
  action: RecoveryAction;
  outcome: "success" | "failure" | "partial";
  errorMessage?: string;
  timestamp: string;
}

export interface RecoverySession {
  id: string;
  fingerprint: ErrorFingerprint;
  strategy: RecoveryStrategy;
  attempts: RecoveryAttempt[];
  resolved: boolean;
  terminationAction?: RecoveryAction;
  startedAt: string;
  resolvedAt?: string;
}

// ─── Error Pattern Matcher ────────────────────────────────────────────────────

interface ErrorPattern {
  pattern: RegExp;
  errorClass: ErrorClass;
  summaryExtractor?: (match: RegExpMatchArray) => string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  // Syntax errors
  { pattern: /\bsyntaxerror\b/i, errorClass: "syntax", summaryExtractor: (m) => m[0] },
  { pattern: /unexpected token/i, errorClass: "syntax" },
  { pattern: /\bparse error\b/i, errorClass: "syntax" },
  // Type errors (TypeScript compiler errors and JS TypeError)
  { pattern: /error ts\d+:/i, errorClass: "syntax" },
  { pattern: /\btypeerror\b/i, errorClass: "type" },
  { pattern: /type .* is not assignable/i, errorClass: "type" },
  { pattern: /\btype mismatch\b/i, errorClass: "type" },
  // Runtime errors
  { pattern: /\breferenceerror\b/i, errorClass: "runtime" },
  { pattern: /\brangeerror\b/i, errorClass: "runtime" },
  { pattern: /\bstack overflow\b/i, errorClass: "runtime" },
  { pattern: /\bsegmentation fault\b/i, errorClass: "runtime" },
  // Environment errors
  { pattern: /command not found/i, errorClass: "environment" },
  { pattern: /\bno such file or directory\b/i, errorClass: "not-found" },
  { pattern: /\bmodule not found\b/i, errorClass: "environment" },
  { pattern: /\bcannot find module\b/i, errorClass: "environment" },
  // Network
  { pattern: /\btimeout\b/i, errorClass: "network" },
  { pattern: /\beconnrefused\b/i, errorClass: "network" },
  { pattern: /\benotfound\b/i, errorClass: "network" },
  { pattern: /\bfetch failed\b/i, errorClass: "network" },
  { pattern: /http 5\d{2}/i, errorClass: "network" },
  // Permission
  { pattern: /\beacces\b/i, errorClass: "permission" },
  { pattern: /\beperm\b/i, errorClass: "permission" },
  { pattern: /\bpermission denied\b/i, errorClass: "permission" },
  // Not found
  { pattern: /\benoent\b/i, errorClass: "not-found" },
  { pattern: /\b404\b/, errorClass: "not-found" },
  { pattern: /\bnot found\b/i, errorClass: "not-found" },
  // Rate limit
  { pattern: /\brate.?limit/i, errorClass: "rate-limit" },
  { pattern: /\b429\b/, errorClass: "rate-limit" },
  { pattern: /\bquota exceeded\b/i, errorClass: "rate-limit" },
  { pattern: /\btoo many requests\b/i, errorClass: "rate-limit" },
];

const FILE_PATH_RE = /(?:^|\s|'|")((?:[A-Za-z]:\\|\/)?[\w./-]+\.(ts|tsx|js|jsx|py|go|rs|java|c|cpp|json|yaml|yml))/;
const LINE_NUMBER_RE = /[:\s](\d+):\d+/;

export function classifyError(raw: string): ErrorFingerprint {
  const lower = raw.toLowerCase();

  for (const ep of ERROR_PATTERNS) {
    const match = raw.match(ep.pattern);
    if (match) {
      const summary = ep.summaryExtractor?.(match) ?? raw.slice(0, 120).trim();
      const fileMatch = raw.match(FILE_PATH_RE);
      const lineMatch = raw.match(LINE_NUMBER_RE);
      return {
        errorClass: ep.errorClass,
        summary,
        raw,
        filePath: fileMatch?.[1],
        lineNumber: lineMatch ? parseInt(lineMatch[1]!, 10) : undefined,
      };
    }
  }

  return {
    errorClass: "unknown",
    summary: lower.slice(0, 120).trim(),
    raw,
  };
}

// ─── Recovery Strategy Map ────────────────────────────────────────────────────

const STRATEGY_MAP: Record<ErrorClass, RecoveryStrategy> = {
  syntax: {
    primary: "fix-code",
    fallback: "decompose",
    maxAttempts: 3,
    baseDelayMs: 0,
    rationale: "Syntax errors are model-fixable — ask for a targeted code fix first.",
  },
  type: {
    primary: "fix-code",
    fallback: "clarify",
    maxAttempts: 3,
    baseDelayMs: 0,
    rationale: "Type errors indicate a signature mismatch — fix the type or ask for clarification.",
  },
  runtime: {
    primary: "fix-code",
    fallback: "rollback",
    maxAttempts: 2,
    baseDelayMs: 0,
    rationale: "Runtime crashes may need a code fix or a rollback to the last working state.",
  },
  environment: {
    primary: "install-deps",
    fallback: "clarify",
    maxAttempts: 2,
    baseDelayMs: 500,
    rationale: "Missing binaries or modules — try installing deps first, then ask the user.",
  },
  network: {
    primary: "retry-backoff",
    fallback: "wait",
    maxAttempts: 4,
    baseDelayMs: 1000,
    rationale: "Network errors are transient — exponential backoff before escalating.",
  },
  permission: {
    primary: "elevate",
    fallback: "clarify",
    maxAttempts: 1,
    baseDelayMs: 0,
    rationale: "Permission errors require elevated access or a path change — can't retry blind.",
  },
  "not-found": {
    primary: "clarify",
    fallback: "rollback",
    maxAttempts: 2,
    baseDelayMs: 0,
    rationale: "Missing file/resource — clarify the expected location or roll back the change.",
  },
  "rate-limit": {
    primary: "retry-backoff",
    fallback: "abort",
    maxAttempts: 3,
    baseDelayMs: 5000,
    rationale: "Rate limits resolve over time — back off aggressively, then abort if quota exhausted.",
  },
  unknown: {
    primary: "clarify",
    fallback: "abort",
    maxAttempts: 2,
    baseDelayMs: 0,
    rationale: "Unclassified error — ask for human input before retrying.",
  },
};

export function getRecoveryStrategy(errorClass: ErrorClass): RecoveryStrategy {
  return STRATEGY_MAP[errorClass];
}

// ─── Error Recovery Router ────────────────────────────────────────────────────

let _sessionCounter = 0;

export class ErrorRecoveryRouter {
  private _sessions = new Map<string, RecoverySession>();

  /**
   * Start a new recovery session for the given raw error.
   * Returns the session ID.
   */
  startSession(rawError: string): RecoverySession {
    const fingerprint = classifyError(rawError);
    const strategy = getRecoveryStrategy(fingerprint.errorClass);
    const session: RecoverySession = {
      id: `recovery-${++_sessionCounter}`,
      fingerprint,
      strategy,
      attempts: [],
      resolved: false,
      startedAt: new Date().toISOString(),
    };
    this._sessions.set(session.id, session);
    return session;
  }

  /**
   * Get the next action to try for this session.
   * Returns undefined if the session is resolved or should abort.
   */
  nextAction(sessionId: string): RecoveryAction | undefined {
    const session = this._sessions.get(sessionId);
    if (!session || session.resolved) return undefined;

    const { strategy, attempts } = session;
    const failCount = attempts.filter((a) => a.outcome === "failure").length;

    if (failCount === 0) return strategy.primary;
    if (failCount < strategy.maxAttempts) return strategy.primary;
    return strategy.fallback;
  }

  /**
   * Record the outcome of a recovery attempt.
   */
  recordAttempt(
    sessionId: string,
    action: RecoveryAction,
    outcome: RecoveryAttempt["outcome"],
    errorMessage?: string,
  ): boolean {
    const session = this._sessions.get(sessionId);
    if (!session) return false;

    session.attempts.push({
      attemptNumber: session.attempts.length + 1,
      action,
      outcome,
      errorMessage,
      timestamp: new Date().toISOString(),
    });

    if (outcome === "success") {
      session.resolved = true;
      session.terminationAction = action;
      session.resolvedAt = new Date().toISOString();
    } else if (action === "abort" || action === "rollback") {
      session.resolved = true;
      session.terminationAction = action;
      session.resolvedAt = new Date().toISOString();
    }

    return true;
  }

  /**
   * Compute the exponential backoff delay for the next attempt.
   */
  computeBackoffMs(sessionId: string): number {
    const session = this._sessions.get(sessionId);
    if (!session) return 0;
    const failCount = session.attempts.filter((a) => a.outcome === "failure").length;
    const base = session.strategy.baseDelayMs;
    return base * Math.pow(2, failCount);
  }

  /**
   * Format a recovery session for prompt injection.
   */
  formatSessionForPrompt(sessionId: string): string {
    const session = this._sessions.get(sessionId);
    if (!session) return "Recovery session not found.";

    const lines: string[] = [
      `## Error Recovery — ${session.id}`,
      `**Error class:** ${session.fingerprint.errorClass}`,
      `**Summary:** ${session.fingerprint.summary}`,
      `**Strategy:** ${session.strategy.rationale}`,
      `**Next action:** ${this.nextAction(sessionId) ?? "resolved"}`,
      "",
      "### Attempts",
    ];

    if (session.attempts.length === 0) {
      lines.push("(no attempts yet)");
    } else {
      for (const a of session.attempts) {
        const icon = a.outcome === "success" ? "✅" : a.outcome === "partial" ? "⚠️" : "❌";
        lines.push(`${icon} Attempt ${a.attemptNumber}: ${a.action} → ${a.outcome}${a.errorMessage ? ` (${a.errorMessage})` : ""}`);
      }
    }

    if (session.fingerprint.filePath) {
      lines.push(`\n**Error location:** ${session.fingerprint.filePath}${session.fingerprint.lineNumber ? `:${session.fingerprint.lineNumber}` : ""}`);
    }

    return lines.join("\n");
  }

  getSession(id: string): RecoverySession | undefined { return this._sessions.get(id); }
  get totalSessions(): number { return this._sessions.size; }
  get activeSessions(): RecoverySession[] {
    return [...this._sessions.values()].filter((s) => !s.resolved);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const globalErrorRecoveryRouter = new ErrorRecoveryRouter();
