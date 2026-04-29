// ============================================================================
// packages/cli/src/search-replace-parser.ts
//
// Standalone SEARCH/REPLACE block parser — Aider-derived edit format.
//
// Design:
//   - parseSearchReplaceBlocks: extracts all blocks from a model response
//   - applySearchReplaceBlock: applies one block to file content
//   - findNearestLines: diagnostic helper when no match is found
//   - Zero deps on agent-loop, slash-commands, or model-router
//   - Exact match first, trailing-whitespace fallback second, diagnostic third
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

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
  /**
   * Human-readable diagnostic when matched is false.
   * Contains the nearest similar lines from the file for debugging.
   */
  diagnostic?: string;
  /** True when the match succeeded only after stripping trailing whitespace. */
  usedFallback: boolean;
}

// ----------------------------------------------------------------------------
// Marker constants
// ----------------------------------------------------------------------------

const SEARCH_OPEN = "<<<<<<< SEARCH";
const SEPARATOR = "=======";
const REPLACE_CLOSE = ">>>>>>> REPLACE";

// Characters that identify a line as a block marker (never a file path)
const MARKER_PREFIXES = ["<<<<<<<", "=======", ">>>>>>>"];

function isMarkerLine(line: string): boolean {
  const t = line.trim();
  return MARKER_PREFIXES.some((p) => t.startsWith(p));
}

// ----------------------------------------------------------------------------
// parseSearchReplaceBlocks
// ----------------------------------------------------------------------------

/**
 * Parse all SEARCH/REPLACE blocks from a model response text.
 * Safe to call on any response — returns { blocks: [], prose: responseText }
 * when no blocks are found.
 */
/** Walk backward from `searchOpenLineIndex` looking for a file-path line.
 *  Skips empty lines + code fences; stops at any marker line. */
