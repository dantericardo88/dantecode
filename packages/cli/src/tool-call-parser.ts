// ============================================================================
// @dantecode/cli — Tool Call Parser
// Extracts tool calls from model response text (XML <tool_use> blocks and
// JSON code blocks). Extracted from agent-loop.ts for maintainability.
// ============================================================================

import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { repairMalformedJsonPayload } from "./provider-normalization.js";

/**
 * Represents a tool call extracted from the model's response text.
 * When the model outputs structured tool_use blocks, this is how we capture them.
 * Since we are using generateText (not structured tool calling), we parse
 * tool calls from a simple XML-like format in the model's response.
 */
export interface ExtractedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  dependsOn?: string[];
}

export function escapeLiteralControlCharsInJsonStrings(payload: string): string {
  let result = "";
  let inString = false;
  let escaping = false;

  for (const char of payload) {
    if (escaping) {
      result += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      result += char;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (char === "\n") {
        result += "\\n";
        continue;
      }
      if (char === "\r") {
        result += "\\r";
        continue;
      }
      if (char === "\t") {
        result += "\\t";
        continue;
      }
    }

    result += char;
  }

  return result;
}

/**
 * Multiset Jaccard word-overlap [0–1]. ES2022-safe — no findLastIndex, Array.at, etc.
 * Uses frequency maps (Map<string, number>) instead of sets, so repeated words count.
 * Intersection = Σ min(countA[w], countB[w]); Union = Σ max(countA[w], countB[w]).
 * This prevents a rewrite from gaming the check by padding with repeated critique keywords.
 */
export function jaccardWordOverlap(a: string, b: string): number {
  const tokenize = (s: string): Map<string, number> => {
    const words = s.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    return freq;
  };
  const freqA = tokenize(a);
  const freqB = tokenize(b);
  const allWords = new Set<string>([...freqA.keys(), ...freqB.keys()]);
  if (allWords.size === 0) return 1;
  let intersection = 0;
  let union = 0;
  for (const w of allWords) {
    const cA = freqA.get(w) ?? 0;
    const cB = freqB.get(w) ?? 0;
    intersection += Math.min(cA, cB);
    union += Math.max(cA, cB);
  }
  return union === 0 ? 1 : intersection / union;
}

/**
 * Derives an adaptive Jaccard similarity threshold from critique severity.
 * More severe critiques → lower threshold → more divergence required from the original.
 * Range: [0.72, 0.93].
 *   0 high, 0 med, 0 low → 0.93  (minor critique — small word-set change is sufficient)
 *   3 high, 0 med, 0 low → 0.80
 *   5+ high              → 0.72  (clamped minimum)
 *   0 high, 0 med, 5 low → 0.88  (all-low-severity: still tighter than default)
 */
export function adaptiveJaccardThreshold(
  highCount: number,
  medCount: number,
  lowCount: number,
): number {
  const raw = 0.95 - highCount * 0.05 - medCount * 0.02 - lowCount * 0.01;
  return Math.min(0.93, Math.max(0.72, raw));
}

/**
 * Bigram coverage check: for each critique point description, extract all consecutive
 * 2-word phrases (bigrams). A point is "covered" if any bigram appears verbatim in
 * the rewrite. Falls back to unigrams for single-word descriptions.
 * Returns { covered, total }.
 *
 * This is harder to game than single-word checks: the model must produce
 * the specific phrase "authentication validation" — not just the word "authentication".
 */
export function checkBigramCoverage(
  descriptions: string[],
  rewrite: string,
): { covered: number; total: number } {
  const rewriteLower = rewrite.toLowerCase();
  let covered = 0;
  for (const desc of descriptions) {
    const words = desc.toLowerCase().match(/[a-z]{3,}/g) ?? [];
    const bigrams: string[] = [];
    for (let i = 0; i < words.length - 1; i++) {
      bigrams.push(`${words[i]} ${words[i + 1]}`);
    }
    const checks = bigrams.length > 0 ? bigrams : words;
    if (checks.some((b) => rewriteLower.includes(b))) covered++;
  }
  return { covered, total: descriptions.length };
}

/**
 * Result type for tool call payload parsing.
 * Enhanced with diagnostic error information for better model feedback.
 */
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; context: string };

function normalizeJsonPayloadCandidates(payload: string): string[] {
  const trimmed = payload.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = new Set<string>([trimmed, withoutFence]);

  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.add(withoutFence.slice(firstBrace, lastBrace + 1).trim());
  }

  return [...candidates].filter((candidate) => candidate.length > 0);
}

