// ============================================================================
// @dantecode/core — Context Selector
// Selects files to include in the LLM context with intelligent relevance scoring.
// ============================================================================

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ContextCandidate {
  path: string;
  relevanceScore: number;
  reason: string;
}

export interface ContextSelectorOptions {
  /** Maximum number of files to include. Default: 200. */
  maxFiles?: number;
  /** Enable git frequency weighting. Default: true. */
  useGitFrequency?: boolean;
  /** Automatically include adjacent test files. Default: true. */
  includeAdjacentTests?: boolean;
  /** Automatically include referenced type definition files. Default: true. */
  includeTypeDefinitions?: boolean;
  /** Number of recent commits to analyze for frequency. Default: 50. */
  gitHistoryDepth?: number;
}

// ----------------------------------------------------------------------------
// Git Frequency Weighting
// ----------------------------------------------------------------------------

/**
 * Runs `git log --pretty=format: --name-only` to count how often each file
 * has been edited in recent history. Files that appear more frequently are
 * likely more important to the project's active development.
 *
 * @param projectRoot - The git repository root
 * @param limit - Number of recent commits to analyze (default: 50)
 * @returns Map of file path (relative) to appearance count
 */
export function getGitFrequencyScores(
  projectRoot: string,
  limit: number = 50,
): Map<string, number> {
  const scores = new Map<string, number>();
  try {
    const output = execFileSync(
      "git",
      ["log", "--pretty=format:", "--name-only", `-n`, String(limit)],
      {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const lines = output.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      scores.set(trimmed, (scores.get(trimmed) || 0) + 1);
    }
  } catch {
    // Non-fatal: git may not be available or this may not be a git repo
  }
  return scores;
}

/**
 * Computes a frequency multiplier for a file based on its git edit history.
 * Formula: 1 + 0.1 * min(appearances, 5)
 * Range: 1.0 (never edited) to 1.5 (edited 5+ times recently)
 */
export function computeFrequencyMultiplier(
  filePath: string,
  frequencyScores: Map<string, number>,
): number {
  const appearances = frequencyScores.get(filePath) || 0;
  return 1 + 0.1 * Math.min(appearances, 5);
}

// ----------------------------------------------------------------------------
// Adjacent Test File Discovery
// ----------------------------------------------------------------------------

/**
 * Given a source file path, finds its adjacent test file if it exists.
 * Checks common test file naming conventions:
 * - foo.ts -> foo.test.ts
 * - foo.ts -> foo.spec.ts
 * - foo.ts -> __tests__/foo.test.ts
 * - foo.ts -> __tests__/foo.ts
 *
 * @param filePath - Absolute or relative path to a source file
 * @returns The test file path if found, null otherwise
 */
export function findAdjacentTestFile(filePath: string): string | null {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);

  // Skip if already a test file
  if (base.endsWith(".test") || base.endsWith(".spec")) {
    return null;
  }

  const candidates = [
    join(dir, `${base}.test${ext}`),
    join(dir, `${base}.spec${ext}`),
    join(dir, "__tests__", `${base}.test${ext}`),
    join(dir, "__tests__", `${base}${ext}`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// ----------------------------------------------------------------------------
// Type Definition Inclusion
// ----------------------------------------------------------------------------

/** Regex patterns to detect type imports in source files. */
const TYPE_IMPORT_PATTERNS = [
  // import type { Foo } from "./types"
  /import\s+type\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/g,
  // import { type Foo } from "./bar"
  /import\s+\{[^}]*\btype\b[^}]*\}\s+from\s+["']([^"']+)["']/g,
  // /// <reference types="..." />
  /\/\/\/\s*<reference\s+types=["']([^"']+)["']\s*\/>/g,
];

/**
 * Extracts type definition file references from source code.
 * Looks for import type statements and triple-slash type references.
 *
 * @param sourceCode - The source code to analyze
 * @param sourceDir - The directory containing the source file
 * @returns Array of resolved type definition file paths that exist on disk
 */
export function findReferencedTypeFiles(
  sourceCode: string,
  sourceDir: string,
): string[] {
  const typeFiles: Set<string> = new Set();

  for (const pattern of TYPE_IMPORT_PATTERNS) {
    // Reset lastIndex for global regex reuse
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sourceCode)) !== null) {
      const importPath = match[1];
      if (!importPath) continue;

      // Check for .d.ts files
      const candidates = [
        join(sourceDir, `${importPath}.d.ts`),
        join(sourceDir, importPath, "index.d.ts"),
        join(sourceDir, `${importPath}.ts`),
      ];

      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          typeFiles.add(candidate);
          break;
        }
      }
    }
  }

  return Array.from(typeFiles);
}

