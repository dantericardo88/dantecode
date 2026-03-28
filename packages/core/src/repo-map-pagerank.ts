// ============================================================================
// @dantecode/core - PageRank-Based Repository Map
// Symbol-level PageRank inspired by Aider's repomap.py implementation
// Tracks definitions, references, and computes symbol importance via PageRank
// ============================================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RepoMapTreeSitter } from "./repo-map-tree-sitter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolTag {
  filePath: string;
  symbolName: string;
  kind: "def" | "ref";
  line: number;
  signature?: string;
}

export interface SymbolRank {
  filePath: string;
  symbolName: string;
  rank: number;
  line: number;
  signature: string;
}

export interface PageRankRepoMapOptions {
  /** Files currently in chat/context - get higher personalization */
  chatFiles?: string[];
  /** Mentioned file names to boost */
  mentionedFiles?: string[];
  /** Mentioned identifiers to boost */
  mentionedIdents?: string[];
  /** Max tokens for output */
  maxTokens?: number;
  /** PageRank damping factor (default 0.85) */
  dampingFactor?: number;
  /** PageRank iterations (default 10) */
  iterations?: number;
}

export interface RepoMapContext {
  /** Project root directory */
  projectRoot: string;
  /** All source files to analyze */
  files: string[];
  /** Tree-sitter extractor for symbol extraction */
  treeSitter: RepoMapTreeSitter;
}

// ---------------------------------------------------------------------------
// Tag Extraction (Definitions + References)
// ---------------------------------------------------------------------------

/**
 * Extract both definitions and references from a file.
 * Definitions: function/class/interface/type declarations
 * References: identifiers used in function calls, property access, etc.
 */
export async function extractTags(
  filePath: string,
  projectRoot: string,
  treeSitter: RepoMapTreeSitter,
): Promise<SymbolTag[]> {
  const absPath = join(projectRoot, filePath);
  const content = await readFile(absPath, "utf-8");

  const tags: SymbolTag[] = [];

  // Extract definitions using tree-sitter
  const symbols = treeSitter.extractSymbols(content, filePath);
  for (const sym of symbols) {
    tags.push({
      filePath,
      symbolName: sym.name,
      kind: "def",
      line: sym.line,
      signature: sym.signature,
    });
  }

  // Extract references using regex (fast fallback)
  // Match function calls, property access, and identifiers
  const refPatterns = [
    // Function calls: foo(...) or bar.foo(...)
    /\b([a-zA-Z_]\w*)\s*\(/g,
    // Property access: obj.prop
    /\.([a-zA-Z_]\w*)/g,
    // JSX components: <ComponentName
    /<([A-Z]\w*)/g,
    // Type references in TS: : Type or <Type>
    /:\s*([A-Z]\w*)/g,
    /<([A-Z]\w*)>/g,
  ];

  const refSet = new Set<string>();
  for (const pattern of refPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (name && name.length > 1 && !isKeyword(name)) {
        refSet.add(name);
      }
    }
  }

  // Add references (line number -1 means "no specific line")
  for (const name of refSet) {
    tags.push({
      filePath,
      symbolName: name,
      kind: "ref",
      line: -1,
    });
  }

  return tags;
}

const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "return", "function", "const", "let", "var", "class", "interface", "type",
  "import", "export", "from", "async", "await", "try", "catch", "finally",
  "throw", "new", "this", "super", "extends", "implements", "true", "false",
  "null", "undefined", "typeof", "instanceof",
]);

function isKeyword(ident: string): boolean {
  return KEYWORDS.has(ident.toLowerCase());
}

// ---------------------------------------------------------------------------
// PageRank Computation
// ---------------------------------------------------------------------------

/**
 * Build a directed graph where nodes are files and edges represent
 * "file A references symbol S defined in file B" relationships.
 * Then run PageRank to score each (file, symbol) pair.
 */
