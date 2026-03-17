// ============================================================================
// @dantecode/core — Semantic Code Index
// TF-IDF-based code indexing with chunking at function/class boundaries.
// Provides @codebase-style semantic search with zero external dependencies.
// ============================================================================

import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import type { CodeChunk, CodeIndexConfig } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Chunking
// ----------------------------------------------------------------------------

/** Regex patterns that mark chunk boundaries in source code. */
const CHUNK_BOUNDARY_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+\w+/,
  /^(?:export\s+)?class\s+\w+/,
  /^(?:export\s+)?interface\s+\w+/,
  /^(?:export\s+)?type\s+\w+\s*=/,
  /^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+/,
  /^describe\s*\(/,
  /^it\s*\(/,
  /^test\s*\(/,
];

/** Extract symbol names from a code chunk. */
function extractSymbols(code: string): string[] {
  const symbols: string[] = [];
  const patterns = [
    /(?:function|class|interface|type|const|let|var|enum)\s+(\w+)/g,
    /(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let))\s+(\w+)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      if (match[1] && !symbols.includes(match[1])) {
        symbols.push(match[1]);
      }
    }
  }
  return symbols;
}

/**
 * Split a file into chunks at function/class/interface boundaries.
 * Each chunk is 10-maxChunkLines lines.
 */
export function chunkFile(content: string, filePath: string, maxChunkLines: number): CodeChunk[] {
  if (content.trim().length === 0) return [];
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  // For very small files, return a single chunk
  if (lines.length <= maxChunkLines) {
    return [
      {
        filePath,
        startLine: 1,
        endLine: lines.length,
        content,
        symbols: extractSymbols(content),
      },
    ];
  }

  const chunks: CodeChunk[] = [];
  let chunkStart = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const isChunkBoundary = CHUNK_BOUNDARY_PATTERNS.some((p) => p.test(line.trim()));
    const chunkLen = i - chunkStart;

    if (isChunkBoundary && chunkLen >= 10) {
      const chunkContent = lines.slice(chunkStart, i).join("\n");
      chunks.push({
        filePath,
        startLine: chunkStart + 1,
        endLine: i,
        content: chunkContent,
        symbols: extractSymbols(chunkContent),
      });
      chunkStart = i;
    }

    // Force split at max chunk size
    if (chunkLen >= maxChunkLines) {
      const chunkContent = lines.slice(chunkStart, i).join("\n");
      chunks.push({
        filePath,
        startLine: chunkStart + 1,
        endLine: i,
        content: chunkContent,
        symbols: extractSymbols(chunkContent),
      });
      chunkStart = i;
    }
  }

  // Remaining lines
  if (chunkStart < lines.length) {
    const chunkContent = lines.slice(chunkStart).join("\n");
    if (chunkContent.trim().length > 0) {
      chunks.push({
        filePath,
        startLine: chunkStart + 1,
        endLine: lines.length,
        content: chunkContent,
        symbols: extractSymbols(chunkContent),
      });
    }
  }

  return chunks;
}

// ----------------------------------------------------------------------------
// TF-IDF Engine
// ----------------------------------------------------------------------------

/** Tokenize text into lowercase words, stripping punctuation. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Compute term frequency for a list of tokens. */
function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  // Normalize by document length
  const len = tokens.length || 1;
  for (const [term, count] of tf) {
    tf.set(term, count / len);
  }
  return tf;
}

/** Compute cosine similarity between two TF-IDF vectors. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, scoreA] of a) {
    dotProduct += scoreA * (b.get(term) ?? 0);
    normA += scoreA * scoreA;
  }
  for (const scoreB of b.values()) {
    normB += scoreB * scoreB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

// ----------------------------------------------------------------------------
// Index Entry
// ----------------------------------------------------------------------------

interface IndexEntry {
  chunk: CodeChunk;
  tfidf: Map<string, number>;
}

/** Serializable format for persistence. */
interface SerializedIndex {
  version: 1;
  builtAt: string;
  entries: Array<{
    chunk: CodeChunk;
    tfidf: Record<string, number>;
  }>;
  idf: Record<string, number>;
}

// ----------------------------------------------------------------------------
// Code Index
// ----------------------------------------------------------------------------

/** File extensions to index. */
const INDEXABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".kt",
  ".vue",
  ".svelte",
  ".astro",
  ".md",
]);

/** Default patterns to exclude from indexing. */
const DEFAULT_EXCLUDE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  ".turbo",
  ".next",
  ".nuxt",
  "__pycache__",
  "target",
  "vendor",
];

/**
 * TF-IDF-based code index for semantic search.
 * Zero external dependencies — works with any provider.
 */
