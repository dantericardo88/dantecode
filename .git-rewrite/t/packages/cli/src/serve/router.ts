// ============================================================================
// @dantecode/cli — Serve: Lightweight HTTP Router
// Pattern-matching router for DanteCode serve mode.
// Supports :param path segments, query string parsing, and JSON bodies.
// Zero external dependencies.
// ============================================================================

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/** A fully parsed incoming HTTP request. */
export interface ParsedRequest {
  method: HttpMethod;
  path: string;
  /** URL path parameters extracted from :param segments. */
  params: Record<string, string>;
  /** Query string parameters. */
  query: Record<string, string>;
  /** Parsed JSON body (or raw string if not JSON). */
  body: unknown;
  headers: Record<string, string>;
}

/** The response a route handler must return. */
export interface RouteResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** A route handler function. */
export type RouteHandler = (req: ParsedRequest) => Promise<RouteResponse>;

interface RouteEntry {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

/**
 * Compile a path template into a RegExp and a list of parameter names.
 *
 * Examples:
 *   "/api/health"              → /^\/api\/health$/, []
 *   "/api/sessions/:id"        → /^\/api\/sessions\/([^/]+)$/, ["id"]
 *   "/api/sessions/:id/msg/:n" → /^\/api\/sessions\/([^/]+)\/msg\/([^/]+)$/, ["id", "n"]
 */
function compilePattern(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, (ch) =>
    // Don't escape colons — they're our param markers
    ch === ":" ? ":" : `\\${ch}`,
  );
  const regexStr = escaped
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        paramNames.push(segment.slice(1));
        return "([^/]+)";
      }
      return segment;
    })
    .join("/");
  return { pattern: new RegExp(`^${regexStr}$`), paramNames };
}

/**
 * Lightweight HTTP router for DanteCode serve mode.
 *
 * Usage:
 *   const router = new Router();
 *   router.get("/api/health", async () => ({ status: 200, body: { ok: true } }));
 *   router.post("/api/sessions/:id/message", handleMessage);
 *   const response = await router.handle(parsedReq);
 */
export class Router {
  private routes: RouteEntry[] = [];

  /** Register a route with explicit method. Supports :param path segments. */
  route(method: HttpMethod, path: string, handler: RouteHandler): void {
    const { pattern, paramNames } = compilePattern(path);
    this.routes.push({ method, pattern, paramNames, handler });
  }

  /** GET shorthand. */
  get(path: string, handler: RouteHandler): void {
    this.route("GET", path, handler);
  }

  /** POST shorthand. */
  post(path: string, handler: RouteHandler): void {
    this.route("POST", path, handler);
  }

  /** PUT shorthand. */
  put(path: string, handler: RouteHandler): void {
    this.route("PUT", path, handler);
  }

  /** DELETE shorthand. */
  delete(path: string, handler: RouteHandler): void {
    this.route("DELETE", path, handler);
  }

  /**
   * Match a request to the first route where both path AND method match.
   *
   * - Iterates all routes; does NOT stop on a path-match-but-method-mismatch.
   * - Returns the handler response on first full (path + method) match.
   * - Returns 405 if the path was recognized but no method matched.
   * - Returns 404 if no route matched the path at all.
   */
  async handle(req: ParsedRequest): Promise<RouteResponse> {
    let pathMatched = false;

    for (const entry of this.routes) {
      const match = entry.pattern.exec(req.path);
      if (!match) continue;

      // Mark that the path was recognized (for 404 vs 405 disambiguation)
      pathMatched = true;

      if (entry.method !== req.method) {
        // Keep iterating — a later entry may match both path and method
        continue;
      }

      // Full match — extract path params and execute handler
      const params: Record<string, string> = {};
      for (let i = 0; i < entry.paramNames.length; i++) {
        params[entry.paramNames[i]!] = match[i + 1]!;
      }

      return entry.handler({ ...req, params });
    }

    if (pathMatched) {
      return {
        status: 405,
        body: { error: `Method ${req.method} not allowed for ${req.path}` },
      };
    }

    return { status: 404, body: { error: `Not found: ${req.method} ${req.path}` } };
  }
}
