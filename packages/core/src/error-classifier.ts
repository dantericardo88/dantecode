// ============================================================================
// @dantecode/core — API Error Classifier
// Typed error classification for LLM API failures.
// Pattern harvested from Cline (Apache-2.0): ClineError.ts + context-error-handling.ts
// Key invariant: check most-specific error type first (Balance > Auth > RateLimit > Context > Network)
// ============================================================================

export enum DanteErrorType {
  /** Invalid API key, expired token, or permission denied. Do NOT retry. */
  Auth = "auth",
  /** Insufficient credits / balance exhausted. Do NOT retry. */
  Balance = "balance",
  /** HTTP 429 or quota exceeded. Retry with exponential backoff. */
  RateLimit = "rateLimit",
  /** Context window exceeded. Requires compression, not retry. */
  ContextWindow = "contextWindow",
  /** Transient network error. Retry with backoff. */
  Network = "network",
  /** Circuit breaker is open for this provider. Wait for reset window — do NOT retry immediately. */
  CircuitOpen = "circuitOpen",
  /** Unknown / unclassified error. Retry with caution. */
  Unknown = "unknown",
}

/** Whether this error type should ever be retried. */
export const RETRYABLE_ERROR_TYPES = new Set<DanteErrorType>([
  DanteErrorType.RateLimit,
  DanteErrorType.Network,
  DanteErrorType.Unknown,
]);

/** Error types that are terminal — no amount of retrying will fix them. */
export const TERMINAL_ERROR_TYPES = new Set<DanteErrorType>([
  DanteErrorType.Auth,
  DanteErrorType.Balance,
]);

// Regex bank for rate-limit detection across providers (Anthropic, OpenAI, OpenRouter, Bedrock, Vertex)
const RATE_LIMIT_PATTERNS: RegExp[] = [
  /status code 429/i,
  /quota exceeded/i,
  /resource.?exhausted/i,
  /rate limit/i,
  /too many requests/i,
  /ratelimit/i,
  /throttl/i,
];

// Regex bank for context window errors
const CONTEXT_WINDOW_PATTERNS: RegExp[] = [
  /context_length_exceeded/i,
  /context window/i,
  /maximum context/i,
  /max_tokens.*exceed/i,
  /token limit/i,
  /prompt is too long/i,
  /exceeds.*context/i,
  /input is too long/i,
  /too many tokens/i,
  /invalid_request_error/i,   // Anthropic's error type for context overflow
];

// Regex bank for auth errors
const AUTH_PATTERNS: RegExp[] = [
  /invalid api key/i,
  /api key.*invalid/i,
  /authentication/i,
  /unauthorized/i,
  /permission denied/i,
  /access denied/i,
  /invalid_api_key/i,
];

// Regex bank for balance/credit errors
const BALANCE_PATTERNS: RegExp[] = [
  /insufficient_credits/i,
  /insufficient credits/i,
  /out of credits/i,
  /billing/i,
  /payment required/i,
  /account.*balance/i,
  /no credits/i,
  /credit balance/i,
];

// Network patterns
const NETWORK_PATTERNS: RegExp[] = [
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ENOTFOUND/,
  /network.*error/i,
  /socket.*hang up/i,
  /connection.*reset/i,
  /fetch.*failed/i,
];

interface ClassifiableError {
  message?: string;
  status?: number;
  code?: string;
  type?: string;
  /** HTTP response status nested inside the error object */
  response?: { status?: number };
}

/**
 * Classify an API error into a typed `DanteErrorType`.
 *
 * Specificity order (Cline pattern — most specific first):
 * 1. Balance (most specific — has a `current_balance` field or explicit credit message)
 * 2. Auth (status 401–403 or explicit key error)
 * 3. RateLimit (status 429 or rate-limit message)
 * 4. ContextWindow (context length exceeded)
 * 5. Network (transient TCP/fetch failure)
 * 6. Unknown (fallback)
 */
