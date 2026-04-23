// ============================================================================
// packages/core/src/diff-engine/search-replace-parser.ts
//
// Aider-derived SEARCH/REPLACE block parser — enhanced with 4-strategy fuzzy
// matching for VSCode extension use. Superset of packages/cli/src/search-replace-parser.ts.
//
// Match strategies (applied in order, first hit wins):
//   1. Exact string match
//   2. Trailing-whitespace normalization
//   3. Leading-whitespace normalization (per-line trimStart comparison)
//   4. Trigram Jaccard fuzzy block match (threshold: FUZZY_THRESHOLD)
// ============================================================================

// ── Types ───────────────────────────────────────────────────────────────────

/** Confidence level of the match that was applied. */
export type MatchQuality = "exact" | "trailing-ws" | "leading-ws" | "fuzzy" | "none";

/** One SEARCH/REPLACE block extracted from a model response. */
export interface SearchReplaceBlock {
  /** File path — the non-empty, non-marker line immediately before <<<<<<< SEARCH. */
  filePath: string;
  /** Content between <<<<<<< SEARCH and =======. Empty = insert at top / create file. */
  searchContent: string;
  /** Content between ======= and >>>>>>> REPLACE. Empty = delete the match. */
  replaceContent: string;
  /** 0-based character offset of the <<<<<<< SEARCH line in the original response text. */
  sourceOffset: number;
}

/** Result of parsing a full model response for SEARCH/REPLACE blocks. */
export interface ParseSearchReplaceResult {
  /** All blocks found in the response, in document order. */
  blocks: SearchReplaceBlock[];
  /** Response text with all block regions stripped — the remaining prose. */
  prose: string;
}