function parseJsonRecord<T extends Record<string, unknown>>(payload: string): ParseResult<T> {
  const candidates = normalizeJsonPayloadCandidates(payload);
  let lastError = "Unknown JSON parse error";
  let lastContext = payload.slice(0, 200);

  for (const candidate of candidates) {
    try {
      return { success: true, data: JSON.parse(candidate) as T };
    } catch {
      try {
        const escaped = escapeLiteralControlCharsInJsonStrings(candidate);
        return { success: true, data: JSON.parse(escaped) as T };
      } catch (error) {
        // Fallback: try specialized provider-normalization for malformed payloads
        const repaired = repairMalformedJsonPayload(candidate);
        if (repaired) {
          try {
            return { success: true, data: JSON.parse(repaired) as T };
          } catch {
            // Drop through to lastError tracking
          }
        }
        
        lastError = error instanceof Error ? error.message : String(error);
        lastContext = candidate.slice(0, 200);
      }
    }
  }

  return { success: false, error: lastError, context: lastContext };
}

export function parseToolCallPayload(
  payload: string,
): ParseResult<{ name?: string; input?: Record<string, unknown>; dependsOn?: string[] }> {
  return parseJsonRecord<{
    name?: string;
    input?: Record<string, unknown>;
    dependsOn?: string[];
  }>(payload);
}

export function parseToolCallInputPayload(payload: string): ParseResult<Record<string, unknown>> {
  return parseJsonRecord<Record<string, unknown>>(payload);
}

/**
 * Diagnostic error information for failed tool call parses.
 */
export interface ToolCallParseError {
  rawPayload: string; // First 300 chars
  error: string; // JSON parse error message
  context: string; // Additional context for debugging
}

/**
 * Extracts tool calls from the model response text.
 * Looks for patterns like:
 *   <tool_use>
 *   {"name": "Read", "input": {"file_path": "..."}}
 *   </tool_use>
 *
 * Also handles JSON code blocks that look like tool calls.
 *
 * Enhanced with diagnostic error reporting for better model feedback.
 */
export function extractToolCalls(text: string): {
  cleanText: string;
  toolCalls: ExtractedToolCall[];
  parseErrors: ToolCallParseError[]; // Detailed diagnostic info for malformed blocks
} {
  const toolCalls: ExtractedToolCall[] = [];
  const parseErrors: ToolCallParseError[] = [];
  let cleanText = text;

  // Pattern 1: XML-style tool use blocks
  const xmlPattern = /<tool_use>\s*([\s\S]*?)\s*<\/tool_use>/g;
  let match: RegExpExecArray | null;

  while ((match = xmlPattern.exec(text)) !== null) {
    const parsed = parseToolCallPayload(match[1]!);
    if (parsed.success && parsed.data.name && parsed.data.input) {
      toolCalls.push({
        id: randomUUID(),
        name: parsed.data.name,
        input: parsed.data.input,
        dependsOn: Array.isArray(parsed.data.dependsOn)
          ? parsed.data.dependsOn.filter((value): value is string => typeof value === "string")
          : undefined,
      });
    } else if (!parsed.success) {
      // Capture detailed diagnostic info
      parseErrors.push({
        rawPayload: match[1]!.slice(0, 300).trim(),
        error: parsed.error,
        context: parsed.context,
      });
    }
    cleanText = cleanText.replace(match[0], "");
  }

  // Pattern 2: JSON blocks with tool call structure
  const jsonBlockPattern =
    /```(?:json)?\s*\n(\{[\s\S]*?"name"\s*:\s*"(?:Read|Write|Edit|Bash|Glob|Grep|GitCommit|GitPush|TodoWrite|WebSearch|WebFetch|SubAgent|GitHubSearch|AcquireUrl|AcquireArchive|GitHubOps)"[\s\S]*?\})\s*\n```/g;

  while ((match = jsonBlockPattern.exec(text)) !== null) {
    const parsed = parseToolCallPayload(match[1]!);
    if (parsed.success && parsed.data.name && parsed.data.input) {
      toolCalls.push({
        id: randomUUID(),
        name: parsed.data.name,
        input: parsed.data.input,
        dependsOn: Array.isArray(parsed.data.dependsOn)
          ? parsed.data.dependsOn.filter((value): value is string => typeof value === "string")
          : undefined,
      });
      cleanText = cleanText.replace(match[0], "");
    } else if (!parsed.success) {
      parseErrors.push({
        rawPayload: match[1]!.slice(0, 300).trim(),
        error: parsed.error,
        context: parsed.context,
      });
    }
  }

  return { cleanText: cleanText.trim(), toolCalls, parseErrors };
}

// ============================================================================
// Feature 2 — SEARCH/REPLACE Edit Block Parser (Aider editblock_coder pattern)
// ============================================================================

export interface EditBlock {
  filePath: string;
  searchContent: string;
  replaceContent: string;
}

