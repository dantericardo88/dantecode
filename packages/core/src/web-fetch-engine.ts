/**
 * web-fetch-engine.ts
 *
 * Smart fetch engine with auto-escalation modes.
 * Uses fetchFn injection for testability. Only node:* built-ins.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FetchMode = "quick" | "full" | "structured";

export interface FetchOptions {
  /** Processing mode. Default: "quick" */
  mode?: FetchMode;
  /** CSS-like selector hint for content extraction. */
  selector?: string;
  /** Request timeout in ms. Default: 15000 */
  timeout?: number;
  /** Additional HTTP headers. */
  headers?: Record<string, string>;
  /** Pass JSON responses through without HTML-stripping. Default: true */
  jsonPassthrough?: boolean;
}

export interface FetchResult {
  /** Final URL that was fetched. */
  url: string;
  /** Mode used for this result. */
  mode: FetchMode;
  /** Extracted text content. */
  content: string;
  /** Page title (from <title> or og:title). */
  title?: string;
  /** Page description (from meta description or og:description). */
  description?: string;
  /** HTTP status code. */
  statusCode: number;
  /** Content-Type header value. */
  contentType: string;
  /** Approximate word count of extracted content. */
  wordCount: number;
  /** Confidence score 0-1 reflecting content quality. */
  confidence: number;
  /** ISO timestamp of when the page was fetched. */
  fetchedAt: string;
}

export type FetchFn = (
  url: string,
  options?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
) => Promise<{
  text(): Promise<string>;
  status: number;
  headers: { get(name: string): string | null };
}>;

export interface WebFetchEngineOptions {
  /** Injectable fetch for testing. Defaults to global fetch. */
  fetchFn?: FetchFn;
  /** Confidence below this triggers escalation in fetchSmart(). Default: 0.5 */
  lowConfidenceThreshold?: number;
  /** Max content length before truncation. Default: 50000 chars */
  maxContentLength?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_MAX_CONTENT = 50_000;
const DEFAULT_LOW_CONFIDENCE = 0.5;

const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&mdash;": "\u2014",
  "&ndash;": "\u2013",
  "&ldquo;": "\u201C",
  "&rdquo;": "\u201D",
  "&lsquo;": "\u2018",
  "&rsquo;": "\u2019",
  "&hellip;": "\u2026",
};

// ---------------------------------------------------------------------------
// WebFetchEngine
// ---------------------------------------------------------------------------

/**
 * Smart webpage fetch engine with quality-based auto-escalation.
 *
 * Modes:
 * - **quick**      — fetch once, basic text extraction
 * - **full**       — re-fetch if confidence is low; deeper extraction
 * - **structured** — extract by selector / structured sections
 *
 * @example
 * ```ts
 * const engine = new WebFetchEngine();
 * const result = await engine.fetchSmart("https://example.com");
 * console.log(result.content);
 * ```
 */
export class WebFetchEngine {
  private readonly fetchFn: FetchFn;
  private readonly lowConfidenceThreshold: number;
  private readonly maxContentLength: number;