/** Result of applying a single SEARCH/REPLACE block to file content. */
export interface ApplySearchReplaceResult {
  /** True when the search string was found and the replacement was applied. */
  matched: boolean;
  /** Updated file content on success. Undefined when matched is false. */
  updatedContent?: string;
  /** Which strategy produced the match (or "none" on failure). */
  matchQuality: MatchQuality;
  /** Jaccard similarity score [0,1] — only set when matchQuality === "fuzzy". */
  similarity?: number;
  /** Human-readable diagnostic when matched is false. */
  diagnostic?: string;
  /** True when the match succeeded only after stripping whitespace or fuzzy. */
  usedFallback: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SEARCH_OPEN = "<<<<<<< SEARCH";
const SEPARATOR = "=======";
const REPLACE_CLOSE = ">>>>>>> REPLACE";

const MARKER_PREFIXES = ["<<<<<<<", "=======", ">>>>>>>"];

/** Minimum trigram Jaccard similarity to accept a fuzzy block match. */
export const FUZZY_THRESHOLD = 0.82;

// ── Helpers ──────────────────────────────────────────────────────────────────

function isMarkerLine(line: string): boolean {
  const t = line.trim();
  return MARKER_PREFIXES.some((p) => t.startsWith(p));
}

function trimTrailingEmptyLine(lines: string[]): string[] {
  if (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

function stripTrailingWs(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n");
}

function trigrams(s: string): string[] {
  const result: string[] = [];
  for (let i = 0; i <= s.length - 3; i++) {
    result.push(s.slice(i, i + 3));
  }
  return result;
}

function blockJaccard(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = new Set(trigrams(a));
  const tb = new Set(trigrams(b));
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  return intersection / Math.max(ta.size + tb.size - intersection, 1);
}

function overlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  const ta = new Set(trigrams(shorter));
  const tb = new Set(trigrams(longer));
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared++;
  }
  return shared / Math.max(ta.size, tb.size, 1);
}

// ── Strategy 3: Leading-whitespace normalization ──────────────────────────────

/**
 * Attempt to apply SEARCH/REPLACE by comparing each line after trimStart().
 * This handles the common case where the LLM shifts the indentation level of
 * the search block relative to the actual file content.
 */
function applyLeadingWsNormalized(
  fileContent: string,
  searchContent: string,
  replaceContent: string,
): string | null {
  const fileLines = fileContent.split("\n");
  const searchLines = searchContent.split("\n");
  const nSearch = searchLines.length;

  if (nSearch === 0 || fileLines.length < nSearch) return null;

  const normSearch = searchLines.map((l) => l.trimStart());

  for (let i = 0; i <= fileLines.length - nSearch; i++) {
    const window = fileLines.slice(i, i + nSearch);
    const normWindow = window.map((l) => l.trimStart());

    if (normWindow.join("\n") === normSearch.join("\n")) {
      const replaceLines = replaceContent.split("\n");
      const result = [
        ...fileLines.slice(0, i),
        ...replaceLines,
        ...fileLines.slice(i + nSearch),
      ];
      return result.join("\n");
    }
  }

  return null;
}

// ── Strategy 4: Trigram Jaccard fuzzy block match ────────────────────────────

/**
 * Slide a window of searchLines.length over fileLines, score each window by
 * trigram Jaccard similarity to searchContent. Accept the best window if its
 * score meets or exceeds the threshold.
 */
function applyFuzzyBlock(
  fileContent: string,
  searchContent: string,
  replaceContent: string,
  threshold: number,
): { updatedContent: string; similarity: number } | null {
  const fileLines = fileContent.split("\n");
  const searchLines = searchContent.split("\n");
  const nSearch = searchLines.length;

  if (nSearch === 0 || fileLines.length < nSearch) return null;

  let bestSim = 0;
  let bestStart = -1;

  for (let i = 0; i <= fileLines.length - nSearch; i++) {
    const window = fileLines.slice(i, i + nSearch).join("\n");
    const sim = blockJaccard(searchContent, window);
    if (sim > bestSim) {
      bestSim = sim;
      bestStart = i;
    }
  }

  if (bestSim < threshold || bestStart === -1) return null;

  const replaceLines = replaceContent.split("\n");
  const result = [
    ...fileLines.slice(0, bestStart),
    ...replaceLines,
    ...fileLines.slice(bestStart + nSearch),
  ];

  return { updatedContent: result.join("\n"), similarity: bestSim };
}

// ── parseSearchReplaceBlocks ─────────────────────────────────────────────────

/**
 * Parse all SEARCH/REPLACE blocks from a model response text.
 * Safe to call on any response — returns { blocks: [], prose: responseText }
 * when no blocks are found.
 */
export function parseSearchReplaceBlocks(responseText: string): ParseSearchReplaceResult {
  const lines = responseText.split("\n");
  const blocks: SearchReplaceBlock[] = [];
  const consumedLineRanges: Array<[number, number]> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trimEnd() === SEARCH_OPEN) {
      const searchOpenLineIndex = i;

      // Compute sourceOffset = byte position of this line in the full text
      let offset = 0;
      for (let k = 0; k < i; k++) {
        offset += (lines[k]?.length ?? 0) + 1; // +1 for the \n
      }

      // Find file path: walk backward skipping empty lines and code fences
      let filePath = "";
      let pathLineIndex = -1;
      for (let j = searchOpenLineIndex - 1; j >= 0; j--) {
        const candidate = (lines[j] ?? "").trimEnd();
        if (candidate === "") continue;
        if (isMarkerLine(candidate)) break;
        if (/^`{3,}/.test(candidate)) continue;
        filePath = candidate;
        pathLineIndex = j;
        break;
      }

      if (!filePath) {
        i++;
        continue; // No file path found — skip this block
      }

      // Normalize Windows backslashes to forward slashes; strip leading ./
      filePath = filePath.replace(/\\/g, "/");
      if (filePath.startsWith("./")) filePath = filePath.slice(2);

      // Collect searchContent lines until ======= or end of input
      i++; // Move past <<<<<<< SEARCH
      const searchLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trimEnd() !== SEPARATOR) {
        searchLines.push(lines[i] ?? "");
        i++;
      }

      if (i >= lines.length) break; // Malformed — no separator found

      i++; // Move past =======

      // Collect replaceContent lines until >>>>>>> REPLACE or end of input
      const replaceLines: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trimEnd() !== REPLACE_CLOSE) {
        replaceLines.push(lines[i] ?? "");
        i++;
      }

      if (i >= lines.length) break; // Malformed — no close marker found

      const replaceCloseLineIndex = i;
      i++; // Move past >>>>>>> REPLACE

      const searchContent = trimTrailingEmptyLine(searchLines).join("\n");
      const replaceContent = trimTrailingEmptyLine(replaceLines).join("\n");

      blocks.push({ filePath, searchContent, replaceContent, sourceOffset: offset });

      const blockStart = pathLineIndex >= 0 ? pathLineIndex : searchOpenLineIndex;
      consumedLineRanges.push([blockStart, replaceCloseLineIndex + 1]);

      continue;
    }

    i++;
  }

  // Build prose: everything outside consumed ranges
  const proseLines: string[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const inBlock = consumedLineRanges.some(([s, e]) => lineIdx >= s && lineIdx < e);
    if (!inBlock) proseLines.push(lines[lineIdx] ?? "");
  }
  const prose = proseLines.join("\n");

  return { blocks, prose };
}

// ── applySearchReplaceBlock ──────────────────────────────────────────────────

/**
 * Apply a single SEARCH/REPLACE block to existing file content using a
 * 4-strategy cascade (exact → trailing-ws → leading-ws → fuzzy).
 *
 * Edge cases:
 * - Empty searchContent → prepend replaceContent (file create / insert at top)
 * - Empty replaceContent → delete the matched section
 */
export function applySearchReplaceBlock(
  fileContent: string,
  block: SearchReplaceBlock,
  opts?: { fuzzyThreshold?: number },
): ApplySearchReplaceResult {
  const { searchContent, replaceContent } = block;
  const fuzzyThreshold = opts?.fuzzyThreshold ?? FUZZY_THRESHOLD;

  // Empty search = create / prepend
  if (searchContent.trim() === "") {
    const updated = replaceContent
      ? replaceContent + (fileContent ? "\n" + fileContent : "")
      : fileContent;
    return { matched: true, updatedContent: updated, matchQuality: "exact", usedFallback: false };
  }

  // Strategy 1: Exact match
  if (fileContent.includes(searchContent)) {
    const idx = fileContent.indexOf(searchContent);
    const updated =
      fileContent.slice(0, idx) + replaceContent + fileContent.slice(idx + searchContent.length);
    return { matched: true, updatedContent: updated, matchQuality: "exact", usedFallback: false };
  }

  // Strategy 2: Trailing-whitespace-stripped match
  const strippedSearch = stripTrailingWs(searchContent);
  const strippedFile = stripTrailingWs(fileContent);

  if (strippedFile.includes(strippedSearch)) {
    const strippedIdx = strippedFile.indexOf(strippedSearch);
    const updated =
      strippedFile.slice(0, strippedIdx) +
      replaceContent +
      strippedFile.slice(strippedIdx + strippedSearch.length);
    return {
      matched: true,
      updatedContent: updated,
      matchQuality: "trailing-ws",
      usedFallback: true,
    };
  }

  // Strategy 3: Leading-whitespace normalization (per-line trimStart)
  const leadingWsResult = applyLeadingWsNormalized(fileContent, searchContent, replaceContent);
  if (leadingWsResult !== null) {
    return {
      matched: true,
      updatedContent: leadingWsResult,
      matchQuality: "leading-ws",
      usedFallback: true,
    };
  }

  // Strategy 4: Trigram Jaccard fuzzy block match
  const fuzzyResult = applyFuzzyBlock(fileContent, searchContent, replaceContent, fuzzyThreshold);
  if (fuzzyResult !== null) {
    return {
      matched: true,
      updatedContent: fuzzyResult.updatedContent,
      matchQuality: "fuzzy",
      similarity: fuzzyResult.similarity,
      usedFallback: true,
    };
  }

  // No match — produce diagnostic
  const nearest = findNearestLines(fileContent, searchContent, 3);
  const diagnostic =
    nearest.length > 0
      ? `No exact match found. Nearest similar lines:\n${nearest.map((l) => `  | ${l}`).join("\n")}`
      : "No exact match found and no similar lines detected in this file.";

  return { matched: false, matchQuality: "none", diagnostic, usedFallback: false };
}

// ── findNearestLines ─────────────────────────────────────────────────────────

/**
 * Find up to `maxLines` lines from `fileContent` that are most similar
 * to any line in `searchContent`, ranked by trigram overlap ratio.
 * Used to produce helpful diagnostics when SEARCH does not match.
 */
export function findNearestLines(
  fileContent: string,
  searchContent: string,
  maxLines = 3,
): string[] {
  if (!fileContent || !searchContent) return [];

  const fileLines = fileContent.split("\n");
  const searchLines = searchContent.split("\n").filter((l) => l.trim().length > 0);

  if (searchLines.length === 0 || fileLines.length === 0) return [];

  const scored: Array<{ line: string; score: number }> = fileLines.map((fileLine) => {
    const score = Math.max(
      ...searchLines.map((searchLine) => overlapRatio(fileLine.trim(), searchLine.trim())),
    );
    return { line: fileLine, score };
  });

  return scored
    .filter((s) => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLines)
    .map((s) => s.line);
}
