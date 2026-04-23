// packages/core/src/inline-edit-scorer.ts
// Inline Edit Scorer — edit distance + presentation format selection for dim 6.
//
// Closes the gap vs Cursor/Copilot which intelligently choose between:
//   • Whole-line ghost text (small diffs)
//   • Inline strikethrough + addition (medium diffs)
//   • Unified diff in chat panel (large structural changes)
//
// Also provides word-by-word partial accept logic (Alt+→ equivalent).
// Pattern: Aider's edit quality scorer + Copilot partial accept.

// ─── Edit Distance ────────────────────────────────────────────────────────────

/**
 * Character-level Levenshtein distance (capped at maxDist to keep O(n*m) tractable).
 * Returns the edit distance, or maxDist+1 if exceeded.
 */
export function levenshtein(a: string, b: string, maxDist = 2000): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Short-circuit if difference in length already exceeds maxDist
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

  // Use two-row DP to keep memory O(n)
  const n = a.length;
  const m = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);

  for (let j = 1; j <= m; j++) {
    curr[0] = j;
    for (let i = 1; i <= n; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(prev[i]! + 1, curr[i - 1]! + 1, prev[i - 1]! + cost);
    }
    if (Math.min(...curr) > maxDist) return maxDist + 1;
    [prev, curr] = [curr, prev];
  }

  return prev[n]!;
}

/**
 * Normalized edit similarity: 1.0 = identical, 0.0 = completely different.
 * Uses character-level Levenshtein relative to max(len(a), len(b)).
 */
export function editSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshtein(a, b, maxLen);
  return Math.max(0, 1 - dist / maxLen);
}

// ─── Edit Size Classifier ─────────────────────────────────────────────────────

export type EditSize = "trivial" | "small" | "medium" | "large";

/**
 * Classify how big an edit is — used to pick the right UX presentation.
 *
 * | Size    | Similarity | Char diff | UX hint |
 * |---------|-----------|-----------|---------|
 * | trivial | ≥ 0.95    | ≤ 20      | ghost text overlay |
 * | small   | ≥ 0.70    | ≤ 200     | inline strikethrough |
 * | medium  | ≥ 0.30    | ≤ 1000    | unified diff block |
 * | large   | < 0.30    | > 1000    | side-by-side panel |
 */
export function classifyEditSize(before: string, after: string): EditSize {
  const sim = editSimilarity(before, after);
  const charDiff = Math.abs(before.length - after.length) + levenshtein(before, after, 2001);

  if (sim >= 0.95 && charDiff <= 20) return "trivial";
  if (sim >= 0.70 && charDiff <= 200) return "small";
  if (sim >= 0.30 && charDiff <= 1000) return "medium";
  return "large";
}

// ─── Presentation Selector ────────────────────────────────────────────────────

export type EditPresentation = "ghost-text" | "inline-diff" | "unified-diff" | "side-by-side";

/**
 * Choose the best UI presentation given edit size and available width.
 *
 * - ghost-text: show completion inline with ghost text (trivial edits only)
 * - inline-diff: ~~removed~~ `added` inline annotation (small edits)
 * - unified-diff: `+`/`-` diff block in chat (medium edits)
 * - side-by-side: two-pane diff panel (large edits or wide terminals)
 */
export function selectEditPresentation(
  before: string,
  after: string,
  opts: { terminalWidth?: number; isMultiLine?: boolean } = {},
): EditPresentation {
  const { terminalWidth = 80, isMultiLine = before.includes("\n") || after.includes("\n") } = opts;
  const size = classifyEditSize(before, after);

  if (size === "trivial" && !isMultiLine) return "ghost-text";
  if (size === "small" && !isMultiLine) return "inline-diff";
  if (size === "large" && terminalWidth >= 140) return "side-by-side";
  return "unified-diff";
}

// ─── Inline Diff Formatter ────────────────────────────────────────────────────

/**
 * Format a small single-line edit as `~~removed~~ +added` for display in
 * terminal chat or VSCode decorations.
 */
export function formatInlineDiff(before: string, after: string, noColor = false): string {
  const DIM_STR = noColor ? "" : "\x1b[2m\x1b[9m"; // dim + strikethrough
  const RED_STR = noColor ? "" : "\x1b[31m";
  const GREEN_STR = noColor ? "" : "\x1b[32m";
  const RESET_STR = noColor ? "" : "\x1b[0m";

  if (before === after) return before;
  if (before === "") return `${GREEN_STR}+${after}${RESET_STR}`;
  if (after === "") return `${RED_STR}~~${before}~~${RESET_STR}`;
  return `${DIM_STR}${RED_STR}${before}${RESET_STR} ${GREEN_STR}${after}${RESET_STR}`;
}

// ─── Edit Quality Scorer ──────────────────────────────────────────────────────

export interface EditQualityResult {
  /** 0.0–1.0 quality score */
  score: number;
  /** Why the score was given */
  reason: string;
  /** Whether the edit appears intentional (not regressive) */
  isProgressive: boolean;
}

/**
 * Score the quality of an edit relative to a stated goal.
 * Heuristics only — no model call. Used to rank multiple candidate completions.
 *
 * Scoring factors:
 * - Edit is non-empty (+0.3 base)
 * - After is longer than before (adds content) (+0.1)
 * - Goal keywords appear in the after content (+0.3)
 * - No TODO/FIXME/placeholder introduced (+0.1)
 * - Syntactic completeness (closes opened brackets) (+0.2)
 */
