// ============================================================================
// @dantecode/cli — Tool Call Parser
// Extracts tool calls from model response text (XML <tool_use> blocks and
// JSON code blocks). Extracted from agent-loop.ts for maintainability.
// ============================================================================

import { randomUUID } from "node:crypto";

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
export function adaptiveJaccardThreshold(highCount: number, medCount: number, lowCount: number): number {
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

export function parseToolCallPayload(
  payload: string,
): { name?: string; input?: Record<string, unknown>; dependsOn?: string[] } | null {
  try {
    return JSON.parse(payload) as {
      name?: string;
      input?: Record<string, unknown>;
      dependsOn?: string[];
    };
  } catch {
    try {
      return JSON.parse(escapeLiteralControlCharsInJsonStrings(payload)) as {
        name?: string;
        input?: Record<string, unknown>;
        dependsOn?: string[];
      };
    } catch {
      return null;
    }
  }
}

/**
 * Extracts tool calls from the model response text.
 * Looks for patterns like:
 *   <tool_use>
 *   {"name": "Read", "input": {"file_path": "..."}}
 *   </tool_use>
 *
 * Also handles JSON code blocks that look like tool calls.
 */
export function extractToolCalls(text: string): {
  cleanText: string;
  toolCalls: ExtractedToolCall[];
  parseErrors: string[]; // raw content of malformed <tool_use> blocks
} {
  const toolCalls: ExtractedToolCall[] = [];
  const parseErrors: string[] = [];
  let cleanText = text;

  // Pattern 1: XML-style tool use blocks
  const xmlPattern = /<tool_use>\s*([\s\S]*?)\s*<\/tool_use>/g;
  let match: RegExpExecArray | null;

  while ((match = xmlPattern.exec(text)) !== null) {
    const parsed = parseToolCallPayload(match[1]!);
    if (parsed?.name && parsed.input) {
      toolCalls.push({
        id: randomUUID(),
        name: parsed.name,
        input: parsed.input,
        dependsOn: Array.isArray(parsed.dependsOn)
          ? parsed.dependsOn.filter((value): value is string => typeof value === "string")
          : undefined,
      });
    } else {
      // Capture malformed blocks so the execution loop can report them to the model
      parseErrors.push(match[1]!.slice(0, 300).trim());
    }
    cleanText = cleanText.replace(match[0], "");
  }

  // Pattern 2: JSON blocks with tool call structure
  const jsonBlockPattern =
    /```(?:json)?\s*\n(\{[\s\S]*?"name"\s*:\s*"(?:Read|Write|Edit|Bash|Glob|Grep|GitCommit|GitPush|TodoWrite|WebSearch|WebFetch|SubAgent|GitHubSearch|AcquireUrl|AcquireArchive|GitHubOps)"[\s\S]*?\})\s*\n```/g;

  while ((match = jsonBlockPattern.exec(text)) !== null) {
    const parsed = parseToolCallPayload(match[1]!);
    if (parsed?.name && parsed.input) {
      toolCalls.push({
        id: randomUUID(),
        name: parsed.name,
        input: parsed.input,
        dependsOn: Array.isArray(parsed.dependsOn)
          ? parsed.dependsOn.filter((value): value is string => typeof value === "string")
          : undefined,
      });
      cleanText = cleanText.replace(match[0], "");
    }
  }

  return { cleanText: cleanText.trim(), toolCalls, parseErrors };
}
