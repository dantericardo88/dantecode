// ============================================================================
// @dantecode/core — Semantic Index
// Background semantic index with readiness gauge, keyword + semantic search,
// and JSONL storage at .dantecode/index/<sessionId>.index
// Pattern source: KiloCode codebase indexing with background workers
// ============================================================================

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join as pathJoin, extname, relative } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SemanticIndex {
  start(): Promise<void>;
  stop(): Promise<void>;
  search(query: string, limit?: number): Promise<IndexEntry[]>;
  getReadiness(): IndexReadiness;
  /** Wait for indexing to complete. Returns immediately if already complete or stopped. */
  wait(): Promise<void>;
}

export interface IndexReadiness {
  status: "indexing" | "ready" | "error";
  progress: number; // 0-100
  filesIndexed: number;
  totalFiles: number;
  error?: string;
}

export interface IndexEntry {
  path: string;
  symbols: string[];
  imports: string[];
  keywords: string[];
  /** Relevance score (0-1) computed during search. */
  score?: number;
}

export interface BackgroundSemanticIndexOptions {
  projectRoot: string;
  sessionId: string;
  /** Optional custom index directory. Defaults to .dantecode/index */
  indexDir?: string;
  /** File patterns to include. Defaults to common code files. */
  includePatterns?: string[];
  /** File patterns to exclude. Defaults to node_modules, dist, .git, etc. */
  excludePatterns?: string[];
  /** Max files to index. Defaults to 10000. */
  maxFiles?: number;
}

// ---------------------------------------------------------------------------
// BackgroundSemanticIndex
// ---------------------------------------------------------------------------

export class BackgroundSemanticIndex implements SemanticIndex {
  private readonly projectRoot: string;
  private readonly sessionId: string;
  private readonly indexDir: string;
  private readonly includePatterns: string[];
  private readonly excludePatterns: string[];
  private readonly maxFiles: number;

  private readiness: IndexReadiness = {
    status: "indexing",
    progress: 0,
    filesIndexed: 0,
    totalFiles: 0,
  };

  private indexEntries: IndexEntry[] = [];
  private indexingPromise: Promise<void> | null = null;
  private stopped = false;