  constructor(options: WebFetchEngineOptions = {}) {
    // Fall back to global fetch if available; otherwise a no-op stub that
    // tests will always override via injection.
    this.fetchFn =
      options.fetchFn ??
      (typeof fetch !== "undefined"
        ? (fetch as unknown as FetchFn)
        : async () => {
            throw new Error("No fetchFn provided and global fetch unavailable.");
          });
    this.lowConfidenceThreshold =
      options.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE;
    this.maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Fetch a URL and return a FetchResult.
   *
   * - Detects JSON and optionally passes it through unchanged.
   * - Parses HTML to extract title, description, and clean text.
   * - Truncates content to maxContentLength.
   *
   * @param url     - Target URL
   * @param options - Fetch options
   */
  async fetch(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    const mode = options.mode ?? "quick";
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    const jsonPassthrough = options.jsonPassthrough ?? true;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let rawBody = "";
    let statusCode = 0;
    let contentType = "";

    try {
      const mergedHeaders: Record<string, string> = {
        "User-Agent":
          "DanteCode-WebFetchEngine/1.0 (compatible; Mozilla/5.0)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        ...options.headers,
      };

      const response = await this.fetchFn(url, {
        headers: mergedHeaders,
        signal: controller.signal,
      });

      statusCode = response.status;
      contentType = response.headers.get("content-type") ?? "";
      rawBody = await response.text();
    } catch (err: unknown) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      // Return a graceful error result rather than throwing
      return this.buildErrorResult(url, mode, message);
    } finally {
      clearTimeout(timer);
    }

    // JSON passthrough
    if (jsonPassthrough && this.isJson(rawBody, contentType)) {
      const truncated = this.truncateContent(rawBody);
      const wordCount = this.countWords(truncated);
      const partial: FetchResult = {
        url,
        mode,
        content: truncated,
        statusCode,
        contentType,
        wordCount,
        confidence: 0,
        fetchedAt: new Date().toISOString(),
      };
      partial.confidence = this.computeConfidence(partial);
      return partial;
    }

    // HTML extraction
    const title = this.extractTitle(rawBody);
    const description = this.extractDescription(rawBody);
    const rawText = this.extractText(rawBody, options.selector);
    const content = this.truncateContent(rawText);
    const wordCount = this.countWords(content);

    const result: FetchResult = {
      url,
      mode,
      content,
      title: title || undefined,
      description: description || undefined,
      statusCode,
      contentType,
      wordCount,
      confidence: 0,
      fetchedAt: new Date().toISOString(),
    };

    result.confidence = this.computeConfidence(result);
    return result;
  }

  /**
   * Smart fetch that auto-escalates from "quick" to "full" when confidence
   * falls below the configured threshold.
   *
   * @param url     - Target URL
   * @param options - Fetch options (mode will be overridden by escalation logic)
   */
  async fetchSmart(url: string, options: FetchOptions = {}): Promise<FetchResult> {
    // Always start with quick mode
    const quickResult = await this.fetch(url, { ...options, mode: "quick" });

    if (quickResult.confidence >= this.lowConfidenceThreshold) {
      return quickResult;
    }

    // Escalate to full mode
    const fullResult = await this.fetch(url, { ...options, mode: "full" });
    return fullResult;
  }

  // -------------------------------------------------------------------------
  // HTML parsing helpers
  // -------------------------------------------------------------------------

