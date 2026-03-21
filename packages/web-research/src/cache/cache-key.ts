import { createHash } from "node:crypto";

/**
 * Normalizes a query string for consistent caching.
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s]/g, "");
}

/**
 * Generates a deterministic hash for a normalized query and optional context.
 */
export function generateCacheKey(query: string, context: Record<string, unknown> = {}): string {
  const normalized = normalizeQuery(query);
  const contextStr = JSON.stringify(context, Object.keys(context).sort());
  return createHash("sha256").update(`${normalized}|${contextStr}`).digest("hex").slice(0, 32);
}

/**
 * Normalizes a URL for consistent caching and deduplication.
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.toLowerCase());
    const host = parsed.hostname.replace(/^www\./, "");
    let path = parsed.pathname.replace(/\/+$/, "");
    if (!path) path = "/";

    // Sort query parameters
    const params = new URLSearchParams(parsed.search);
    params.sort();
    const search = params.toString();

    return `${host}${path}${search ? "?" + search : ""}`;
  } catch {
    return url.toLowerCase().trim();
  }
}
