// ============================================================================
// @dantecode/core - AST Repo Map (Regex-Based Symbol Extraction + PageRank)
// Builds a compact ranked file map for LLM context injection.
// ============================================================================

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { RepoMapTreeSitter } from "./repo-map-tree-sitter.js";

export interface SymbolDefinition {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "enum";
  signature: string;
  filePath: string;
  line: number;
}

export interface ImportEdge {
  from: string;
  to: string;
}

export interface RankedFile {
  filePath: string;
  score: number;
  symbols: SymbolDefinition[];
}

export interface RepoMapOptions {
  maxTokenBudget?: number;
  excludePatterns?: string[];
  useTreeSitter?: boolean;
}

const SYMBOL_PATTERNS: Array<{
  kind: SymbolDefinition["kind"];
  pattern: RegExp;
}> = [
  { kind: "function", pattern: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)[^{]*/gm },
  { kind: "class", pattern: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)[^{]*/gm },
  { kind: "interface", pattern: /^(?:export\s+)?interface\s+(\w+)[^{]*/gm },
  { kind: "type", pattern: /^(?:export\s+)?type\s+(\w+)\s*[=<]/gm },
  { kind: "const", pattern: /^(?:export\s+)?const\s+(\w+)\s*[=:]/gm },
  { kind: "enum", pattern: /^(?:export\s+)?enum\s+(\w+)/gm },
];

const IMPORT_PATTERN =
  /(?:import\s+(?:[\w{},*\s]+\s+from\s+)?["']([^"']+)["']|require\s*\(\s*["']([^"']+)["']\s*\))/g;

const DEFAULT_EXCLUDE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  ".turbo",
  ".next",
  "__pycache__",
  "target",
  "vendor",
];

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
]);

/**
 * Extract symbol definitions from source code using regex.
 */
export function extractSymbolDefinitions(content: string, filePath: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = [];
  const lines = content.split("\n");

  for (const { kind, pattern } of SYMBOL_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (!name) continue;

      // Calculate line number
      const beforeMatch = content.slice(0, match.index);
      const line = beforeMatch.split("\n").length;

      // Get the signature (just the matched line, trimmed)
      const lineContent = lines[line - 1]?.trim() ?? match[0].trim();

      symbols.push({
        name,
        kind,
        signature: lineContent.replace(/\s*\{?\s*$/, ""),
        filePath,
        line,
      });
    }
  }

  return symbols;
}

/**
 * Extract import edges from source code.
 * Resolves relative imports to file paths.
 */
export function extractImports(content: string, filePath: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const regex = new RegExp(IMPORT_PATTERN.source, IMPORT_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const importPath = match[1] ?? match[2];
    if (!importPath) continue;

    // Only track relative imports (project-internal)
    if (importPath.startsWith(".")) {
      // Normalize: remove extension, resolve relative to file dir
      const normalized = importPath
        .replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, "")
        .replace(/\/index$/, "");
      edges.push({ from: filePath, to: normalized });
    }
  }

  return edges;
}

/**
 * Simple PageRank-like scoring.
 * Files that define symbols imported by many other files rank higher.
 */
export function computeFileScores(
  importEdges: ImportEdge[],
  filePaths: string[],
  damping = 0.85,
  iterations = 10,
): Map<string, number> {
  const n = filePaths.length;
  if (n === 0) return new Map();

  const scores = new Map<string, number>();
  const inLinks = new Map<string, Set<string>>();
  const outCount = new Map<string, number>();

  // Initialize
  for (const fp of filePaths) {
    scores.set(fp, 1 / n);
    inLinks.set(fp, new Set());
    outCount.set(fp, 0);
  }

  // Build adjacency from import edges
  for (const edge of importEdges) {
    // Find the target file that matches the import path
    const importBase = edge.to.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx)$/, "");
    const target = filePaths.find((fp) => {
      const normalized = fp.replace(/\.(ts|tsx|js|jsx)$/, "");
      return (
        normalized === importBase || normalized === edge.to || normalized.endsWith(`/${importBase}`)
      );
    });

    if (target && target !== edge.from) {
      inLinks.get(target)?.add(edge.from);
      outCount.set(edge.from, (outCount.get(edge.from) ?? 0) + 1);
    }
  }

  // Iterate PageRank
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();

    for (const fp of filePaths) {
      let rank = (1 - damping) / n;
      const incoming = inLinks.get(fp);
      if (incoming) {
        for (const source of incoming) {
          const sourceScore = scores.get(source) ?? 0;
          const sourceOut = outCount.get(source) ?? 1;
          rank += damping * (sourceScore / sourceOut);
        }
      }
      newScores.set(fp, rank);
    }

    for (const [fp, score] of newScores) {
      scores.set(fp, score);
    }
  }

  return scores;
}

