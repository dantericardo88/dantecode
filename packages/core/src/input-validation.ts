// ============================================================================
// packages/core/src/input-validation.ts
//
// Input validation and sanitization primitives. Use at boundary points
// (user-supplied paths, command strings, URLs, model output that becomes
// part of file paths or shell commands) to prevent path traversal, command
// injection, SSRF, and HTML injection.
//
// Design choices:
//   - Each validator returns a discriminated union { ok: true; value } |
//     { ok: false; reason } so callers can pattern-match without a try/catch
//     dance.
//   - Throwing variants (assertValid*) are also provided for flows where
//     a thrown DanteCodeError integrates with the existing error hierarchy.
//   - Conservative-by-default: when in doubt, reject.
// ============================================================================

import { ValidationError } from "./errors.js";

// ── Result type ────────────────────────────────────────────────────────────

export type ValidationResult<T = string> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

// ── File path validation ───────────────────────────────────────────────────

/**
 * Reject paths that try to escape a project root via "..", absolute roots,
 * or null bytes. Returns the normalized relative path on success.
 *
 * Common attack: tool emits `file_path: "../../../etc/passwd"`.
 */
export function validateRelativePath(input: string): ValidationResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "path must be a string" };
  if (input.length === 0) return { ok: false, reason: "path cannot be empty" };
  if (input.includes("\0")) return { ok: false, reason: "path contains null byte" };
  if (/^[A-Za-z]:[\\/]|^\//.test(input)) return { ok: false, reason: "absolute paths not allowed" };
  // Reject any "..": even legit ../sibling could be a traversal. Force callers
  // to be explicit if they need it.
  const segments = input.split(/[\\/]/);
  if (segments.some((s) => s === "..")) return { ok: false, reason: "parent traversal (..) not allowed" };
  if (segments.some((s) => s.startsWith(".") && s !== "." && !s.match(/^\.[a-zA-Z0-9]/))) {
    return { ok: false, reason: "hidden segments not allowed" };
  }
  // Normalize: collapse double slashes, remove leading "./".
  let normalized = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  return { ok: true, value: normalized };
}

/**
 * Throwing variant. Returns the normalized path or throws ValidationError.
 */
export function assertValidRelativePath(input: string, fieldName = "filePath"): string {
  const result = validateRelativePath(input);
  if (!result.ok) throw new ValidationError(fieldName, result.reason);
  return result.value;
}

// ── URL validation ─────────────────────────────────────────────────────────

/**
 * Reject URLs that aren't http(s), or that target localhost/private IPs (SSRF
 * protection). Use for any URL the agent loop or user supplies that we'll
 * fetch from. Localhost is an opt-in flag for local dev tools.
 */
export function validateHttpUrl(
  input: string,
  options: { allowLocalhost?: boolean } = {},
): ValidationResult<URL> {
  if (typeof input !== "string") return { ok: false, reason: "url must be a string" };
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: `protocol "${parsed.protocol}" not allowed (http/https only)` };
  }
  if (!options.allowLocalhost) {
    // Strip IPv6 brackets ("[::1]" → "::1") so the literal compare works.
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { ok: false, reason: "localhost not allowed" };
    }
    // Reject RFC1918 private ranges to block internal-network SSRF
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/.test(host)) {
      return { ok: false, reason: "private IP range not allowed" };
    }
  }
  return { ok: true, value: parsed };
}

export function assertValidHttpUrl(
  input: string,
  options?: { allowLocalhost?: boolean },
): URL {
  const result = validateHttpUrl(input, options);
  if (!result.ok) throw new ValidationError("url", result.reason);
  return result.value;
}

// ── Provider/model identifier ──────────────────────────────────────────────

const KNOWN_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "grok",
  "ollama",
  "google",
  "deepseek",
  "mistral",
  "azure-openai",
  "openrouter",
]);

/**
 * Validate that a string is a known provider identifier. Prevents user-input
 * surprises like `provider: "../etc/passwd"` or `provider: "javascript:..."`.
 */
export function validateProvider(input: string): ValidationResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "provider must be a string" };
  const normalized = input.trim().toLowerCase();
  if (!KNOWN_PROVIDERS.has(normalized)) {
    return { ok: false, reason: `unknown provider "${input}". Allowed: ${[...KNOWN_PROVIDERS].join(", ")}` };
  }
  return { ok: true, value: normalized };
}

// ── Shell command sanitization ────────────────────────────────────────────

/**
 * Detect shell-meta characters that turn a single command into multiple
 * (`&&`, `||`, `;`, backticks, command substitution). Caller decides whether
 * to reject or escape.
 */
export function containsShellMeta(input: string): boolean {
  return /[;&|`$\\]|>>?|<<?|\|\||&&|\$\(/.test(input);
}

/**
 * Validate a command-line argument has no shell metacharacters.
 */
export function validateShellArg(input: string): ValidationResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "argument must be a string" };
  if (containsShellMeta(input)) {
    return { ok: false, reason: "shell metacharacters not allowed in argument" };
  }
  return { ok: true, value: input };
}

// ── HTML escaping (for any code that builds HTML from user data) ──────────

/**
 * Escape HTML special characters so user-provided strings can be safely
 * interpolated into innerHTML / template literals. Use this whenever a
 * webview renders model output, tool results, or user input into the DOM.
 *
 * Replaces & < > " ' / with their HTML entity equivalents.
 */
export function escapeHtml(input: string): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");
}

// ── Length / bounds checks ────────────────────────────────────────────────

/**
 * Generic bounded-length string validator. Use for prompts, file contents
 * passed via tools, anything where unbounded input is a DoS vector.
 */
export function validateBoundedString(
  input: string,
  options: { min?: number; max: number; fieldName?: string },
): ValidationResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "expected a string" };
  const min = options.min ?? 0;
  if (input.length < min) {
    return { ok: false, reason: `${options.fieldName ?? "value"} too short (min ${min} chars)` };
  }
  if (input.length > options.max) {
    return { ok: false, reason: `${options.fieldName ?? "value"} too long (max ${options.max} chars)` };
  }
  return { ok: true, value: input };
}

// ── JSON parsing with size limit ──────────────────────────────────────────

/**
 * Parse JSON with a size limit and structured error. Use for tool inputs,
 * config files, model outputs that should be JSON. Plain JSON.parse loses
 * the field context on error; this preserves it.
 */
export function parseJsonBounded<T = unknown>(
  input: string,
  options: { maxBytes?: number; fieldName?: string } = {},
): ValidationResult<T> {
  const maxBytes = options.maxBytes ?? 1024 * 1024; // 1 MiB default
  if (input.length > maxBytes) {
    return { ok: false, reason: `JSON exceeds ${maxBytes} bytes` };
  }
  try {
    return { ok: true, value: JSON.parse(input) as T };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `JSON parse failed: ${message}` };
  }
}
