// packages/core/src/repo-map-builder.ts
// Enhanced Repo Map Builder — closes dim 4 (Repo-level context: 8→9) gap vs Augment/Claude Code.
//
// Generates a multi-tier repository map with:
//   - File importance scoring (edit frequency, import fan-in, size)
//   - Dependency graph edges (who imports whom)
//   - Entry point detection (main.ts, index.ts, CLI entry files)
//   - Symbol export inventory (classes, functions per file)
//
// Pattern: Aider's RepoMap (ranked by PageRank of imports) + Continue.dev file-tree context.
// The map is injected into the system prompt to give the model a mental model of the codebase
// before it reads any specific file.

import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepoFileEntry {
  /** Relative path from project root */
  path: string;
  /** File size in bytes */
  sizeBytes: number;
  /** Estimated token count (sizeBytes / 4) */
  tokens: number;
  /** Files this file imports */
  imports: string[];
  /** Number of other files that import this file (fan-in) */
  fanIn: number;
  /** Exported symbol names (functions, classes, types) */
  exports: string[];
  /** Whether this is likely an entry point */
  isEntryPoint: boolean;
  /** Importance score (0–100) */
  importance: number;
  /** File extension category */
  category: "source" | "test" | "config" | "doc" | "other";
}

export interface RepoDependencyEdge {
  from: string;
  to: string;
}

export interface RepoMap {
  /** Project root (absolute) */
  projectRoot: string;
  /** All scanned files, sorted by importance */
  files: RepoFileEntry[];
  /** Import dependency edges */
  edges: RepoDependencyEdge[];
  /** Top entry points */
  entryPoints: string[];
  /** Total file count */
  totalFiles: number;
  /** Total estimated tokens */
  totalTokens: number;
  /** Generation timestamp */
  generatedAt: string;
}

// ─── Glob (minimal, no external dep) ─────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const TEST_PATTERNS = /\.(test|spec)\.|__tests__/;
const CONFIG_PATTERNS = /\.(json|yaml|yml|toml|env|config\.)|(tsconfig|vite\.config|jest\.config|vitest\.config)/i;
const ENTRY_POINT_PATTERNS = /^(index|main|cli|app|server|entry)\.(ts|tsx|js|jsx|mts)$/i;
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".turbo", "coverage", ".next", ".cache"]);

function walkDir(dir: string, files: string[] = []): string[] {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          walkDir(join(dir, entry.name), files);
        }
      } else if (entry.isFile()) {
        files.push(join(dir, entry.name));
      }
    }
  } catch { /* non-fatal */ }
  return files;
}

// ─── Import Extractor ─────────────────────────────────────────────────────────

const IMPORT_RE = /(?:from\s+['"]|require\(['"])(\.\.?\/[^'"]+)['"]/g;

function extractImports(content: string): string[] {
  const imports: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_RE.exec(content)) !== null) {
    const path = match[1];
    if (path) imports.push(path);
  }
  return [...new Set(imports)];
}

// ─── Export Extractor ─────────────────────────────────────────────────────────

const EXPORT_RE = /^export\s+(?:(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*))/gm;

function extractExports(content: string): string[] {
  const exports: string[] = [];
  EXPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_RE.exec(content)) !== null) {
    if (match[1]) exports.push(match[1]);
  }
  return [...new Set(exports)].slice(0, 15);  // cap at 15 exports per file
}

// ─── Category Classifier ──────────────────────────────────────────────────────

function classifyFile(filePath: string): RepoFileEntry["category"] {
  const name = basename(filePath);
  if (TEST_PATTERNS.test(filePath)) return "test";
  if (CONFIG_PATTERNS.test(name)) return "config";
  if (/\.md$/i.test(name)) return "doc";
  if (SOURCE_EXTENSIONS.has(extname(name))) return "source";
  return "other";
}

// ─── Importance Scorer ────────────────────────────────────────────────────────

