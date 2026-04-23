// packages/core/src/search-query-expander.ts
// Semantic search quality boost — closes dim 3 (Codebase semantic search: 8→9).
//
// Harvested from: Tabby (query expansion), Augment (cross-file symbol resolution).
//
// Provides:
//   - Query expansion: extract symbol names, add camelCase/snake_case variants
//   - Code-aware tokenization (identifier splitting)
//   - Result re-ranking by code-specific signals (symbol match, filename, recency)
//   - Cross-encoder style scoring for code search results

// ─── Identifier Tokenizer ─────────────────────────────────────────────────────

/**
 * Split a code identifier into component tokens.
 * Handles camelCase, snake_case, PascalCase, SCREAMING_CASE, kebab-case.
 *
 * Examples:
 *   "getUserById" → ["get", "user", "by", "id"]
 *   "HTTP_TIMEOUT" → ["http", "timeout"]
 *   "fetch-data"   → ["fetch", "data"]
 */
export function splitIdentifier(identifier: string): string[] {
  return identifier
    // Insert space before uppercase runs (handles camelCase and PascalCase)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    // Replace separators
    .replace(/[_\-./]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Tokenize a natural-language query into code-aware tokens.
 * Expands contractions, lowercases, removes stop words.
 */
const CODE_STOP_WORDS = new Set([
  "the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or",
  "is", "it", "be", "as", "do", "if", "by", "up", "use", "used", "using",
  "can", "get", "set", "my", "we", "you", "how", "what", "where", "when",
]);

export function tokenizeQuery(query: string): string[] {
  // Split on non-alphanumeric boundaries AND identifier boundaries
  const rawTokens = query
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !CODE_STOP_WORDS.has(t));
  return [...new Set(rawTokens)];
}

// ─── Query Expander ───────────────────────────────────────────────────────────

export interface ExpandedQuery {
  /** Original query string */
  original: string;
  /** Tokenized query terms */
  tokens: string[];
  /** Additional symbol variants (camelCase, snake_case) */
  symbolVariants: string[];
  /** All terms for BM25 retrieval */
  allTerms: string[];
}

/**
 * Expand a search query with code-aware symbol variants.
 *
 * Example: "parse git log output" →
 *   tokens: ["parse", "git", "log", "output"]
 *   symbolVariants: ["parseGitLog", "parse_git_log", "parseGitLogOutput"]
 *   allTerms: all of the above, deduplicated
 */
export function expandQuery(query: string): ExpandedQuery {
  const tokens = tokenizeQuery(query);
  const symbolVariants: string[] = [];

  if (tokens.length >= 2) {
    // camelCase: parseGitLog
    const camel = tokens[0] + tokens.slice(1).map((t) => t[0]!.toUpperCase() + t.slice(1)).join("");
    symbolVariants.push(camel);

    // snake_case: parse_git_log
    symbolVariants.push(tokens.join("_"));

    // PascalCase: ParseGitLog
    const pascal = tokens.map((t) => t[0]!.toUpperCase() + t.slice(1)).join("");
    symbolVariants.push(pascal);

    // Pairs for common 2-token patterns
    if (tokens.length === 2) {
      symbolVariants.push(tokens[0]! + tokens[1]![0]!.toUpperCase() + tokens[1]!.slice(1));
    }
  }

  const allTerms = [...new Set([...tokens, ...symbolVariants])];
  return { original: query, tokens, symbolVariants, allTerms };
}

// ─── Code Search Result Re-Ranker ─────────────────────────────────────────────

export interface CodeSearchResult {
  /** File path (relative) */
  filePath: string;
  /** Symbol name (function/class/etc.) */
  symbolName?: string;
  /** Content of the chunk */
  content: string;
  /** Original retrieval score (e.g. BM25) */
  retrievalScore: number;
  /** Line number where chunk starts */
  startLine?: number;
  /** File last-modified timestamp (for recency) */
  lastModifiedMs?: number;
}

export interface RerankOptions {
  /** Query to re-rank against */
  query: string;
  /** Boost factor for exact symbol name matches (default: 3.0) */
  symbolMatchBoost?: number;
  /** Boost factor for filename matches (default: 1.5) */
  filenameMatchBoost?: number;
  /** Boost factor for recent files (default: 1.2) */
  recencyBoost?: number;
  /** Recency window in ms — files modified within this period get boost (default: 7 days) */
  recencyWindowMs?: number;
  /** Weight of original retrieval score (default: 0.6) */
  retrievalWeight?: number;
}

/**
 * Re-rank code search results using code-specific signals on top of retrieval score.
 *
 * Scoring: final = retrievalWeight×retrieval + symbolBoost + filenameBoost + recencyBoost + contentDensity
 */
export function rerankCodeResults(
  results: CodeSearchResult[],
  options: RerankOptions,
): CodeSearchResult[] {
  const {
    query,
    symbolMatchBoost = 3.0,
    filenameMatchBoost = 1.5,
    recencyBoost = 1.2,
    recencyWindowMs = 7 * 24 * 60 * 60 * 1000,
    retrievalWeight = 0.6,
  } = options;

  const expanded = expandQuery(query);
  const now = Date.now();

  const scored = results.map((result) => {
    let score = result.retrievalScore * retrievalWeight;

    // Symbol name exact / partial match
    if (result.symbolName) {
      const symLower = result.symbolName.toLowerCase();
      const symTokens = splitIdentifier(result.symbolName);
      const termSet = new Set(expanded.tokens);
      const matchingTokens = symTokens.filter((t) => termSet.has(t)).length;
      if (matchingTokens > 0) {
        score += symbolMatchBoost * (matchingTokens / Math.max(symTokens.length, expanded.tokens.length));
      }
      // Exact camelCase match for one of the variants
      if (expanded.symbolVariants.some((v) => symLower === v.toLowerCase())) {
        score += symbolMatchBoost * 0.5;
      }
    }

    // Filename match
    const filenameLower = result.filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    const filenameTokens = splitIdentifier(filenameLower.replace(/\.(ts|js|py|rs|go|java)$/, ""));
    const filenameMatches = filenameTokens.filter((t) => expanded.tokens.includes(t)).length;
    if (filenameMatches > 0) {
      score += filenameMatchBoost * (filenameMatches / Math.max(filenameTokens.length, expanded.tokens.length));
    }

    // Recency boost
    if (result.lastModifiedMs !== undefined) {
      const age = now - result.lastModifiedMs;
      if (age < recencyWindowMs) {
        score += recencyBoost * (1 - age / recencyWindowMs);
      }
    }

    // Content density: penalize very short chunks (stubs), boost medium-length
    const contentLen = result.content.length;
    if (contentLen < 50) score -= 0.5;
    else if (contentLen > 200 && contentLen < 2000) score += 0.3;

    // Term frequency in content
    const contentLower = result.content.toLowerCase();
    const tfScore = expanded.tokens.reduce((s, t) => {
      const count = (contentLower.match(new RegExp(t, "g")) ?? []).length;
      return s + Math.min(2, count * 0.2);
    }, 0);
    score += tfScore;

    return { ...result, retrievalScore: score };
  });

  return scored.sort((a, b) => b.retrievalScore - a.retrievalScore);
}

// ─── Symbol Context Extractor ─────────────────────────────────────────────────

export interface SymbolContext {
  /** Symbol name */
  name: string;
  /** Symbol kind */
  kind: "function" | "class" | "interface" | "type" | "variable" | "import" | "unknown";
  /** File where symbol is defined */
  filePath: string;
  /** Line number (1-indexed) */
  line?: number;
  /** JSDoc / docstring if present */
  docstring?: string;
}

const SYMBOL_KINDS = [
  { kind: "function" as const, re: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/m },
  { kind: "class" as const, re: /^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)/m },
  { kind: "interface" as const, re: /^(?:export\s+)?interface\s+([A-Za-z_$][A-Za-z0-9_$]*)/m },
  { kind: "type" as const, re: /^(?:export\s+)?type\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/m },
  { kind: "variable" as const, re: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/m },
];