// ----------------------------------------------------------------------------
// Language Detection
// ----------------------------------------------------------------------------

/** Map of file extensions to language identifiers. */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".swift": "swift",
  ".kt": "kotlin",
  ".php": "php",
};

/**
 * Detects the primary language of a project by counting file extensions.
 * Returns the language with the most files in context.
 *
 * @param filePaths - Array of file paths to analyze
 * @returns The detected primary language, or "unknown"
 */
export function detectPrimaryLanguage(filePaths: string[]): string {
  const counts = new Map<string, number>();

  for (const fp of filePaths) {
    const ext = extname(fp).toLowerCase();
    const lang = EXTENSION_LANGUAGE_MAP[ext];
    if (lang) {
      counts.set(lang, (counts.get(lang) || 0) + 1);
    }
  }

  let maxLang = "unknown";
  let maxCount = 0;
  for (const [lang, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }
  return maxLang;
}

// ----------------------------------------------------------------------------
// Main Context Selection
// ----------------------------------------------------------------------------

/**
 * Selects files to include in the LLM context with intelligent relevance scoring.
 * Applies git frequency weighting, includes adjacent test files, and resolves
 * type definition references.
 *
 * @param candidateFiles - Array of candidate files with initial scores
 * @param projectRoot - The project root directory
 * @param options - Configuration options
 * @returns Sorted array of context files, capped at maxFiles
 */
export function selectContextFiles(
  candidateFiles: ContextCandidate[],
  projectRoot: string,
  options: ContextSelectorOptions = {},
): ContextCandidate[] {
  const {
    maxFiles = 200,
    useGitFrequency = true,
    includeAdjacentTests = true,
    includeTypeDefinitions = true,
    gitHistoryDepth = 50,
  } = options;

  // Step 1: Git frequency weighting
  let frequencyScores: Map<string, number> | undefined;
  if (useGitFrequency) {
    frequencyScores = getGitFrequencyScores(projectRoot, gitHistoryDepth);
  }

  // Apply frequency multiplier to candidate scores
  const scored = candidateFiles.map((file) => {
    let adjustedScore = file.relevanceScore;
    if (frequencyScores) {
      adjustedScore *= computeFrequencyMultiplier(file.path, frequencyScores);
    }
    return { ...file, relevanceScore: adjustedScore };
  });

  // Step 2: Sort by adjusted score (descending)
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Step 3: Take top files up to limit
  const selected = scored.slice(0, maxFiles);
  const selectedPaths = new Set(selected.map((f) => f.path));
  const additionalFiles: ContextCandidate[] = [];

  // Step 4: Include adjacent test files
  if (includeAdjacentTests) {
    for (const file of selected) {
      const testFile = findAdjacentTestFile(file.path);
      if (testFile && !selectedPaths.has(testFile)) {
        selectedPaths.add(testFile);
        additionalFiles.push({
          path: testFile,
          relevanceScore: file.relevanceScore * 0.8,
          reason: `adjacent test for ${basename(file.path)}`,
        });
      }
    }
  }

  // Step 5: Include type definition files (skipped if includeTypeDefinitions is false)
  if (includeTypeDefinitions) {
    // This is a lightweight pass — we don't read file contents here,
    // we just check for .d.ts siblings of selected files.
    for (const file of selected) {
      const dir = dirname(file.path);
      const ext = extname(file.path);
      const base = basename(file.path, ext);
      const dtsPath = join(dir, `${base}.d.ts`);
      if (existsSync(dtsPath) && !selectedPaths.has(dtsPath)) {
        selectedPaths.add(dtsPath);
        additionalFiles.push({
          path: dtsPath,
          relevanceScore: file.relevanceScore * 0.7,
          reason: `type definitions for ${basename(file.path)}`,
        });
      }
    }
  }

  // Combine and re-sort, then cap
  const result = [...selected, ...additionalFiles];
  result.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return result.slice(0, maxFiles);
}