/**
 * Extracts Aider-style SEARCH/REPLACE blocks from model response text.
 *
 * Expected format:
 *   path/to/file.py
 *   <<<<<<< SEARCH
 *   [exact content to find]
 *   =======
 *   [replacement content]
 *   >>>>>>> REPLACE
 *
 * Multiple blocks per response are supported.
 */
export function extractEditBlocks(text: string): EditBlock[] {
  const blocks: EditBlock[] = [];

  // Match the full block including the optional language fence wrapper.
  // Delimiters: <<<<<<< SEARCH … ======= … >>>>>>> REPLACE
  const blockPattern =
    /^[ \t]*(?:```[^\n]*)?\n?(.*?)\n[ \t]*<{7} SEARCH\r?\n([\s\S]*?)\n[ \t]*={7}\r?\n([\s\S]*?)\n[ \t]*>{7} REPLACE[ \t]*(?:\n```)?/gm;

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(text)) !== null) {
    const rawPath = match[1]?.trim() ?? "";
    const searchContent = match[2] ?? "";
    const replaceContent = match[3] ?? "";

    // Strip any code fence prefix from the file-path line (e.g. "```python")
    const filePath = rawPath.replace(/^```[a-z]*\s*/i, "").trim();
    if (!filePath) continue;

    blocks.push({ filePath, searchContent, replaceContent });
  }

  return blocks;
}

// ─── Line-level similarity (difflib-style, no external deps) ─────────────────

/**
 * Returns a similarity ratio [0, 1] between two strings.
 * Uses character-level longest common subsequence length heuristic.
 * Fast enough for O(n*m) where n, m are line counts of typical source files.
 */
function lineSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length < b.length ? a : b;
  if (longer.length === 0) return 1;
  const distance = editDistance(shorter, longer);
  return (longer.length - distance) / longer.length;
}

function editDistance(s: string, t: string): number {
  const m = s.length;
  const n = t.length;
  // Use O(n) space DP
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? n) + 1,
        (curr[j - 1] ?? m) + 1,
        (prev[j - 1] ?? n) + cost,
      );
    }
    prev = curr;
  }
  return prev[n] ?? n;
}

/**
 * Fuzzy-matches `searchLines` in `fileLines` using line-level similarity.
 * Returns the best-matching start index and a confidence score [0, 1].
 * Returns `{ startIndex: -1, score: 0 }` when no reasonable match exists.
 */
function findBestMatchingChunk(
  fileLines: string[],
  searchLines: string[],
): { startIndex: number; score: number } {
  if (searchLines.length === 0) return { startIndex: 0, score: 1 };
  if (fileLines.length < searchLines.length) return { startIndex: -1, score: 0 };

  let bestStart = -1;
  let bestScore = 0;

  for (let i = 0; i <= fileLines.length - searchLines.length; i++) {
    let totalSim = 0;
    for (let j = 0; j < searchLines.length; j++) {
      totalSim += lineSimilarity(fileLines[i + j] ?? "", searchLines[j] ?? "");
    }
    const score = totalSim / searchLines.length;
    if (score > bestScore) {
      bestScore = score;
      bestStart = i;
    }
  }

  const FUZZY_THRESHOLD = 0.75;
  if (bestScore < FUZZY_THRESHOLD) return { startIndex: -1, score: bestScore };
  return { startIndex: bestStart, score: bestScore };
}

export interface ApplyEditBlockResult {
  success: boolean;
  error?: string;
  /** 'exact' | 'fuzzy' | 'create' — which matching strategy was used. */
  strategy?: "exact" | "fuzzy" | "create";
}

/**
 * Applies a SEARCH/REPLACE edit block to a file.
 *
 * Strategy:
 *  1. Exact string match — fastest, most correct.
 *  2. Fuzzy line-similarity match — when exact fails.
 *  3. If searchContent is empty, append replaceContent.
 *
 * @param filePath      Relative path from projectRoot (or absolute).
 * @param searchContent The text to search for.
 * @param replaceContent The text to replace it with.
 * @param projectRoot   Root directory used to resolve relative paths.
 */
export async function applyEditBlock(
  filePath: string,
  searchContent: string,
  replaceContent: string,
  projectRoot: string,
): Promise<ApplyEditBlockResult> {
  const absPath = resolve(projectRoot, filePath);

  let original: string;
  try {
    original = await readFile(absPath, "utf8");
  } catch (err) {
    // File doesn't exist — create it if searchContent is empty
    if (searchContent.trim() === "") {
      try {
        await writeFile(absPath, replaceContent, "utf8");
        return { success: true, strategy: "create" };
      } catch (writeErr) {
        return {
          success: false,
          error: `Cannot create file "${filePath}": ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
        };
      }
    }
    return {
      success: false,
      error: `Cannot read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 1. Exact match
  if (searchContent.trim() === "") {
    // Empty search → append
    try {
      await writeFile(absPath, original + replaceContent, "utf8");
      return { success: true, strategy: "exact" };
    } catch (writeErr) {
      return {
        success: false,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      };
    }
  }

  if (original.includes(searchContent)) {
    const updated = original.replace(searchContent, replaceContent);
    try {
      await writeFile(absPath, updated, "utf8");
      return { success: true, strategy: "exact" };
    } catch (writeErr) {
      return {
        success: false,
        error: writeErr instanceof Error ? writeErr.message : String(writeErr),
      };
    }
  }

  // 2. Fuzzy line match
  const fileLines = original.split("\n");
  const searchLines = searchContent.split("\n");
  const { startIndex, score } = findBestMatchingChunk(fileLines, searchLines);

  if (startIndex === -1) {
    return {
      success: false,
      error: `Search content not found in "${filePath}" (best fuzzy score: ${score.toFixed(2)})`,
    };
  }

  const replaceLines = replaceContent.split("\n");
  const updatedLines = [
    ...fileLines.slice(0, startIndex),
    ...replaceLines,
    ...fileLines.slice(startIndex + searchLines.length),
  ];

  try {
    await writeFile(absPath, updatedLines.join("\n"), "utf8");
    return { success: true, strategy: "fuzzy" };
  } catch (writeErr) {
    return {
      success: false,
      error: writeErr instanceof Error ? writeErr.message : String(writeErr),
    };
  }
}

// ============================================================================
// Feature 3 — Implied File Writes from Code Blocks (Bolt.DIY pattern)
// ============================================================================

export interface ImpliedFileWrite {
  filePath: string;
  content: string;
  language: string;
}

/**
 * Extracts implied file writes from code blocks that carry filename hints but
 * are NOT wrapped in `<tool_use>` blocks.
 *
 * Recognised hint patterns (Pattern 4):
 *  a) `filename.ext:` on the line immediately before a fenced code block
 *  b) `// path/to/file.ts`  as the first comment inside a code block
 *  c) `# path/to/file.py`   as the first comment inside a code block
 *  d) block-comment header  path/to/file.js  as the first comment inside a code block
 *
 * Only code blocks that do NOT appear inside `<tool_use>...</tool_use>` tags
 * are considered (those are already handled by extractToolCalls).
 */