export function scoreEditQuality(before: string, after: string, goal: string): EditQualityResult {
  if (after.trim() === "" && before.trim() !== "") {
    return { score: 0, reason: "after content is empty (deletion)", isProgressive: false };
  }
  if (after === before) {
    return { score: 0.5, reason: "no change", isProgressive: false };
  }

  let score = 0.3; // base for non-trivial edit
  const reasons: string[] = ["non-trivial edit"];

  // Content growth
  if (after.length > before.length) {
    score += 0.1;
    reasons.push("adds content");
  }

  // Goal keyword overlap
  const goalKeywords = goal.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const afterLower = after.toLowerCase();
  const matchedKeywords = goalKeywords.filter((kw) => afterLower.includes(kw));
  if (matchedKeywords.length > 0) {
    score += Math.min(0.3, 0.1 * matchedKeywords.length);
    reasons.push(`goal keywords: ${matchedKeywords.slice(0, 3).join(", ")}`);
  }

  // No placeholders
  if (!/\b(TODO|FIXME|XXX|HACK|PLACEHOLDER|your code here)\b/i.test(after)) {
    score += 0.1;
    reasons.push("no placeholders");
  }

  // Bracket balance
  const balance = (s: string, open: string, close: string) =>
    (s.split(open).length - 1) - (s.split(close).length - 1);
  const addedText = after.slice(before.length);
  const braceBalance = balance(addedText, "{", "}");
  const parenBalance = balance(addedText, "(", ")");
  const bracketBalance = balance(addedText, "[", "]");
  if (braceBalance === 0 && parenBalance === 0 && bracketBalance === 0) {
    score += 0.2;
    reasons.push("balanced brackets");
  } else if (braceBalance < 0 || parenBalance < 0 || bracketBalance < 0) {
    score -= 0.1;
    reasons.push("unbalanced brackets");
  }

  score = Math.max(0, Math.min(1, score));
  return {
    score,
    reason: reasons.join("; "),
    isProgressive: score >= 0.5,
  };
}

// ─── Partial Accept Controller ────────────────────────────────────────────────

export interface PartialAcceptResult {
  /** Text that was accepted (to insert at cursor) */
  accepted: string;
  /** Remaining ghost text after acceptance */
  remaining: string;
}

/**
 * Word-by-word and line-by-line partial acceptance for ghost text completions.
 * Mirrors Copilot's Alt+→ (accept next word) and Alt+↓ (accept next line).
 *
 * Word boundary follows VSCode's definition:
 *   - Transition between identifier char [a-zA-Z0-9_] and non-identifier
 *   - Whitespace clusters
 *   - Punctuation clusters
 */
export class PartialAcceptController {
  /**
   * Accept the next "word" from the completion text.
   * A "word" is the next sequence of identifier chars, or the next run of non-identifier chars.
   */
  acceptNextWord(completionText: string): PartialAcceptResult {
    if (completionText === "") return { accepted: "", remaining: "" };

    const IDENT = /^[a-zA-Z0-9_]+/;
    const SPACE = /^\s+/;
    const PUNCT = /^[^a-zA-Z0-9_\s]+/;

    let wordEnd = 0;
    const firstChar = completionText[0]!;

    if (/[a-zA-Z0-9_]/.test(firstChar)) {
      // Identifier word — include trailing whitespace
      const identMatch = IDENT.exec(completionText);
      wordEnd = identMatch ? identMatch[0].length : 1;
      const spaceMatch = SPACE.exec(completionText.slice(wordEnd));
      if (spaceMatch) wordEnd += spaceMatch[0].length;
    } else if (/\s/.test(firstChar)) {
      // Whitespace — accept up to next non-space
      const spaceMatch = SPACE.exec(completionText);
      wordEnd = spaceMatch ? spaceMatch[0].length : 1;
    } else {
      // Punctuation cluster
      const punctMatch = PUNCT.exec(completionText);
      wordEnd = punctMatch ? punctMatch[0].length : 1;
    }

    return {
      accepted: completionText.slice(0, wordEnd),
      remaining: completionText.slice(wordEnd),
    };
  }

  /**
   * Accept the next line from the completion text.
   * The accepted text includes the trailing newline (or all text if no newline).
   */
  acceptNextLine(completionText: string): PartialAcceptResult {
    if (completionText === "") return { accepted: "", remaining: "" };
    const nlIdx = completionText.indexOf("\n");
    if (nlIdx === -1) {
      return { accepted: completionText, remaining: "" };
    }
    return {
      accepted: completionText.slice(0, nlIdx + 1),
      remaining: completionText.slice(nlIdx + 1),
    };
  }

  /**
   * Accept all remaining ghost text.
   */
  acceptAll(completionText: string): PartialAcceptResult {
    return { accepted: completionText, remaining: "" };
  }

  /**
   * Dismiss (reject) all ghost text.
   */
  dismiss(): PartialAcceptResult {
    return { accepted: "", remaining: "" };
  }
}

/** Singleton instance for use in extension commands. */
export const globalPartialAcceptController = new PartialAcceptController();