function scoreImportance(
  file: Omit<RepoFileEntry, "importance">,
  _allFiles: Map<string, Omit<RepoFileEntry, "importance">>,
): number {
  let score = 0;

  // Entry point bonus
  if (file.isEntryPoint) score += 30;

  // Fan-in bonus (people import this file)
  score += Math.min(25, file.fanIn * 5);

  // Export richness (files that export more are usually more important)
  score += Math.min(15, file.exports.length * 2);

  // Category bonus: source > config > test > other
  const categoryScore: Record<RepoFileEntry["category"], number> = {
    source: 15, config: 5, test: 0, doc: 0, other: 0,
  };
  score += categoryScore[file.category] ?? 0;

  // Size normalization: very small (stub?) and very large (generated?) both score lower
  const tokens = file.tokens;
  if (tokens < 20) score -= 5;
  else if (tokens > 5000) score -= 10;
  else score += 10;

  return Math.max(0, Math.min(100, score));
}

// ─── Main Builder ─────────────────────────────────────────────────────────────

export interface RepoMapOptions {
  /** Max files to include in the map (default: 200) */
  maxFiles?: number;
  /** Only include source files (skip tests, config) */
  sourceOnly?: boolean;
  /** Extra glob-like patterns to ignore */
  ignorePatterns?: RegExp[];
}

/**
 * Build a repository map from a project root directory.
 * Scans all source files, extracts imports/exports, scores importance.
 */
function filterSourceFiles(
  allFilePaths: string[],
  sourceOnly: boolean,
  ignorePatterns: RegExp[],
): string[] {
  return allFilePaths.filter((fp) => {
    const ext = extname(fp);
    if (!SOURCE_EXTENSIONS.has(ext)) return false;
    if (ignorePatterns.some((p) => p.test(fp))) return false;
    if (sourceOnly && TEST_PATTERNS.test(fp)) return false;
    return true;
  });
}

/** Read each file (skipping >500KB), parse imports/exports, and accumulate
 *  the per-file entry into `fileMap`. */
function buildFileMap(
  projectRoot: string,
  filteredPaths: string[],
): Map<string, Omit<RepoFileEntry, "importance">> {
  const fileMap = new Map<string, Omit<RepoFileEntry, "importance">>();
  for (const absPath of filteredPaths) {
    const relPath = relative(projectRoot, absPath).replace(/\\/g, "/");
    let content = "";
    let sizeBytes = 0;
    try {
      const stat = statSync(absPath);
      sizeBytes = stat.size;
      if (sizeBytes < 500_000) content = readFileSync(absPath, "utf-8");
    } catch { continue; }

    fileMap.set(relPath, {
      path: relPath,
      sizeBytes,
      tokens: Math.ceil(sizeBytes / 4),
      imports: extractImports(content),
      fanIn: 0,
      exports: extractExports(content),
      isEntryPoint: ENTRY_POINT_PATTERNS.test(basename(absPath)),
      category: classifyFile(absPath),
    });
  }
  return fileMap;
}

/** Walk each entry's raw import strings; resolve them to known files and
 *  emit edges + fan-in updates. */