export function extractImpliedFileWrites(text: string): ImpliedFileWrite[] {
  // Strip tool_use blocks so we don't double-process them
  const stripped = text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, "");

  const writes: ImpliedFileWrite[] = [];

  // Pattern matching a fenced code block with optional language tag
  // Capture group 1: language, group 2: body
  const fencePattern = /```([a-zA-Z0-9_\-]*)\r?\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = fencePattern.exec(stripped)) !== null) {
    const language = match[1] ?? "";
    const body = match[2] ?? "";
    const blockStart = match.index;

    // Find the line immediately before this code block
    const before = stripped.slice(0, blockStart);
    const precedingLines = before.split("\n");
    // last non-empty line before the fence
    let precedingLine = "";
    for (let i = precedingLines.length - 1; i >= 0; i--) {
      const line = precedingLines[i]?.trim() ?? "";
      if (line.length > 0) {
        precedingLine = line;
        break;
      }
    }

    // --- Hint (a): "filename.ext:" on the line before the block ---
    const filePathHintPattern =
      /^([\w./@\-]+\.[a-zA-Z0-9]{1,10}):?$/;
    const hintA = filePathHintPattern.exec(precedingLine);
    if (hintA) {
      writes.push({ filePath: hintA[1]!, content: body, language });
      continue;
    }

    // --- Hints (b/c/d): path comment on the FIRST non-blank line of the body ---
    const bodyLines = body.split("\n");
    let firstLine = "";
    for (const line of bodyLines) {
      if (line.trim().length > 0) {
        firstLine = line.trim();
        break;
      }
    }

    // (b) // path/to/file.ts
    const hintB = /^\/\/\s+([\w./@\-][^\s]*)$/.exec(firstLine);
    if (hintB) {
      // Remove the comment line from content
      const content = body.replace(firstLine, "").replace(/^\r?\n/, "");
      writes.push({ filePath: hintB[1]!, content, language });
      continue;
    }

    // (c) # path/to/file.py
    const hintC = /^#\s+([\w./@\-][^\s]*)$/.exec(firstLine);
    if (hintC) {
      const content = body.replace(firstLine, "").replace(/^\r?\n/, "");
      writes.push({ filePath: hintC[1]!, content, language });
      continue;
    }

    // (d) /* path/to/file.js */
    const hintD = /^\/\*\s+([\w./@\-][^\s]*)\s+\*\/$/.exec(firstLine);
    if (hintD) {
      const content = body.replace(firstLine, "").replace(/^\r?\n/, "");
      writes.push({ filePath: hintD[1]!, content, language });
      continue;
    }
  }

  return writes;
}