  constructor(options: BackgroundSemanticIndexOptions) {
    this.projectRoot = options.projectRoot;
    this.sessionId = options.sessionId;
    this.indexDir = options.indexDir ?? pathJoin(options.projectRoot, ".dantecode", "index");
    this.includePatterns = options.includePatterns ?? [
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
      "**/*.py",
      "**/*.go",
      "**/*.rs",
      "**/*.java",
      "**/*.c",
      "**/*.cpp",
      "**/*.h",
      "**/*.hpp",
      "**/*.md",
      "**/*.json",
      "**/*.yaml",
      "**/*.yml",
    ];
    this.excludePatterns = options.excludePatterns ?? [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.git/**",
      "**/.next/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/*.bundle.js",
    ];
    this.maxFiles = options.maxFiles ?? 10000;
  }

  async start(): Promise<void> {
    if (this.indexingPromise) {
      return; // Already started
    }

    this.indexingPromise = this.buildIndex();
    // Non-blocking: caller can await or not
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.indexingPromise) {
      await this.indexingPromise;
    }
  }

  async wait(): Promise<void> {
    if (this.indexingPromise) {
      await this.indexingPromise;
    }
  }

  getReadiness(): IndexReadiness {
    return { ...this.readiness };
  }

  async search(query: string, limit = 10): Promise<IndexEntry[]> {
    const lowerQuery = query.toLowerCase();
    const queryTokens = tokenize(lowerQuery);

    // Keyword search: works even with partial index
    const results: IndexEntry[] = [];

    for (const entry of this.indexEntries) {
      let score = 0;

      // Exact path match
      if (entry.path.toLowerCase().includes(lowerQuery)) {
        score += 10;
      }

      // Symbol match
      for (const symbol of entry.symbols) {
        if (symbol.toLowerCase().includes(lowerQuery)) {
          score += 5;
        }
      }

      // Import match
      for (const imp of entry.imports) {
        if (imp.toLowerCase().includes(lowerQuery)) {
          score += 3;
        }
      }

      // Keyword match with TF-IDF-like weighting
      for (const kw of entry.keywords) {
        if (queryTokens.includes(kw.toLowerCase())) {
          score += 1;
        }
      }

      if (score > 0) {
        results.push({ ...entry, score });
      }
    }

    // Sort by score descending
    results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return results.slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Private: Index Building
  // -------------------------------------------------------------------------

  private async buildIndex(): Promise<void> {
    try {
      // Ensure index directory exists
      if (!existsSync(this.indexDir)) {
        await mkdir(this.indexDir, { recursive: true });
      }

      // Discover files
      const files = await this.discoverFiles();
      if (files.length === 0) {
        this.readiness = {
          status: "ready",
          progress: 100,
          filesIndexed: 0,
          totalFiles: 0,
          error: "No files discovered",
        };
        return;
      }

      this.readiness.totalFiles = files.length;
      this.readiness.filesIndexed = 0;

      // Index files incrementally
      const entries: IndexEntry[] = [];
      const errors: Array<{ file: string; error: string }> = [];
      for (const file of files) {
        if (this.stopped) break;

        try {
          const entry = await this.indexFile(file);
          if (entry) {
            entries.push(entry);
            this.readiness.filesIndexed++;
          }
          // If entry is null, just skip it (e.g., empty file)
        } catch (err) {
          // Log error for debugging
          errors.push({ file, error: err instanceof Error ? err.message : String(err) });
          // Skip files that can't be read/parsed
          // Don't increment filesIndexed for failed files
        }

        this.readiness.progress = Math.round((entries.length / this.readiness.totalFiles) * 100);
      }

      // Store first error for debugging
      if (errors.length > 0 && entries.length === 0) {
        this.readiness.status = "error";
        this.readiness.error = `Failed to index ${errors.length} files. First error: ${errors[0]?.file} - ${errors[0]?.error}`;
        return;
      }

      this.indexEntries = entries;

      // Write to JSONL
      await this.writeIndexToFile(entries);

      this.readiness.status = "ready";
      this.readiness.progress = 100;
    } catch (err) {
      this.readiness.status = "error";
      this.readiness.error = err instanceof Error ? err.message : String(err);
    }
  }

  private async discoverFiles(): Promise<string[]> {
    const allFiles: string[] = [];
    const seen = new Set<string>();

    // Recursive directory walk
    const walk = async (dir: string): Promise<void> => {
      if (allFiles.length >= this.maxFiles) return;

      try {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (allFiles.length >= this.maxFiles) break;

          const fullPath = pathJoin(dir, entry.name);
          const relPath = relative(this.projectRoot, fullPath);

          // Check exclude patterns
          if (this.shouldExclude(relPath)) {
            continue;
          }

          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            // Check if file matches include patterns
            if (this.shouldInclude(relPath) && !seen.has(relPath)) {
              allFiles.push(relPath);
              seen.add(relPath);
            }
          }
        }
      } catch (_err) {
        // Skip directories that can't be read
      }
    };

    await walk(this.projectRoot);
    return allFiles;
  }

  private shouldExclude(relPath: string): boolean {
    // Normalize to forward slashes for consistent matching
    const normalized = relPath.replace(/\\/g, "/");

    for (const pattern of this.excludePatterns) {
      // Simple glob matching
      // For patterns like **/foo/**, check if path contains /foo/ or starts with foo/
      // Extract the middle part (between **)
      const middleMatch = pattern.match(/^\*\*\/(.+?)\/\*\*$/);
      if (middleMatch) {
        const segment = middleMatch[1];
        if (normalized.includes(`/${segment}/`) || normalized.startsWith(`${segment}/`)) {
          return true;
        }
        continue;
      }

      // Otherwise convert glob to regex
      const regexPattern = pattern
        .replace(/\*\*/g, "__DOUBLESTAR__")
        .replace(/\*/g, "[^/]*")
        .replace(/__DOUBLESTAR__/g, ".*")
        .replace(/\?/g, ".");
      const regex = new RegExp(regexPattern);
      if (regex.test(normalized)) {
        return true;
      }
    }
    return false;
  }

  private shouldInclude(relPath: string): boolean {
    const ext = extname(relPath);
    // Check if extension matches any include pattern
    // Patterns like "**/*.ts" should match any .ts file
    for (const pattern of this.includePatterns) {
      // Extract extension from pattern (e.g., "**/*.ts" → ".ts")
      const patternExt = extname(pattern.replace(/\*\*/g, ""));
      if (patternExt && ext === patternExt) {
        return true;
      }
    }
    return false;
  }

  private async indexFile(relPath: string): Promise<IndexEntry | null> {
    const absPath = pathJoin(this.projectRoot, relPath);

    // Read file content
    let content: string;
    try {
      content = await readFile(absPath, "utf-8");
    } catch (readErr) {
      throw new Error(
        `Failed to read ${relPath}: ${readErr instanceof Error ? readErr.message : String(readErr)}`,
      );
    }

    if (content.length === 0) {
      return null; // Skip empty files
    }

    const ext = extname(relPath);
    const symbols = extractSymbols(content, ext);
    const imports = extractImports(content, ext);
    const keywords = extractKeywords(content);

    // Always return an entry even if arrays are empty
    return {
      path: relPath,
      symbols,
      imports,
      keywords,
    };
  }

  private async writeIndexToFile(entries: IndexEntry[]): Promise<void> {
    const indexPath = pathJoin(this.indexDir, `${this.sessionId}.index`);

    // Write JSONL format
    const lines = entries.map((e) => JSON.stringify(e)).join("\n");
    await writeFile(indexPath, lines, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Extraction Helpers
// ---------------------------------------------------------------------------

const SYMBOL_REGEXES: Record<string, RegExp[]> = {
  ".ts": [
    /(?:export\s+)?(?:class|interface|type|enum)\s+(\w+)/g,
    /(?:export\s+)?(?:const|let|var|function)\s+(\w+)/g,
  ],
  ".tsx": [
    /(?:export\s+)?(?:class|interface|type|enum)\s+(\w+)/g,
    /(?:export\s+)?(?:const|let|var|function)\s+(\w+)/g,
    /(?:export\s+)?(?:function|const)\s+([A-Z]\w*)\s*(?:=|\()/g, // React components
  ],
  ".js": [/(?:export\s+)?(?:class|function|const|let|var)\s+(\w+)/g],
  ".jsx": [
    /(?:export\s+)?(?:class|function|const|let|var)\s+(\w+)/g,
    /(?:export\s+)?(?:function|const)\s+([A-Z]\w*)\s*(?:=|\()/g,
  ],
  ".py": [/(?:class|def)\s+(\w+)/g],
  ".go": [/(?:func|type|const|var)\s+(\w+)/g],
  ".rs": [/(?:fn|struct|enum|trait|impl)\s+(\w+)/g],
  ".java": [
    /(?:class|interface|enum)\s+(\w+)/g,
    /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\(/g,
  ],
};

const IMPORT_REGEXES: Record<string, RegExp[]> = {
  ".ts": [/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g, /import\s+['"]([^'"]+)['"]/g],
  ".tsx": [/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g, /import\s+['"]([^'"]+)['"]/g],
  ".js": [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
  ],
  ".jsx": [
    /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\(['"]([^'"]+)['"]\)/g,
  ],
  ".py": [/^import\s+([\w.]+)/gm, /^from\s+([\w.]+)\s+import/gm],
  ".go": [/import\s+(?:\([\s\S]*?\)|"([^"]+)")/g],
  ".rs": [/use\s+([\w:]+)/g],
  ".java": [/import\s+([\w.]+);/g],
};

function extractSymbols(content: string, ext: string): string[] {
  const regexes = SYMBOL_REGEXES[ext] ?? SYMBOL_REGEXES[".ts"] ?? [];
  const symbols = new Set<string>();

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && match[1].length > 0) {
        symbols.add(match[1]);
      }
    }
  }

  return Array.from(symbols);
}

function extractImports(content: string, ext: string): string[] {
  const regexes = IMPORT_REGEXES[ext] ?? IMPORT_REGEXES[".ts"] ?? [];
  const imports = new Set<string>();

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (match[1] && match[1].length > 0) {
        imports.add(match[1]);
      }
    }
  }

  return Array.from(imports);
}

function extractKeywords(content: string): string[] {
  const tokens = tokenize(content);
  // Filter out very common words and keep meaningful tokens
  const filtered = tokens.filter((t) => t.length > 3 && !STOP_WORDS.has(t));
  // Deduplicate and limit to top 100
  return Array.from(new Set(filtered)).slice(0, 100);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 0);
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "not",
  "but",
  "was",
  "has",
  "have",
  "been",
  "will",
  "can",
  "could",
  "would",
  "should",
  "may",
  "might",
  "must",
]);