export function computeSymbolRanks(
  tags: SymbolTag[],
  options: PageRankRepoMapOptions = {},
): SymbolRank[] {
  const {
    chatFiles = [],
    mentionedFiles = [],
    mentionedIdents = [],
    dampingFactor = 0.85,
    iterations = 10,
  } = options;

  // Build indexes
  const defines = new Map<string, Set<string>>(); // symbolName -> Set<filePath>
  const references = new Map<string, string[]>(); // symbolName -> [filePath, ...]
  const definitions = new Map<string, SymbolTag[]>(); // "file:symbol" -> [tag, ...]

  const allFiles = new Set<string>();

  for (const tag of tags) {
    allFiles.add(tag.filePath);

    if (tag.kind === "def") {
      if (!defines.has(tag.symbolName)) {
        defines.set(tag.symbolName, new Set());
      }
      defines.get(tag.symbolName)!.add(tag.filePath);

      const key = `${tag.filePath}:${tag.symbolName}`;
      if (!definitions.has(key)) {
        definitions.set(key, []);
      }
      definitions.get(key)!.push(tag);
    } else {
      if (!references.has(tag.symbolName)) {
        references.set(tag.symbolName, []);
      }
      references.get(tag.symbolName)!.push(tag.filePath);
    }
  }

  // Track symbols with only self-references (for self-edge logic later)
  const symbolsWithOnlySelfRefs = new Set<string>();

  // If no references found, use defines as references
  // (Some languages only provide def tags)
  if (references.size === 0) {
    for (const [symbol, files] of defines) {
      references.set(symbol, Array.from(files));
      // Mark as self-only since we artificially created these
      symbolsWithOnlySelfRefs.add(symbol);
    }
  }

  // Build graph for PageRank
  const graph = new Map<string, Map<string, GraphEdge>>();
  const fileScores = new Map<string, number>();
  const fileOutDegree = new Map<string, number>();

  // Initialize
  const numFiles = allFiles.size;
  for (const file of allFiles) {
    fileScores.set(file, 1 / numFiles);
    fileOutDegree.set(file, 0);
    graph.set(file, new Map());
  }

  // Personalization: boost chat files and mentioned files
  const personalization = new Map<string, number>();
  const personalizeScore = numFiles > 0 ? 100 / numFiles : 1;

  for (const file of chatFiles) {
    personalization.set(file, personalizeScore);
  }
  for (const file of mentionedFiles) {
    const current = personalization.get(file) ?? 0;
    personalization.set(file, Math.max(current, personalizeScore));
  }

  // Build edges: referencer -> definer for each symbol
  const idents = new Set<string>();
  for (const symbol of defines.keys()) {
    if (references.has(symbol)) {
      idents.add(symbol);
    }
  }

  for (const symbol of idents) {
    const definers = defines.get(symbol);
    const refs = references.get(symbol);
    if (!definers || !refs) continue;

    // Symbol weighting (Aider's heuristics)
    let weight = 1.0;

    // Boost mentioned identifiers
    if (mentionedIdents.includes(symbol)) {
      weight *= 10;
    }

    // Penalize private symbols FIRST (before other boosts)
    if (symbol.startsWith("_")) {
      weight *= 0.1;
    }

    // Boost symbols with conventional naming (exclude private symbols)
    if (!symbol.startsWith("_")) {
      const isSnake = symbol.includes("_") && /[a-zA-Z]/.test(symbol);
      const isKebab = symbol.includes("-") && /[a-zA-Z]/.test(symbol);
      const isCamel = /[A-Z]/.test(symbol) && /[a-z]/.test(symbol);
      if ((isSnake || isKebab || isCamel) && symbol.length >= 8) {
        weight *= 10;
      }
    }

    // Penalize widely-defined symbols (common names)
    if (definers.size > 5) {
      weight *= 0.1;
    }

    // Count references per file
    const refCounts = new Map<string, number>();
    for (const ref of refs) {
      refCounts.set(ref, (refCounts.get(ref) ?? 0) + 1);
    }

    for (const [referencer, count] of refCounts) {
      for (const definer of definers) {
        if (referencer === definer) continue; // Skip self-loops

        let edgeWeight = weight;

        // Boost if referencer is in chat
        if (chatFiles.includes(referencer)) {
          edgeWeight *= 50;
        }

        // Scale down high-frequency refs (sqrt damping)
        const dampedCount = Math.sqrt(count);
        edgeWeight *= dampedCount;

        // Add edge
        const edges = graph.get(referencer)!;
        const key = `${definer}:${symbol}`;
        const existing = edges.get(key);
        if (existing) {
          existing.weight += edgeWeight;
        } else {
          edges.set(key, {
            from: referencer,
            to: definer,
            symbol,
            weight: edgeWeight,
          });
        }

        fileOutDegree.set(referencer, (fileOutDegree.get(referencer) ?? 0) + 1);
      }
    }
  }

  // Add self-edges for definitions with only self-references
  // (symbols marked during the "no references" fallback logic)
  for (const symbol of symbolsWithOnlySelfRefs) {
    for (const definer of defines.get(symbol)!) {
      const edges = graph.get(definer)!;
      const key = `${definer}:${symbol}`;
      // Only add if no edge was created during normal processing
      if (!edges.has(key)) {
        edges.set(key, {
          from: definer,
          to: definer,
          symbol,
          weight: 0.1,
        });
      }
    }
  }

  // Run PageRank iterations
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();

    for (const file of allFiles) {
      let rank = (1 - dampingFactor) / numFiles;

      // Add personalization if available
      if (personalization.has(file)) {
        rank += (1 - dampingFactor) * (personalization.get(file)! / numFiles);
      }

      // Sum contributions from incoming edges
      for (const [_srcFile, edges] of graph) {
        for (const edge of edges.values()) {
          if (edge.to === file) {
            const srcScore = fileScores.get(edge.from) ?? 0;
            const srcOut = fileOutDegree.get(edge.from) ?? 1;
            rank += dampingFactor * (srcScore / srcOut);
          }
        }
      }

      newScores.set(file, rank);
    }

    for (const [file, score] of newScores) {
      fileScores.set(file, score);
    }
  }

  // Distribute file ranks to symbol definitions
  const symbolRanks = new Map<string, number>();

  for (const [file, edges] of graph) {
    const fileRank = fileScores.get(file) ?? 0;
    const totalWeight = Array.from(edges.values()).reduce((sum, e) => sum + e.weight, 0);

    if (totalWeight === 0) continue;

    for (const edge of edges.values()) {
      const symbolRank = fileRank * (edge.weight / totalWeight);
      const key = `${edge.to}:${edge.symbol}`;
      symbolRanks.set(key, (symbolRanks.get(key) ?? 0) + symbolRank);
    }
  }

  // Convert to sorted list
  const ranked: SymbolRank[] = [];
  for (const [key, rank] of symbolRanks) {
    const parts = key.split(":");
    const filePath = parts[0];
    const symbolName = parts[1];

    if (!filePath || !symbolName) continue;

    const defTags = definitions.get(key) ?? [];
    const firstDef = defTags[0];

    if (firstDef) {
      ranked.push({
        filePath,
        symbolName,
        rank,
        line: firstDef.line,
        signature: firstDef.signature ?? symbolName,
      });
    }
  }

  ranked.sort((a, b) => b.rank - a.rank);

  return ranked;
}