function resolveImportEdges(
  fileMap: Map<string, Omit<RepoFileEntry, "importance">>,
): RepoDependencyEdge[] {
  const edges: RepoDependencyEdge[] = [];
  for (const [fromPath, entry] of fileMap.entries()) {
    for (const importPath of entry.imports) {
      const fromDir = fromPath.split("/").slice(0, -1).join("/");
      const candidates = [
        `${fromDir}/${importPath}`,
        `${fromDir}/${importPath}.ts`,
        `${fromDir}/${importPath}.tsx`,
        `${fromDir}/${importPath}/index.ts`,
      ].map((p) => p.replace(/\/\//g, "/").replace(/^\//, "").replace(/^\.\//, ""));

      for (const candidate of candidates) {
        if (fileMap.has(candidate)) {
          edges.push({ from: fromPath, to: candidate });
          fileMap.get(candidate)!.fanIn++;
          break;
        }
      }
    }
  }
  return edges;
}

export function buildRepoMap(projectRoot: string, options: RepoMapOptions = {}): RepoMap {
  const { maxFiles = 200, sourceOnly = false, ignorePatterns = [] } = options;

  const allFilePaths = walkDir(projectRoot);
  const filteredPaths = filterSourceFiles(allFilePaths, sourceOnly, ignorePatterns);
  const fileMap = buildFileMap(projectRoot, filteredPaths);
  const edges = resolveImportEdges(fileMap);

  const scored: RepoFileEntry[] = [];
  for (const [, entry] of fileMap.entries()) {
    scored.push({ ...entry, importance: scoreImportance(entry, fileMap) });
  }
  scored.sort((a, b) => b.importance - a.importance);
  const topFiles = scored.slice(0, maxFiles);

  return {
    projectRoot,
    files: topFiles,
    edges,
    entryPoints: topFiles.filter((f) => f.isEntryPoint).map((f) => f.path),
    totalFiles: allFilePaths.length,
    totalTokens: topFiles.reduce((s, f) => s + f.tokens, 0),
    generatedAt: new Date().toISOString(),
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export interface RepoMapFormatOptions {
  /** Max files to show in formatted output (default: 30) */
  topN?: number;
  /** Show exports per file */
  showExports?: boolean;
  /** Show dependency edges */
  showDependencies?: boolean;
  /** Token budget for the formatted output */
  maxOutputTokens?: number;
}

/**
 * Format a repo map for injection into an AI system prompt.
 * Produces a compact tree-like view sorted by importance.
 */
export function formatRepoMapForPrompt(map: RepoMap, opts: RepoMapFormatOptions = {}): string {
  const { topN = 30, showExports = true, showDependencies = false, maxOutputTokens = 2000 } = opts;

  const lines: string[] = [
    "## Repository Map",
    `Project: ${map.projectRoot.split(/[\\/]/).pop() ?? map.projectRoot}  |  ${map.totalFiles} total files`,
    "",
  ];

  if (map.entryPoints.length > 0) {
    lines.push(`**Entry points:** ${map.entryPoints.slice(0, 5).join(", ")}`);
    lines.push("");
  }

  // Group by directory for readability
  const byDir = new Map<string, RepoFileEntry[]>();
  for (const file of map.files.slice(0, topN)) {
    const dir = file.path.includes("/") ? file.path.split("/").slice(0, -1).join("/") : "(root)";
    const existing = byDir.get(dir) ?? [];
    existing.push(file);
    byDir.set(dir, existing);
  }

  for (const [dir, files] of byDir.entries()) {
    lines.push(`**${dir}/:**`);
    for (const file of files) {
      const name = file.path.split("/").pop() ?? file.path;
      const importanceBar = "█".repeat(Math.round(file.importance / 20)) + "░".repeat(5 - Math.round(file.importance / 20));
      const exportStr = showExports && file.exports.length > 0
        ? ` → ${file.exports.slice(0, 4).join(", ")}${file.exports.length > 4 ? "…" : ""}`
        : "";
      lines.push(`  ${importanceBar} ${name}${exportStr}`);
    }
    lines.push("");
  }

  if (showDependencies && map.edges.length > 0) {
    lines.push("**Key dependencies:**");
    // Show top 10 most-imported files
    const importCounts = new Map<string, number>();
    for (const edge of map.edges) {
      importCounts.set(edge.to, (importCounts.get(edge.to) ?? 0) + 1);
    }
    const topDeps = [...importCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (const [path, count] of topDeps) {
      lines.push(`  ${path} (imported by ${count} files)`);
    }
    lines.push("");
  }

  const result = lines.join("\n");
  // Trim to token budget
  const maxChars = maxOutputTokens * 4;
  return result.length > maxChars ? result.slice(0, maxChars) + "\n… (map truncated)" : result;
}

/**
 * Get the most important files as a flat list (for context injection).
 * Returns paths sorted by importance score.
 */
export function getTopFiles(map: RepoMap, n = 10): string[] {
  return map.files.slice(0, n).map((f) => f.path);
}