/**
 * Format ranked files as a compact context string for LLM injection.
 */
export function formatRepoMap(rankedFiles: RankedFile[], maxTokenBudget = 2000): string {
  const lines: string[] = ["# Repository Map (ranked by importance)", ""];
  let tokens = 20; // header overhead

  for (const file of rankedFiles) {
    const fileLine = `## ${file.filePath}`;
    const fileTokens = Math.ceil(fileLine.length / 4);

    if (tokens + fileTokens > maxTokenBudget) break;
    lines.push(fileLine);
    tokens += fileTokens;

    for (const sym of file.symbols) {
      const symLine = `  ${sym.kind} ${sym.signature}`;
      const symTokens = Math.ceil(symLine.length / 4);

      if (tokens + symTokens > maxTokenBudget) break;
      lines.push(symLine);
      tokens += symTokens;
    }

    lines.push("");
    tokens += 1;
  }

  return lines.join("\n");
}

/**
 * Build a complete repo map for a project directory.
 * Scans source files, extracts symbols and imports, computes PageRank scores,
 * and returns ranked files with their symbols.
 */
export async function buildRepoMap(
  projectRoot: string,
  options: RepoMapOptions = {},
): Promise<RankedFile[]> {
  const excludePatterns = [...DEFAULT_EXCLUDE, ...(options.excludePatterns ?? [])];
  const files = await collectSourceFiles(projectRoot, excludePatterns);
  const useTreeSitter = options.useTreeSitter ?? true;

  const allSymbols = new Map<string, SymbolDefinition[]>();
  const allImports: ImportEdge[] = [];
  const relPaths: string[] = [];

  // Initialize tree-sitter extractor if enabled
  const treeSitterExtractor = useTreeSitter ? new RepoMapTreeSitter() : null;

  for (const fullPath of files) {
    try {
      const content = await readFile(fullPath, "utf-8");
      const relPath = relative(projectRoot, fullPath);
      relPaths.push(relPath);

      // Use tree-sitter if available, otherwise fall back to regex
      const symbols = treeSitterExtractor
        ? treeSitterExtractor.extractSymbols(content, relPath)
        : extractSymbolDefinitions(content, relPath);
      allSymbols.set(relPath, symbols);

      const imports = extractImports(content, relPath);
      allImports.push(...imports);
    } catch {
      // Skip unreadable files
    }
  }

  const scores = computeFileScores(allImports, relPaths);

  const ranked: RankedFile[] = relPaths
    .map((fp) => ({
      filePath: fp,
      score: scores.get(fp) ?? 0,
      symbols: allSymbols.get(fp) ?? [],
    }))
    .sort((a, b) => b.score - a.score);

  return ranked;
}

async function collectSourceFiles(dir: string, excludePatterns: string[]): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (excludePatterns.includes(entry)) continue;

      const fullPath = join(dir, entry);
      try {
        const fileStat = await stat(fullPath);
        if (fileStat.isDirectory()) {
          files.push(...(await collectSourceFiles(fullPath, excludePatterns)));
        } else if (fileStat.isFile() && INDEXABLE_EXTENSIONS.has(extname(entry))) {
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
