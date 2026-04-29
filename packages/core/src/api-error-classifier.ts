import type { ModelProvider } from "@dantecode/config-types";

export type ParsedApiErrorCategory =
  | "rate_limit"
  | "context_overflow"
  | "auth"
  | "quota"
  | "invalid_request"
  | "tool_schema"
  | "timeout"
  | "network"
  | "server"
  | "unknown";

export interface ParsedApiError {
  category: ParsedApiErrorCategory;
  message: string;
  provider?: ModelProvider | string;
  statusCode?: number;
  isRetryable: boolean;
  retryAfterMs?: number;
  raw: unknown;
}

const CONTEXT_OVERFLOW_PATTERNS = [
  /maximum context length/i,
  /context window/i,
  /too many tokens/i,
  /prompt is too long/i,
  /request exceeds .*token/i,
  /input is too long/i,
  /context_length_exceeded/i,
];

const RATE_LIMIT_PATTERNS = [/rate limit/i, /too many requests/i, /\b429\b/];
const AUTH_PATTERNS = [
  /unauthorized/i,
  /authentication/i,
  /invalid api key/i,
  /forbidden/i,
  /\b401\b/,
  /\b403\b/,
];
const QUOTA_PATTERNS = [/quota/i, /credit balance/i, /insufficient[_\s-]?quota/i];
const TOOL_SCHEMA_PATTERNS = [
  /tool.*schema/i,
  /invalid tool/i,
  /function call/i,
  /json schema/i,
  /malformed tool/i,
];
const INVALID_REQUEST_PATTERNS = [/invalid request/i, /bad request/i, /\b400\b/, /\b422\b/];
const TIMEOUT_PATTERNS = [/timed out/i, /\b408\b/, /\b504\b/, /deadline exceeded/i];
const NETWORK_PATTERNS = [/econnreset/i, /enotfound/i, /socket hang up/i, /fetch failed/i, /network/i];
const SERVER_PATTERNS = [
  /internal server error/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /\b5\d\d\b/,
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  return String(error);
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidates = [
    (error as { status?: unknown }).status,
    (error as { statusCode?: unknown }).statusCode,
    (error as { response?: { status?: unknown } }).response?.status,
    (error as { cause?: { status?: unknown } }).cause?.status,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function readHeader(headers: unknown, key: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(key) ?? headers.get(key.toLowerCase()) ?? undefined;
  }

  if (headers instanceof Map) {
    return headers.get(key) ?? headers.get(key.toLowerCase());
  }

  if (typeof headers === "object") {
    const record = headers as Record<string, unknown>;
    const value = record[key] ?? record[key.toLowerCase()] ?? record[key.toUpperCase()];
    if (typeof value === "string") {
      return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
      return value[0];
    }
  }

  return undefined;
}

function getHeaders(error: unknown): unknown {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  return (
    (error as { headers?: unknown }).headers ??
    (error as { responseHeaders?: unknown }).responseHeaders ??
    (error as { response?: { headers?: unknown } }).response?.headers
  );
}

function matchesAny(patterns: RegExp[], message: string): boolean {
  return patterns.some((pattern) => pattern.test(message));
}

export function parseRetryAfterMs(
  headerValue: string | number | undefined,
  nowMs = Date.now(),
): number | undefined {
  if (headerValue === undefined) {
    return undefined;
  }

  if (typeof headerValue === "number" && Number.isFinite(headerValue)) {
    return Math.max(0, Math.round(headerValue * 1000));
  }

  const trimmed = String(headerValue).trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }

  const retryAtMs = Date.parse(trimmed);
  if (Number.isNaN(retryAtMs)) {
    return undefined;
  }

  return Math.max(0, retryAtMs - nowMs);
}

interface ClassificationRule {
  category: ParsedApiErrorCategory;
  isRetryable: boolean;
  /** When true, retryAfterMs is propagated onto the ParsedApiError. */
  surfaceRetryAfter?: boolean;
  matches: (statusCode: number | undefined, message: string) => boolean;
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    category: "rate_limit", isRetryable: true, surfaceRetryAfter: true,
    matches: (s, m) => s === 429 || matchesAny(RATE_LIMIT_PATTERNS, m),
  },
  {
    category: "context_overflow", isRetryable: false,
    matches: (_s, m) => matchesAny(CONTEXT_OVERFLOW_PATTERNS, m),
  },
  {
    category: "auth", isRetryable: false,
    matches: (s, m) => s === 401 || s === 403 || matchesAny(AUTH_PATTERNS, m),
  },
  {
    category: "quota", isRetryable: false,
    matches: (_s, m) => matchesAny(QUOTA_PATTERNS, m),
  },
  {
    category: "tool_schema", isRetryable: false,
    matches: (_s, m) => matchesAny(TOOL_SCHEMA_PATTERNS, m),
  },
  {
    category: "invalid_request", isRetryable: false,
    matches: (s, m) => s === 400 || s === 422 || matchesAny(INVALID_REQUEST_PATTERNS, m),
  },
  {
    category: "timeout", isRetryable: true,
    matches: (s, m) => s === 408 || s === 504 || matchesAny(TIMEOUT_PATTERNS, m),
  },
  {
    category: "network", isRetryable: true,
    matches: (_s, m) => matchesAny(NETWORK_PATTERNS, m),
  },
  {
    category: "server", isRetryable: true, surfaceRetryAfter: true,
    matches: (s, m) => (s !== undefined && s >= 500) || matchesAny(SERVER_PATTERNS, m),
  },
];

export function classifyApiError(
  error: unknown,
  provider?: ModelProvider | string,
  nowMs = Date.now(),
): ParsedApiError {
  const message = getErrorMessage(error);
  const statusCode = getStatusCode(error);
  const headers = getHeaders(error);
  const retryAfterMsHeader = readHeader(headers, "retry-after-ms");
  const retryAfterHeader = readHeader(headers, "retry-after");
  const retryAfterMs =
    (retryAfterMsHeader ? Number.parseInt(retryAfterMsHeader, 10) : undefined) ??
    parseRetryAfterMs(retryAfterHeader, nowMs);

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.matches(statusCode, message)) {
      return {
        category: rule.category,
        message,
        provider,
        statusCode,
        isRetryable: rule.isRetryable,
        ...(rule.surfaceRetryAfter ? { retryAfterMs } : {}),
        raw: error,
      };
    }
  }

  return {
    category: "unknown",
    message,
    provider,
    statusCode,
    isRetryable: false,
    retryAfterMs,
    raw: error,
  };
}
