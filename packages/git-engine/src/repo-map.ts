// ============================================================================
// @dantecode/git-engine — Repository Map Generation (Aider-derived)
// ============================================================================

import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { join, extname, sep } from "node:path";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single entry in the repository map. */
export interface RepoMapEntry {
  /** File path relative to the repository root. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Detected language/file type based on extension. */
  language: string;
  /** Last modification time as ISO 8601 string. */
  lastModified: string;
}

/** Options for repository map generation. */
export interface RepoMapOptions {
  /** Maximum number of files to include (default: 200). */
  maxFiles?: number;
  /** Additional ignore patterns beyond the defaults. */
  extraIgnorePatterns?: string[];
  /** Only include files matching these extensions (e.g. [".ts", ".js"]). */
  includeExtensions?: string[];
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Default patterns to ignore when building the repo map. */
const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  "node_modules",
  "dist",
  ".git",
  ".next",
  ".nuxt",
  "__pycache__",
  ".pytest_cache",
  "coverage",
  ".nyc_output",
  "build",
  ".cache",
  ".turbo",
  ".vercel",
  ".output",
  "vendor",
  ".venv",
  "venv",
  ".env",
  ".tsbuildinfo",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".DS_Store",
  "Thumbs.db",
] as const;

const DEFAULT_MAX_FILES = 200;

/**
 * Map of file extensions to human-readable language names.
 * Covers the most common programming and configuration languages.
 */
const EXTENSION_LANGUAGE_MAP: Readonly<Record<string, string>> = {
  // JavaScript / TypeScript
  ".ts": "TypeScript",
  ".tsx": "TypeScript (React)",
  ".js": "JavaScript",
  ".jsx": "JavaScript (React)",
  ".mjs": "JavaScript (ESM)",
  ".cjs": "JavaScript (CJS)",
  ".mts": "TypeScript (ESM)",
  ".cts": "TypeScript (CJS)",

  // Web
  ".html": "HTML",
  ".htm": "HTML",
  ".css": "CSS",
  ".scss": "SCSS",
  ".sass": "Sass",
  ".less": "Less",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".astro": "Astro",

  // Systems
  ".rs": "Rust",
  ".go": "Go",
  ".c": "C",
  ".h": "C Header",
  ".cpp": "C++",
  ".hpp": "C++ Header",
  ".cc": "C++",
  ".cs": "C#",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin Script",
  ".swift": "Swift",
  ".m": "Objective-C",
  ".mm": "Objective-C++",

  // Scripting
  ".py": "Python",
  ".rb": "Ruby",
  ".php": "PHP",
  ".pl": "Perl",
  ".lua": "Lua",
  ".sh": "Shell",
  ".bash": "Bash",
  ".zsh": "Zsh",
  ".fish": "Fish",
  ".ps1": "PowerShell",
  ".bat": "Batch",
  ".cmd": "Batch",

  // Data / Config
  ".json": "JSON",
  ".jsonc": "JSON (with comments)",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".toml": "TOML",
  ".xml": "XML",
  ".ini": "INI",
  ".env": "Environment",
  ".cfg": "Config",
  ".conf": "Config",

  // Documentation
  ".md": "Markdown",
  ".mdx": "MDX",
  ".rst": "reStructuredText",
  ".txt": "Text",
  ".tex": "LaTeX",

  // Database
  ".sql": "SQL",
  ".graphql": "GraphQL",
  ".gql": "GraphQL",
  ".prisma": "Prisma",

  // Build / DevOps
  ".dockerfile": "Dockerfile",
  ".tf": "Terraform",
  ".hcl": "HCL",
  ".nix": "Nix",
  ".cmake": "CMake",

  // Other
  ".r": "R",
  ".scala": "Scala",
  ".ex": "Elixir",
  ".exs": "Elixir Script",
  ".erl": "Erlang",
  ".hs": "Haskell",
  ".ml": "OCaml",
  ".clj": "Clojure",
  ".dart": "Dart",
  ".zig": "Zig",
  ".wasm": "WebAssembly",
  ".proto": "Protocol Buffers",
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Execute a git command synchronously in the given working directory.
 */
function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
    }).trim();
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const msg = stderr || err.message || "Unknown git error";
    throw new Error(`git ${args.split(" ")[0]}: ${msg}`);
  }
}

/**
 * Detect the language of a file based on its extension.
 * Falls back to the extension itself (without dot) or "Unknown".
 */
