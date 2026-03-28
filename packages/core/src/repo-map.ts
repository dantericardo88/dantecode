// ============================================================================
// @dantecode/core - Unified Repository Map API
// Combines AST-based and PageRank-based repo mapping with caching
// ============================================================================

import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { RepoMapTreeSitter } from "./repo-map-tree-sitter.js";
import {
  buildPageRankRepoMap,
  getRelevantContext,
  type RepoMapContext,
  type PageRankRepoMapOptions,
} from "./repo-map-pagerank.js";
import { buildRepoMap, formatRepoMap, type RankedFile } from "./repo-map-ast.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnifiedRepoMapOptions {
  /** Project root directory */
  projectRoot: string;
  /** Files to include in the map */
  files: string[];
  /** Files currently in chat/context */
  chatFiles?: string[];
  /** Mentioned file names to boost */
  mentionedFiles?: string[];
  /** Mentioned identifiers to boost */
  mentionedIdents?: string[];
  /** Max tokens for output */
  maxTokens?: number;
  /** Strategy: "pagerank" (default) or "ast" */
  strategy?: "pagerank" | "ast";
  /** Enable caching (default: true) */
  useCache?: boolean;
  /** Cache directory (default: .dantecode/repo-map-cache) */
  cacheDir?: string;
}

export interface RepoMapCache {
  version: string;
  timestamp: number;
  files: string[];
  map: string;
}

const CACHE_VERSION = "1.0.0";
const DEFAULT_CACHE_DIR = ".dantecode/repo-map-cache";

// ---------------------------------------------------------------------------
// Unified API
// ---------------------------------------------------------------------------

/**
 * Build a repository map using the specified strategy.
 * Automatically uses tree-sitter for supported languages with regex fallback.
 */
export async function buildUnifiedRepoMap(options: UnifiedRepoMapOptions): Promise<string> {
  const {
    projectRoot,
    files,
    chatFiles = [],
    mentionedFiles = [],
    mentionedIdents = [],
    maxTokens = 2000,
    strategy = "pagerank",
    useCache = true,
    cacheDir = DEFAULT_CACHE_DIR,
  } = options;

  // Check cache
  if (useCache) {
    const cached = await loadFromCache(projectRoot, files, cacheDir);
    if (cached) {
      return cached;
    }
  }

  const treeSitter = new RepoMapTreeSitter();

  let result: string;

  if (strategy === "pagerank") {
    const context: RepoMapContext = {
      projectRoot,
      files,
      treeSitter,
    };

    const pageRankOptions: PageRankRepoMapOptions = {
      chatFiles,
      mentionedFiles,
      mentionedIdents,
      maxTokens,
    };

    result = await buildPageRankRepoMap(context, pageRankOptions);
  } else {
    // AST strategy (simpler, faster, but less accurate)
    const ranked = await buildRepoMap(projectRoot, {
      maxTokenBudget: maxTokens,
      useTreeSitter: true,
    });

    result = formatRepoMap(ranked, maxTokens);
  }

  // Save to cache
  if (useCache) {
    await saveToCache(projectRoot, files, result, cacheDir);
  }

  return result;
}

/**
 * Get relevant context for a specific query.
 * Uses PageRank with query-based personalization.
 */
export async function getRepoMapForQuery(
  projectRoot: string,
  files: string[],
  query: string,
  options: Omit<UnifiedRepoMapOptions, "projectRoot" | "files" | "mentionedIdents"> = {},
): Promise<string> {
  const treeSitter = new RepoMapTreeSitter();

  const context: RepoMapContext = {
    projectRoot,
    files,
    treeSitter,
  };

  return getRelevantContext(context, query, {
    chatFiles: options.chatFiles,
    mentionedFiles: options.mentionedFiles,
    maxTokens: options.maxTokens ?? 2000,
  });
}

/**
 * Invalidate the repo map cache for a project.
 */
export async function invalidateRepoMapCache(
  projectRoot: string,
  cacheDir = DEFAULT_CACHE_DIR,
): Promise<void> {
  const cachePath = join(projectRoot, cacheDir);
  if (existsSync(cachePath)) {
    const { rm } = await import("node:fs/promises");
    await rm(cachePath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Cache Management
// ---------------------------------------------------------------------------

async function loadFromCache(
  projectRoot: string,
  files: string[],
  cacheDir: string,
): Promise<string | null> {
  const cacheKey = computeCacheKey(files);
  const cachePath = join(projectRoot, cacheDir, `${cacheKey}.json`);

  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const content = await readFile(cachePath, "utf-8");
    const cached: RepoMapCache = JSON.parse(content);

    // Validate cache
    if (cached.version !== CACHE_VERSION) {
      return null;
    }

    // Check if files have changed
    if (JSON.stringify(cached.files.sort()) !== JSON.stringify(files.sort())) {
      return null;
    }

    // Check cache age (invalidate after 1 hour)
    const age = Date.now() - cached.timestamp;
    if (age > 60 * 60 * 1000) {
      return null;
    }

    return cached.map;
  } catch {
    return null;
  }
}

async function saveToCache(
  projectRoot: string,
  files: string[],
  map: string,
  cacheDir: string,
): Promise<void> {
  const cacheKey = computeCacheKey(files);
  const cachePath = join(projectRoot, cacheDir, `${cacheKey}.json`);

  try {
    await mkdir(join(projectRoot, cacheDir), { recursive: true });

    const cache: RepoMapCache = {
      version: CACHE_VERSION,
      timestamp: Date.now(),
      files: files.sort(),
      map,
    };

    await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Ignore cache write errors
  }
}

function computeCacheKey(files: string[]): string {
  // Simple hash of sorted file list
  const sorted = files.slice().sort();
  const str = sorted.join("|");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { RepoMapTreeSitter } from "./repo-map-tree-sitter.js";
export { buildRepoMap, formatRepoMap, type RankedFile } from "./repo-map-ast.js";
export {
  buildPageRankRepoMap,
  getRelevantContext,
  computeSymbolRanks,
  formatRepoMapContext,
  extractTags,
  type RepoMapContext,
  type PageRankRepoMapOptions,
  type SymbolTag,
  type SymbolRank,
} from "./repo-map-pagerank.js";
