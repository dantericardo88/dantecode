// ============================================================================
// @dantecode/core - AST Repo Map (Regex-Based Symbol Extraction + PageRank)
// Builds a compact ranked file map for LLM context injection.
// ============================================================================

import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";

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
 * Extract symbol definitions from source code.
 * Tries tree-sitter AST first; falls back to regex when AST returns [].
 */
export async function extractSymbolDefinitions(content: string, filePath: string): Promise<SymbolDefinition[]> {
  try {
    const { extractTagsAST, detectTreeSitterLanguage } = await import("./tree-sitter/index.js");
    const language = detectTreeSitterLanguage(filePath);
    if (language) {
      const tags = await extractTagsAST(content, language, filePath);
      const defs = tags.filter((t) => t.kind === "def");
      if (defs.length > 0) {
        const lines = content.split("\n");
        return defs.map((t) => {
          const line = t.line + 1; // tree-sitter is 0-indexed
          const lineContent = lines[t.line]?.trim() ?? t.name;
          const kindStr = (t as { defKind?: string }).defKind;
          const kind: SymbolDefinition["kind"] =
            kindStr === "class" ? "class"
            : kindStr === "interface" ? "interface"
            : kindStr === "type" ? "type"
            : kindStr === "const" || kindStr === "var" || kindStr === "let" ? "const"
            : kindStr === "enum" ? "enum"
            : "function";
          return { name: t.name, kind, signature: lineContent, filePath, line };
        });
      }
    }
  } catch {
    // fall through to regex
  }
  return extractSymbolDefinitionsRegex(content, filePath);
}

function extractSymbolDefinitionsRegex(content: string, filePath: string): SymbolDefinition[] {
  const symbols: SymbolDefinition[] = [];
  const lines = content.split("\n");

  for (const { kind, pattern } of SYMBOL_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (!name) continue;

      const beforeMatch = content.slice(0, match.index);
      const line = beforeMatch.split("\n").length;
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
export interface ComputeFileScoresOptions {
  chatFiles?: string[];
  damping?: number;
  iterations?: number;
}

export function computeFileScores(
  importEdges: ImportEdge[],
  filePaths: string[],
  options: ComputeFileScoresOptions = {},
): Map<string, number> {
  const { chatFiles = [], damping = 0.85, iterations = 10 } = options;
  const n = filePaths.length;
  if (n === 0) return new Map();

  const chatSet = new Set(chatFiles);
  const scores = new Map<string, number>();
  const inLinks = new Map<string, Set<string>>();
  const outCount = new Map<string, number>();

  // Initialize — chat files get a boosted starting score
  for (const fp of filePaths) {
    scores.set(fp, chatSet.has(fp) ? 2 / n : 1 / n);
    inLinks.set(fp, new Set());
    outCount.set(fp, 0);
  }

  // Build adjacency from import edges
  for (const edge of importEdges) {
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

  // Personalization vector: chat files get 2× weight for teleportation
  const totalWeight = filePaths.reduce((acc, fp) => acc + (chatSet.has(fp) ? 2 : 1), 0);
  const personalization = new Map<string, number>(
    filePaths.map((fp) => [fp, (chatSet.has(fp) ? 2 : 1) / totalWeight]),
  );

  // Iterate PageRank
  for (let iter = 0; iter < iterations; iter++) {
    const newScores = new Map<string, number>();

    for (const fp of filePaths) {
      let rank = (1 - damping) * (personalization.get(fp) ?? 1 / n);
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
      const symLine = `  ${sym.kind} ${sym.signature} (line ${sym.line})`;
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

const MAX_SYMBOLS_PER_FILE = 30;

/**
 * Render ranked files in a tree-style format (filepath:\n  kind name (line N)).
 * Slices to MAX_SYMBOLS_PER_FILE per file and appends "... (N more)" for overflow.
 */
export function renderToTree(rankedFiles: RankedFile[], maxTokenBudget = 8000): string {
  if (rankedFiles.length === 0) return "";

  const lines: string[] = [];
  let tokens = 0;

  for (const file of rankedFiles) {
    const headerLine = `${file.filePath}:`;
    const headerTokens = Math.ceil(headerLine.length / 4);
    if (tokens + headerTokens > maxTokenBudget) break;
    lines.push(headerLine);
    tokens += headerTokens;

    const sliced = file.symbols.slice(0, MAX_SYMBOLS_PER_FILE);
    const overflow = file.symbols.length - sliced.length;

    for (const sym of sliced) {
      const symLine = `  ${sym.kind} ${sym.name} (line ${sym.line})`;
      const symTokens = Math.ceil(symLine.length / 4);
      if (tokens + symTokens > maxTokenBudget) break;
      lines.push(symLine);
      tokens += symTokens;
    }

    if (overflow > 0) {
      lines.push(`  ... (${overflow} more)`);
    }
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

  const allSymbols = new Map<string, SymbolDefinition[]>();
  const allImports: ImportEdge[] = [];
  const relPaths: string[] = [];

  for (const fullPath of files) {
    try {
      const content = await readFile(fullPath, "utf-8");
      const relPath = relative(projectRoot, fullPath);
      relPaths.push(relPath);

      const symbols = await extractSymbolDefinitions(content, relPath);
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

// ── Aider-style symbol tags ───────────────────────────────────────────────────

export interface SymbolTag {
  name: string;
  kind: SymbolDefinition["kind"];
  definedInFile: string;
  refCount: number;
  refFiles: string[];
}

/**
 * Given a map of file→symbols and file contents, compute Aider-style tags:
 * for each symbol, count how many OTHER files reference it by name.
 */
export async function extractSymbolTags(
  allSymbols: Map<string, Array<{ name: string; kind: SymbolDefinition["kind"]; filePath: string }>>,
  fileContents: Map<string, string>,
): Promise<SymbolTag[]> {
  const tags: SymbolTag[] = [];
  for (const [filePath, symbols] of allSymbols) {
    for (const sym of symbols) {
      const refFiles: string[] = [];
      for (const [otherPath, content] of fileContents) {
        if (otherPath === filePath) continue;
        if (content.includes(sym.name)) refFiles.push(otherPath);
      }
      tags.push({ name: sym.name, kind: sym.kind, definedInFile: filePath, refCount: refFiles.length, refFiles });
    }
  }
  return tags;
}

/**
 * Scans a project root and returns Aider-style SymbolTags with reference counts,
 * sorted by refCount descending.
 */
export async function buildRepoMapTags(
  projectRoot: string,
  options: RepoMapOptions = {},
): Promise<SymbolTag[]> {
  const excludePatterns = [...DEFAULT_EXCLUDE, ...(options.excludePatterns ?? [])];
  const files = await collectSourceFiles(projectRoot, excludePatterns);

  const allSymbols = new Map<string, SymbolDefinition[]>();
  const fileContents = new Map<string, string>();

  for (const fullPath of files) {
    try {
      const content = await readFile(fullPath, "utf-8");
      const relPath = relative(projectRoot, fullPath);
      fileContents.set(relPath, content);
      allSymbols.set(relPath, await extractSymbolDefinitions(content, relPath));
    } catch {
      // skip
    }
  }

  const tags = await extractSymbolTags(allSymbols, fileContents);
  return tags.sort((a, b) => b.refCount - a.refCount);
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
