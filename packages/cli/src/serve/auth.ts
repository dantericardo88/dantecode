// ============================================================================
// @dantecode/cli — Serve: Auth Middleware
// Simple HTTP Basic authentication for the DanteCode server.
// When no password is configured, all requests are allowed (localhost-only).
// ============================================================================

import { timingSafeEqual } from "node:crypto";

/** Constant-time string comparison to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Authentication configuration. */
export interface AuthConfig {
  /** Password for HTTP Basic auth. From env DANTECODE_SERVER_PASSWORD. */
  password?: string;
  /** Username for HTTP Basic auth. Default: "dantecode". */
  username?: string;
}

/** Route response shape (minimal, to avoid circular import from router.ts). */
export interface RouteResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * Validate an incoming request's Authorization header against the configured
 * HTTP Basic credentials.
 *
 * Returns true when:
 * - No password is configured (open localhost mode), OR
 * - The request carries valid HTTP Basic credentials.
 */
export function checkAuth(
  headers: Record<string, string>,
  config: AuthConfig,
): boolean {
  // No password configured — allow all requests.
  if (!config.password) return true;

  const authHeader = headers["authorization"] ?? headers["Authorization"] ?? "";
  if (!authHeader.startsWith("Basic ")) return false;

  const encoded = authHeader.slice("Basic ".length);
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf-8");
  } catch {
    return false;
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return false;

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  const expectedUsername = config.username ?? "dantecode";
  return safeCompare(username, expectedUsername) && safeCompare(password, config.password ?? "");
}

/**
 * Build a 401 Unauthorized response with WWW-Authenticate header.
 */
export function unauthorizedResponse(): RouteResponse {
  return {
    status: 401,
    body: { error: "Unauthorized — set Authorization: Basic base64(dantecode:<password>)" },
    headers: {
      "WWW-Authenticate": 'Basic realm="DanteCode"',
    },
  };
}