export class CodeIndex {
  private entries: IndexEntry[] = [];
  private idf: Map<string, number> = new Map();

  /** Number of indexed chunks. */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Build the index from a project directory.
   * Chunks files at function/class boundaries and computes TF-IDF vectors.
   */
  async buildIndex(projectRoot: string, config?: Partial<CodeIndexConfig>): Promise<number> {
    const maxChunkLines = config?.maxChunkLines ?? 200;
    const excludePatterns = [...DEFAULT_EXCLUDE, ...(config?.excludePatterns ?? [])];

    this.entries = [];
    const allChunks: CodeChunk[] = [];

    // Recursively collect source files
    const files = await this.collectFiles(projectRoot, projectRoot, excludePatterns);

    // Chunk each file
    for (const filePath of files) {
      try {
        const content = await readFile(filePath, "utf-8");
        const relPath = relative(projectRoot, filePath);
        const chunks = chunkFile(content, relPath, maxChunkLines);
        allChunks.push(...chunks);
      } catch {
        // Skip unreadable files
      }
    }

    // Compute IDF across all chunks
    const docCount = allChunks.length || 1;
    const docFreq = new Map<string, number>();

    for (const chunk of allChunks) {
      const tokens = new Set(tokenize(chunk.content + " " + chunk.symbols.join(" ")));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    this.idf = new Map<string, number>();
    for (const [term, freq] of docFreq) {
      this.idf.set(term, Math.log(docCount / freq));
    }

    // Compute TF-IDF for each chunk
    for (const chunk of allChunks) {
      const tokens = tokenize(chunk.content + " " + chunk.symbols.join(" "));
      const tf = computeTF(tokens);
      const tfidf = new Map<string, number>();

      for (const [term, tfScore] of tf) {
        const idfScore = this.idf.get(term) ?? 0;
        tfidf.set(term, tfScore * idfScore);
      }

      this.entries.push({ chunk, tfidf });
    }

    return this.entries.length;
  }

  /**
   * Search the index for chunks most relevant to a query.
   * Returns top-k results sorted by TF-IDF cosine similarity.
   */
  search(query: string, limit = 10): CodeChunk[] {
    if (this.entries.length === 0) return [];

    const queryTokens = tokenize(query);
    const queryTF = computeTF(queryTokens);
    const queryTFIDF = new Map<string, number>();

    for (const [term, tfScore] of queryTF) {
      const idfScore = this.idf.get(term) ?? 0;
      queryTFIDF.set(term, tfScore * idfScore);
    }

    const scored = this.entries.map((entry) => ({
      chunk: entry.chunk,
      score: cosineSimilarity(queryTFIDF, entry.tfidf),
    }));

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.chunk);
  }

  /** Save the index to .dantecode/index.json. */
  async save(projectRoot: string): Promise<void> {
    const dir = join(projectRoot, ".dantecode");
    await mkdir(dir, { recursive: true });

    const serialized: SerializedIndex = {
      version: 1,
      builtAt: new Date().toISOString(),
      entries: this.entries.map((e) => ({
        chunk: e.chunk,
        tfidf: Object.fromEntries(e.tfidf),
      })),
      idf: Object.fromEntries(this.idf),
    };

    await writeFile(join(dir, "index.json"), JSON.stringify(serialized), "utf-8");
  }

  /** Load a previously saved index. Returns true if loaded successfully. */
  async load(projectRoot: string): Promise<boolean> {
    try {
      const raw = await readFile(join(projectRoot, ".dantecode", "index.json"), "utf-8");
      const data = JSON.parse(raw) as SerializedIndex;
      if (data.version !== 1) return false;

      this.idf = new Map(Object.entries(data.idf));
      this.entries = data.entries.map((e) => ({
        chunk: e.chunk,
        tfidf: new Map(Object.entries(e.tfidf)),
      }));
      return true;
    } catch {
      return false;
    }
  }

  /** Recursively collect indexable source files. */
  private async collectFiles(
    dir: string,
    projectRoot: string,
    excludePatterns: string[],
  ): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (excludePatterns.some((p) => entry === p || entry.startsWith(p + "/"))) {
          continue;
        }

        const fullPath = join(dir, entry);
        try {
          const s = await stat(fullPath);
          if (s.isDirectory()) {
            const subFiles = await this.collectFiles(fullPath, projectRoot, excludePatterns);
            files.push(...subFiles);
          } else if (s.isFile() && INDEXABLE_EXTENSIONS.has(extname(entry))) {
            files.push(fullPath);
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    } catch {
      // Skip inaccessible directories
    }

    return files;
  }
}