interface GraphEdge {
  from: string;
  to: string;
  symbol: string;
  weight: number;
}

// ---------------------------------------------------------------------------
// Context Formatting
// ---------------------------------------------------------------------------

/**
 * Format ranked symbols as a compact context string for LLM injection.
 * Uses binary search to fit within token budget.
 */
export function formatRepoMapContext(
  rankedSymbols: SymbolRank[],
  chatFiles: string[],
  maxTokens = 2000,
): string {
  const chatSet = new Set(chatFiles);

  // Group by file
  const fileGroups = new Map<string, SymbolRank[]>();
  for (const sym of rankedSymbols) {
    if (chatSet.has(sym.filePath)) continue; // Skip chat files

    if (!fileGroups.has(sym.filePath)) {
      fileGroups.set(sym.filePath, []);
    }
    fileGroups.get(sym.filePath)!.push(sym);
  }

  // Binary search to fit budget
  let lower = 0;
  let upper = rankedSymbols.length;
  let bestOutput = "";
  let bestTokens = 0;

  const targetSymbols = Math.min(Math.floor(maxTokens / 25), rankedSymbols.length);
  let middle = targetSymbols;

  while (lower <= upper) {
    const candidate = buildTreeOutput(rankedSymbols.slice(0, middle), chatSet);
    const tokens = estimateTokens(candidate);

    const error = Math.abs(tokens - maxTokens) / maxTokens;

    if ((tokens <= maxTokens && tokens > bestTokens) || error < 0.15) {
      bestOutput = candidate;
      bestTokens = tokens;

      if (error < 0.15) break;
    }

    if (tokens < maxTokens) {
      lower = middle + 1;
    } else {
      upper = middle - 1;
    }

    middle = Math.floor((lower + upper) / 2);

    if (middle === 0) break;
  }

  return bestOutput;
}

function buildTreeOutput(symbols: SymbolRank[], chatFiles: Set<string>): string {
  const lines: string[] = ["# Repository Map (symbols ranked by importance)", ""];

  const fileGroups = new Map<string, SymbolRank[]>();
  for (const sym of symbols) {
    if (chatFiles.has(sym.filePath)) continue;

    if (!fileGroups.has(sym.filePath)) {
      fileGroups.set(sym.filePath, []);
    }
    fileGroups.get(sym.filePath)!.push(sym);
  }

  for (const [file, syms] of fileGroups) {
    lines.push(`## ${file}`);
    for (const sym of syms) {
      const lineNum = sym.line > 0 ? `:${sym.line}` : "";
      lines.push(`  ${sym.signature}${lineNum}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function estimateTokens(text: string): number {
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// High-Level API
// ---------------------------------------------------------------------------

/**
 * Build a PageRank-based repository map for a set of files.
 * This is the main entry point for generating context-aware repo maps.
 */
export async function buildPageRankRepoMap(
  context: RepoMapContext,
  options: PageRankRepoMapOptions = {},
): Promise<string> {
  const { projectRoot, files, treeSitter } = context;
  const { maxTokens = 2000, chatFiles = [] } = options;

  // Extract tags from all files
  const allTags: SymbolTag[] = [];
  for (const file of files) {
    try {
      const tags = await extractTags(file, projectRoot, treeSitter);
      allTags.push(...tags);
    } catch {
      // Skip files that can't be read
    }
  }

  // Compute symbol ranks
  const ranked = computeSymbolRanks(allTags, options);

  // Format for LLM context
  const formatted = formatRepoMapContext(ranked, chatFiles, maxTokens);

  return formatted;
}

/**
 * Get relevant context for a specific query.
 * Treats query terms as mentioned identifiers for personalization.
 */
export async function getRelevantContext(
  context: RepoMapContext,
  query: string,
  options: Omit<PageRankRepoMapOptions, "mentionedIdents"> = {},
): Promise<string> {
  // Extract identifiers from query
  const idents = query
    .split(/\W+/)
    .filter((t) => t.length > 2 && /[a-zA-Z]/.test(t));

  return buildPageRankRepoMap(context, {
    ...options,
    mentionedIdents: idents,
  });
}