export function classifyError(err: unknown): DanteErrorType {
  // 0. CircuitOpenError — duck-type check avoids circular import from circuit-breaker.ts.
  // CircuitOpenError always has name="CircuitOpenError" and a string "provider" field.
  if (
    err instanceof Error &&
    err.name === "CircuitOpenError" &&
    "provider" in err &&
    typeof (err as Record<string, unknown>)["provider"] === "string"
  ) {
    return DanteErrorType.CircuitOpen;
  }

  const e = toClassifiable(err);
  const message = e.message ?? "";
  const status = e.status ?? e.response?.status;

  // 1. Balance — check before auth because insufficient_credits returns 400 (same as auth)
  if (BALANCE_PATTERNS.some((p) => p.test(message))) {
    return DanteErrorType.Balance;
  }

  // 2. Auth — 401/403 or explicit auth message
  if (status === 401 || status === 403 || AUTH_PATTERNS.some((p) => p.test(message))) {
    return DanteErrorType.Auth;
  }

  // 3. RateLimit — 429 or pattern match
  if (status === 429 || RATE_LIMIT_PATTERNS.some((p) => p.test(message))) {
    return DanteErrorType.RateLimit;
  }

  // 4. ContextWindow
  if (CONTEXT_WINDOW_PATTERNS.some((p) => p.test(message))) {
    // Additional Anthropic check: type === "invalid_request_error" on a 400 is context overflow
    if (e.type === "invalid_request_error" || status === 400) {
      if (/too long|context|token/i.test(message)) {
        return DanteErrorType.ContextWindow;
      }
    }
    return DanteErrorType.ContextWindow;
  }

  // 5. Network
  if (NETWORK_PATTERNS.some((p) => p.test(message))) {
    return DanteErrorType.Network;
  }

  return DanteErrorType.Unknown;
}

/**
 * Returns true if the error type should trigger an auto-retry.
 * Auth and Balance errors are always terminal.
 * Context window requires compression, not retry.
 */
export function isRetryable(type: DanteErrorType): boolean {
  return RETRYABLE_ERROR_TYPES.has(type);
}

/**
 * Returns true if the error is non-recoverable without external action
 * (bad key, empty wallet).
 */
export function isTerminal(type: DanteErrorType): boolean {
  return TERMINAL_ERROR_TYPES.has(type);
}

/**
 * Returns true for circuit-open errors.
 * The circuit breaker has its own reset window — do not use standard retry backoff.
 * The error carries a `provider` field indicating which provider is blocked.
 */
export function isCircuitOpen(type: DanteErrorType): boolean {
  return type === DanteErrorType.CircuitOpen;
}

/**
 * Exponential backoff delay for retryable errors (Cline pattern: 2s × 2^attempt, cap at 30s).
 * Returns 0 for non-retryable errors.
 */
export function getRetryDelayMs(type: DanteErrorType, attempt: number): number {
  if (!isRetryable(type)) return 0;
  const baseMs = type === DanteErrorType.RateLimit ? 5000 : 2000;
  return Math.min(baseMs * Math.pow(2, attempt - 1), 30_000);
}

function toClassifiable(err: unknown): ClassifiableError {
  if (err === null || typeof err !== "object") {
    return { message: String(err) };
  }
  const e = err as Record<string, unknown>;
  return {
    message:
      typeof e["message"] === "string"
        ? e["message"]
        : typeof e["error"] === "string"
          ? e["error"]
          : "",
    status:
      typeof e["status"] === "number"
        ? e["status"]
        : typeof e["statusCode"] === "number"
          ? e["statusCode"]
          : undefined,
    code: typeof e["code"] === "string" ? e["code"] : undefined,
    type: typeof e["type"] === "string" ? e["type"] : undefined,
    response:
      e["response"] && typeof e["response"] === "object"
        ? { status: (e["response"] as Record<string, unknown>)["status"] as number | undefined }
        : undefined,
  };
}