  /**
   * Extract the text content of the `<title>` tag.
   *
   * @param html - Raw HTML string
   */
  extractTitle(html: string): string {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!match) return "";
    return this.decodeEntities(match[1]!.trim());
  }

  /**
   * Extract the content of `<meta name="description">` or
   * `<meta property="og:description">`.
   *
   * @param html - Raw HTML string
   */
  extractDescription(html: string): string {
    // Standard meta description
    let match = /<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i.exec(
      html,
    );
    if (match) return this.decodeEntities(match[1]!.trim());

    // Alternate attribute order
    match = /<meta\s[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i.exec(
      html,
    );
    if (match) return this.decodeEntities(match[1]!.trim());

    // OG description
    match = /<meta\s[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i.exec(
      html,
    );
    if (match) return this.decodeEntities(match[1]!.trim());

    return "";
  }

  /**
   * Strip HTML tags, decode entities, and collapse whitespace.
   *
   * When a selector is provided this method attempts a heuristic extraction:
   * it looks for content inside elements matching id or class hints.
   *
   * @param html     - Raw HTML string
   * @param selector - Optional CSS-like selector hint (id or class name)
   */
  extractText(html: string, selector?: string): string {
    let source = html;

    if (selector) {
      source = this.extractBySelector(html, selector) || html;
    }

    // Remove <script> and <style> blocks entirely
    source = source
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

    // Replace block-level tags with newlines to preserve sentence boundaries
    source = source.replace(
      /<\/?(p|div|section|article|header|footer|h[1-6]|li|tr|br|hr)[^>]*>/gi,
      "\n",
    );

    // Strip remaining tags
    source = source.replace(/<[^>]+>/g, " ");

    // Decode HTML entities
    source = this.decodeEntities(source);

    // Collapse whitespace
    source = source
      .replace(/\r\n/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return source;
  }

  // -------------------------------------------------------------------------
  // Confidence scoring
  // -------------------------------------------------------------------------

  /**
   * Score a FetchResult from 0 to 1 based on content richness.
   *
   * Breakdown:
   * - Content length (0 – 0.4): proportional up to 5000 chars
   * - Has title (+0.2)
   * - Has description (+0.1)
   * - Word count (0 – 0.3): proportional up to 300 words
   *
   * @param result - The FetchResult to score
   */
  computeConfidence(result: FetchResult): number {
    if (!result.content || result.content.length === 0) return 0;

    let score = 0;

    // Content length contribution (0–0.4)
    const lengthScore = Math.min(result.content.length / 5_000, 1) * 0.4;
    score += lengthScore;

    // Title presence
    if (result.title && result.title.length > 0) score += 0.2;

    // Description presence
    if (result.description && result.description.length > 0) score += 0.1;

    // Word count contribution (0–0.3)
    const wordScore = Math.min(result.wordCount / 300, 1) * 0.3;
    score += wordScore;

    return Math.min(Math.round(score * 100) / 100, 1);
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  /**
   * Truncate content to maxContentLength with a trailing ellipsis.
   *
   * @param content - Raw content string
   */
  truncateContent(content: string): string {
    if (content.length <= this.maxContentLength) return content;
    return content.slice(0, this.maxContentLength) + "…";
  }

  /**
   * Determine whether the content is JSON.
   *
   * Returns true if the Content-Type header is `application/json` or
   * if the content starts with a JSON structure that can be parsed.
   *
   * @param content     - Response body string
   * @param contentType - Content-Type header value
   */
  isJson(content: string, contentType: string): boolean {
    if (contentType.includes("application/json")) return true;
    const trimmed = content.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        JSON.parse(content);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Count words in a string. */
  private countWords(text: string): number {
    if (!text.trim()) return 0;
    return text.trim().split(/\s+/).length;
  }

  /** Decode common HTML entities. */
  private decodeEntities(text: string): string {
    // Named entities
    let result = text.replace(
      /&[a-zA-Z]+;/g,
      (match) => HTML_ENTITY_MAP[match] ?? match,
    );
    // Numeric decimal entities
    result = result.replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    );
    // Numeric hex entities
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    );
    return result;
  }

  /**
   * Attempt to extract a section of HTML matching an id or class selector hint.
   * Returns null if no match is found.
   */
  private extractBySelector(html: string, selector: string): string | null {
    // Strip leading . or # for matching
    const clean = selector.replace(/^[.#]/, "");
    // Try id= match
    const idPattern = new RegExp(
      `<[^>]+id=["']${clean}["'][^>]*>([\\s\\S]*?)<\/[^>]+>`,
      "i",
    );
    const idMatch = idPattern.exec(html);
    if (idMatch) return idMatch[1] ?? null;

    // Try class= match
    const classPattern = new RegExp(
      `<[^>]+class=["'][^"']*${clean}[^"']*["'][^>]*>([\\s\\S]*?)<\/[^>]+>`,
      "i",
    );
    const classMatch = classPattern.exec(html);
    if (classMatch) return classMatch[1] ?? null;

    return null;
  }

  /** Build a graceful error result when a network request fails. */
  private buildErrorResult(
    url: string,
    mode: FetchMode,
    errorMessage: string,
  ): FetchResult {
    return {
      url,
      mode,
      content: `Error fetching URL: ${errorMessage}`,
      statusCode: 0,
      contentType: "",
      wordCount: 0,
      confidence: 0,
      fetchedAt: new Date().toISOString(),
    };
  }
}