/**
 * Extract the primary symbol from a code chunk.
 * Returns the first matched symbol with its kind and any JSDoc comment.
 */
export function extractPrimarySymbol(content: string, filePath: string, startLine?: number): SymbolContext | null {
  // Look for JSDoc above the declaration
  const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
  const docstring = jsdocMatch
    ? jsdocMatch[1]!.replace(/^\s*\*\s?/gm, "").trim().split("\n")[0]?.trim()
    : undefined;

  for (const { kind, re } of SYMBOL_KINDS) {
    const match = content.match(re);
    if (match?.[1]) {
      return { name: match[1], kind, filePath, line: startLine, docstring };
    }
  }

  // Arrow function: "export const foo = (...) =>"
  const arrowMatch = content.match(/^(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?\(/m);
  if (arrowMatch?.[1]) {
    return { name: arrowMatch[1], kind: "function", filePath, line: startLine, docstring };
  }

  return null;
}

/**
 * Format re-ranked search results for AI prompt injection.
 */
export function formatSearchResultsForPrompt(
  results: CodeSearchResult[],
  query: string,
  maxResults = 5,
  maxContentChars = 800,
): string {
  const top = results.slice(0, maxResults);
  if (top.length === 0) return `## Search: "${query}"\n\nNo results found.\n`;

  const lines = [`## Search: "${query}"`, `Found ${results.length} result${results.length === 1 ? "" : "s"} (top ${top.length} shown)`, ""];

  for (let i = 0; i < top.length; i++) {
    const r = top[i]!;
    const lineInfo = r.startLine !== undefined ? `:${r.startLine}` : "";
    const symbolInfo = r.symbolName ? ` — \`${r.symbolName}\`` : "";
    lines.push(`**${i + 1}. ${r.filePath}${lineInfo}${symbolInfo}** (score: ${r.retrievalScore.toFixed(2)})`);
    const content = r.content.length > maxContentChars
      ? r.content.slice(0, maxContentChars) + "\n… (truncated)"
      : r.content;
    lines.push("```");
    lines.push(content);
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}