function findFilePathBefore(
  lines: string[],
  searchOpenLineIndex: number,
): { filePath: string; pathLineIndex: number } {
  for (let j = searchOpenLineIndex - 1; j >= 0; j--) {
    const candidate = (lines[j] ?? "").trimEnd();
    if (candidate === "") continue;
    if (isMarkerLine(candidate)) break;
    if (/^`{3,}/.test(candidate)) continue;
    let filePath = candidate.replace(/\\/g, "/");
    if (filePath.startsWith("./")) filePath = filePath.slice(2);
    return { filePath, pathLineIndex: j };
  }
  return { filePath: "", pathLineIndex: -1 };
}

/** Sum of `line.length + 1` for indices [0, i). */
function bytePosForLine(lines: string[], i: number): number {
  let offset = 0;
  for (let k = 0; k < i; k++) offset += (lines[k]?.length ?? 0) + 1;
  return offset;
}

/** Read body lines until a terminator; returns the lines and the index of
 *  the terminator (or lines.length if EOF was hit first). */
function readUntilMarker(lines: string[], start: number, terminator: string): { body: string[]; nextIdx: number } {
  const body: string[] = [];
  let i = start;
  while (i < lines.length && (lines[i] ?? "").trimEnd() !== terminator) {
    body.push(lines[i] ?? "");
    i++;
  }
  return { body, nextIdx: i };
}

interface BlockMatch {
  block: SearchReplaceBlock;
  consumedRange: [number, number];
}

/** Parse one block starting at the SEARCH_OPEN line at `i`. Returns null if
 *  the block is malformed. Also returns the index past the block's close. */
function parseOneBlock(lines: string[], searchOpenLineIndex: number): { match: BlockMatch | null; nextIdx: number } {
  const { filePath, pathLineIndex } = findFilePathBefore(lines, searchOpenLineIndex);
  if (!filePath) return { match: null, nextIdx: searchOpenLineIndex + 1 };

  const offset = bytePosForLine(lines, searchOpenLineIndex);

  const search = readUntilMarker(lines, searchOpenLineIndex + 1, SEPARATOR);
  if (search.nextIdx >= lines.length) return { match: null, nextIdx: lines.length };

  const replace = readUntilMarker(lines, search.nextIdx + 1, REPLACE_CLOSE);
  if (replace.nextIdx >= lines.length) return { match: null, nextIdx: lines.length };

  const block: SearchReplaceBlock = {
    filePath,
    searchContent: trimTrailingEmptyLine(search.body).join("\n"),
    replaceContent: trimTrailingEmptyLine(replace.body).join("\n"),
    sourceOffset: offset,
  };
  const blockStart = pathLineIndex >= 0 ? pathLineIndex : searchOpenLineIndex;
  return { match: { block, consumedRange: [blockStart, replace.nextIdx + 1] }, nextIdx: replace.nextIdx + 1 };
}

export function parseSearchReplaceBlocks(responseText: string): ParseSearchReplaceResult {
  const lines = responseText.split("\n");
  const blocks: SearchReplaceBlock[] = [];
  const consumedLineRanges: Array<[number, number]> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trimEnd() !== SEARCH_OPEN) { i++; continue; }
    const { match, nextIdx } = parseOneBlock(lines, i);
    if (match) {
      blocks.push(match.block);
      consumedLineRanges.push(match.consumedRange);
    }
    i = nextIdx;
  }

  const proseLines: string[] = [];
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const inBlock = consumedLineRanges.some(([s, e]) => lineIdx >= s && lineIdx < e);
    if (!inBlock) proseLines.push(lines[lineIdx] ?? "");
  }
  return { blocks, prose: proseLines.join("\n") };
}

function trimTrailingEmptyLine(lines: string[]): string[] {
  if (lines.length > 0 && (lines[lines.length - 1] ?? "").trim() === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

// ----------------------------------------------------------------------------
// applySearchReplaceBlock
// ----------------------------------------------------------------------------

/**
 * Apply a single SEARCH/REPLACE block to existing file content.
 *
 * Strategy:
 * 1. Exact match → replace → usedFallback: false
 * 2. Trailing-whitespace-stripped match → replace → usedFallback: true
 * 3. No match → return diagnostic with nearest similar lines
 *
 * Edge cases:
 * - Empty searchContent → prepend replaceContent (file create / insert at top)
 * - Empty replaceContent → delete the matched section
 */
export function applySearchReplaceBlock(
  fileContent: string,
  block: SearchReplaceBlock,
): ApplySearchReplaceResult {
  const { searchContent, replaceContent } = block;

  // Empty search = create / prepend
  if (searchContent.trim() === "") {
    const updated = replaceContent
      ? replaceContent + (fileContent ? "\n" + fileContent : "")
      : fileContent;
    return { matched: true, updatedContent: updated, usedFallback: false };
  }

  // Strategy 1: Exact match
  if (fileContent.includes(searchContent)) {
    const idx = fileContent.indexOf(searchContent);
    const updated =
      fileContent.slice(0, idx) + replaceContent + fileContent.slice(idx + searchContent.length);
    return { matched: true, updatedContent: updated, usedFallback: false };
  }

  // Strategy 2: Trailing-whitespace-stripped match
  const strippedSearch = stripTrailingWhitespace(searchContent);
  const strippedFile = stripTrailingWhitespace(fileContent);

  if (strippedFile.includes(strippedSearch)) {
    // Find the offset in the stripped file, then map back to original
    const strippedIdx = strippedFile.indexOf(strippedSearch);
    // Reconstruct: replace from strippedIdx in stripped version
    const updatedStripped =
      strippedFile.slice(0, strippedIdx) +
      replaceContent +
      strippedFile.slice(strippedIdx + strippedSearch.length);
    return { matched: true, updatedContent: updatedStripped, usedFallback: true };
  }

  // Strategy 3: No match — produce diagnostic
  const nearest = findNearestLines(fileContent, searchContent, 3);
  const diagnostic =
    nearest.length > 0
      ? `No exact match found. Nearest similar lines:\n${nearest.map((l) => `  | ${l}`).join("\n")}`
      : "No exact match found and no similar lines detected in this file.";

  return { matched: false, diagnostic, usedFallback: false };
}

function stripTrailingWhitespace(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n");
}

// ----------------------------------------------------------------------------
// findNearestLines
// ----------------------------------------------------------------------------

/**
 * Find up to `maxLines` lines from `fileContent` that are most similar
 * to any line in `searchContent`, ranked by character overlap ratio.
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

  // For each file line, compute its max similarity to any search line
  const scored: Array<{ line: string; score: number }> = fileLines.map((fileLine) => {
    const score = Math.max(
      ...searchLines.map((searchLine) => overlapRatio(fileLine.trim(), searchLine.trim())),
    );
    return { line: fileLine, score };
  });

  return scored
    .filter((s) => s.score > 0.3) // Only include meaningfully similar lines
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLines)
    .map((s) => s.line);
}

/**
 * Compute a simple character overlap ratio between two strings.
 * Returns a value in [0, 1]: 0 = no overlap, 1 = identical.
 */
function overlapRatio(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;

  // Count shared trigrams (3-char substrings)
  const trigramsA = new Set(trigrams(shorter));
  const trigramsB = new Set(trigrams(longer));
  let shared = 0;
  for (const t of trigramsA) {
    if (trigramsB.has(t)) shared++;
  }

  return shared / Math.max(trigramsA.size, trigramsB.size, 1);
}

function trigrams(s: string): string[] {
  const result: string[] = [];
  for (let i = 0; i <= s.length - 3; i++) {
    result.push(s.slice(i, i + 3));
  }
  return result;
}