function detectLanguage(filePath: string): string {
  const ext = extname(filePath).toLowerCase();

  // Handle extensionless files by name
  const basename = filePath.split("/").pop() ?? filePath.split("\\").pop() ?? filePath;
  const nameMap: Readonly<Record<string, string>> = {
    Dockerfile: "Dockerfile",
    Makefile: "Makefile",
    Rakefile: "Ruby",
    Gemfile: "Ruby",
    Vagrantfile: "Ruby",
    Justfile: "Just",
    CMakeLists: "CMake",
  };

  if (!ext && basename in nameMap) {
    return nameMap[basename]!;
  }

  if (ext && ext in EXTENSION_LANGUAGE_MAP) {
    return EXTENSION_LANGUAGE_MAP[ext]!;
  }

  if (ext) {
    return ext.slice(1).toUpperCase();
  }

  return "Unknown";
}

/**
 * Check if a file path matches any of the given ignore patterns.
 * Patterns match against any segment of the path.
 */
function shouldIgnore(filePath: string, patterns: readonly string[]): boolean {
  // Normalize separators to forward slashes for consistent matching
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");

  for (const pattern of patterns) {
    // Check if any path segment matches the pattern exactly
    if (segments.includes(pattern)) {
      return true;
    }
    // Check if the full path ends with the pattern (for file names like package-lock.json)
    if (normalized.endsWith(pattern)) {
      return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Scan the repository and build a file map with metadata for each tracked file.
 *
 * Uses `git ls-files` to enumerate tracked files, then collects size, language,
 * and last-modified time for each. Results are sorted by modification time
 * (most recent first) and limited to `maxFiles`.
 *
 * @param projectRoot - Absolute path to the repository root.
 * @param options - Optional configuration for filtering and limits.
 * @returns Array of RepoMapEntry objects sorted by recency.
 */
export function generateRepoMap(
  projectRoot: string,
  options?: RepoMapOptions,
): RepoMapEntry[] {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
  const extraPatterns = options?.extraIgnorePatterns ?? [];
  const includeExts = options?.includeExtensions;
  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...extraPatterns];

  // Get all tracked files from git
  const raw = git("ls-files", projectRoot);

  if (!raw) {
    return [];
  }

  const filePaths = raw.split("\n").filter((line) => line.length > 0);

  // Filter and collect metadata
  const entries: RepoMapEntry[] = [];

  for (const relativePath of filePaths) {
    // Skip ignored paths
    if (shouldIgnore(relativePath, ignorePatterns)) {
      continue;
    }

    // Filter by extension if requested
    if (includeExts) {
      const ext = extname(relativePath).toLowerCase();
      if (!includeExts.includes(ext)) {
        continue;
      }
    }

    // Resolve to absolute path for stat
    const absolutePath = join(projectRoot, relativePath.split("/").join(sep));

    let size = 0;
    let lastModified = new Date(0).toISOString();

    try {
      const stat = statSync(absolutePath);
      size = stat.size;
      lastModified = stat.mtime.toISOString();
    } catch {
      // File might have been deleted after being listed by git;
      // include it with zero size and epoch timestamp
    }

    const language = detectLanguage(relativePath);

    entries.push({
      path: relativePath,
      size,
      language,
      lastModified,
    });
  }

  // Sort by modification time, most recent first
  entries.sort((a, b) => {
    const timeA = new Date(a.lastModified).getTime();
    const timeB = new Date(b.lastModified).getTime();
    return timeB - timeA;
  });

  // Limit to maxFiles
  return entries.slice(0, maxFiles);
}

/**
 * Format an array of RepoMapEntry objects into a markdown string suitable for
 * injection into an LLM context window.
 *
 * The output is a fenced markdown table with columns:
 *   File | Language | Size | Last Modified
 *
 * @param entries - The repo map entries to format.
 * @returns A markdown-formatted string.
 */
export function formatRepoMapForContext(entries: RepoMapEntry[]): string {
  if (entries.length === 0) {
    return "*(No tracked files found)*";
  }

  const lines: string[] = [];

  lines.push("## Repository Map");
  lines.push("");
  lines.push(`**${entries.length} files** (sorted by last modified)`);
  lines.push("");

  // Build a tree-style listing grouped by directory
  const dirGroups = new Map<string, RepoMapEntry[]>();

  for (const entry of entries) {
    const parts = entry.path.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    const existing = dirGroups.get(dir);
    if (existing) {
      existing.push(entry);
    } else {
      dirGroups.set(dir, [entry]);
    }
  }

  // Format as a tree with directory headers
  for (const [dir, files] of dirGroups) {
    lines.push(`### \`${dir}/\``);
    lines.push("");

    for (const file of files) {
      const fileName = file.path.split("/").pop() ?? file.path;
      const sizeStr = formatSize(file.size);
      const dateStr = formatDate(file.lastModified);
      lines.push(`- \`${fileName}\` — ${file.language} (${sizeStr}, ${dateStr})`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a byte count into a human-readable size string.
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format an ISO date string into a short relative/absolute representation.
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  // Fall back to a short date format
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
