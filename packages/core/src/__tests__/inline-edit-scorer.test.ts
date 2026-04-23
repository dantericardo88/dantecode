// packages/core/src/__tests__/inline-edit-scorer.test.ts
import { describe, it, expect } from "vitest";
import {
  levenshtein,
  editSimilarity,
  classifyEditSize,
  selectEditPresentation,
  formatInlineDiff,
  scoreEditQuality,
  PartialAcceptController,
  globalPartialAcceptController,
} from "../inline-edit-scorer.js";

// ─── levenshtein ──────────────────────────────────────────────────────────────

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
  });

  it("returns length of b when a is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
  });

  it("returns length of a when b is empty", () => {
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("returns 1 for single char substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("returns 1 for single insertion", () => {
    expect(levenshtein("abc", "abcd")).toBe(1);
  });

  it("returns 1 for single deletion", () => {
    expect(levenshtein("abcd", "abc")).toBe(1);
  });

  it("returns maxDist+1 when distance exceeds maxDist", () => {
    expect(levenshtein("aaaa", "bbbb", 2)).toBe(3); // maxDist+1
  });

  it("computes kitten/sitting = 3", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

// ─── editSimilarity ───────────────────────────────────────────────────────────

describe("editSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(editSimilarity("abc", "abc")).toBe(1.0);
  });

  it("returns 1.0 for two empty strings", () => {
    expect(editSimilarity("", "")).toBe(1.0);
  });

  it("returns 0 for completely different strings of same length", () => {
    const sim = editSimilarity("aaa", "bbb");
    expect(sim).toBe(0); // distance=3, maxLen=3 → 1-1=0
  });

  it("returns value between 0 and 1 for partial match", () => {
    const sim = editSimilarity("hello world", "hello there");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("is symmetric", () => {
    const a = editSimilarity("foo bar", "foo baz");
    const b = editSimilarity("foo baz", "foo bar");
    expect(a).toBe(b);
  });
});

// ─── classifyEditSize ─────────────────────────────────────────────────────────

describe("classifyEditSize", () => {
  it("classifies identical strings as trivial", () => {
    expect(classifyEditSize("hello", "hello")).toBe("trivial");
  });

  it("classifies single char change as trivial", () => {
    // 1-char change in 25-char string: sim = 1-1/25 = 0.96 >= 0.95
    expect(classifyEditSize("const x = computeValue();", "const x = computeValue()!")).toBe("trivial");
  });

  it("classifies small word change as small", () => {
    const before = "const result = computeOldValue(x);";
    const after = "const result = computeNewValue(x);";
    const size = classifyEditSize(before, after);
    expect(["trivial", "small"]).toContain(size);
  });

  it("classifies multi-line block rewrite as large", () => {
    const before = "a".repeat(2000);
    const after = "b".repeat(2000);
    expect(classifyEditSize(before, after)).toBe("large");
  });

  it("classifies medium change correctly", () => {
    const before = "function foo() { return 1; }";
    const after = "function foo(x: number) { return x * 2; }";
    const size = classifyEditSize(before, after);
    expect(["small", "medium"]).toContain(size);
  });
});

// ─── selectEditPresentation ───────────────────────────────────────────────────

describe("selectEditPresentation", () => {
  it("returns ghost-text for trivial single-line edits", () => {
    // 1-char change in 25-char string: similarity ~0.96 >= 0.95 threshold
    const before = "const x = computeValue();";
    const after = "const x = computeValue()!";
    expect(selectEditPresentation(before, after)).toBe("ghost-text");
  });

  it("returns inline-diff for small single-line edits", () => {
    const before = "const x = computeOldValue();";
    const after = "const x = computeNewValue();";
    const pres = selectEditPresentation(before, after);
    expect(["ghost-text", "inline-diff"]).toContain(pres);
  });

  it("returns unified-diff for multi-line edits", () => {
    const before = "line1\nold line\nline3";
    const after = "line1\nnew line here with more text\nline3";
    const pres = selectEditPresentation(before, after);
    expect(["unified-diff", "side-by-side"]).toContain(pres);
  });

  it("returns side-by-side for large edits on wide terminal", () => {
    const before = "a".repeat(500) + "AAAA" + "a".repeat(500);
    const after = "b".repeat(500) + "BBBB" + "b".repeat(500);
    const pres = selectEditPresentation(before, after, { terminalWidth: 160 });
    expect(pres).toBe("side-by-side");
  });

  it("returns unified-diff for large edits on narrow terminal", () => {
    const before = "a".repeat(500) + "AAAA" + "a".repeat(500);
    const after = "b".repeat(500) + "BBBB" + "b".repeat(500);
    const pres = selectEditPresentation(before, after, { terminalWidth: 80 });
    expect(pres).toBe("unified-diff");
  });
});

// ─── formatInlineDiff ─────────────────────────────────────────────────────────

describe("formatInlineDiff", () => {
  it("returns original for identical strings", () => {
    expect(formatInlineDiff("same", "same", true)).toBe("same");
  });

  it("shows + prefix for pure addition (empty before)", () => {
    const out = formatInlineDiff("", "new content", true);
    expect(out).toContain("+new content");
  });

  it("shows ~~ prefix for pure deletion (empty after)", () => {
    const out = formatInlineDiff("old content", "", true);
    expect(out).toContain("~~old content~~");
  });

  it("shows both old and new for replacement", () => {
    const out = formatInlineDiff("old", "new", true);
    expect(out).toContain("old");
    expect(out).toContain("new");
  });

  it("includes ANSI codes when noColor=false", () => {
    const out = formatInlineDiff("old", "new", false);
    expect(out).toContain("\x1b[");
  });
});

// ─── scoreEditQuality ─────────────────────────────────────────────────────────

describe("scoreEditQuality", () => {
  it("returns score 0 when after is empty and before is not", () => {
    const result = scoreEditQuality("some code", "", "add feature");
    expect(result.score).toBe(0);
    expect(result.isProgressive).toBe(false);
  });

  it("returns score 0.5 when before === after (no change)", () => {
    const result = scoreEditQuality("unchanged", "unchanged", "goal");
    expect(result.score).toBe(0.5);
    expect(result.isProgressive).toBe(false);
  });

  it("rewards goal keyword matches", () => {
    const result = scoreEditQuality(
      "function foo() {}",
      "function foo() { return authenticate(user); }",
      "add authenticate function for user login",
    );
    expect(result.score).toBeGreaterThan(0.3);
    // At least one keyword from goal should appear in reason
    expect(result.reason).toMatch(/authenticate|user|login/);
  });

  it("penalizes TODO/placeholder introductions", () => {
    const withPlaceholder = scoreEditQuality("function foo() {}", "function foo() { // TODO: implement this\n}", "add feature");
    const withCode = scoreEditQuality("function foo() {}", "function foo() { return 42; }", "add feature");
    expect(withCode.score).toBeGreaterThan(withPlaceholder.score);
  });

  it("rewards balanced brackets", () => {
    const balanced = scoreEditQuality("", "function foo() { return 1; }", "implement foo");
    const unbalanced = scoreEditQuality("", "function foo() { return 1;", "implement foo");
    expect(balanced.score).toBeGreaterThan(unbalanced.score);
  });

  it("isProgressive is true for high quality edits", () => {
    const result = scoreEditQuality(
      "export function add(a: number) { return a; }",
      "export function add(a: number, b: number) { return a + b; }",
      "add b parameter to the add function",
    );
    expect(result.isProgressive).toBe(true);
  });

  it("score is clamped between 0 and 1", () => {
    const r1 = scoreEditQuality("x", "y", "do something");
    const r2 = scoreEditQuality("", "", "do something");
    expect(r1.score).toBeGreaterThanOrEqual(0);
    expect(r1.score).toBeLessThanOrEqual(1);
    expect(r2.score).toBeGreaterThanOrEqual(0);
    expect(r2.score).toBeLessThanOrEqual(1);
  });
});

// ─── PartialAcceptController ──────────────────────────────────────────────────

describe("PartialAcceptController — acceptNextWord", () => {
  const ctrl = new PartialAcceptController();

  it("returns empty for empty completion", () => {
    const r = ctrl.acceptNextWord("");
    expect(r.accepted).toBe("");
    expect(r.remaining).toBe("");
  });

  it("accepts identifier word + trailing space", () => {
    const r = ctrl.acceptNextWord("hello world");
    expect(r.accepted).toBe("hello ");
    expect(r.remaining).toBe("world");
  });

  it("accepts punctuation cluster", () => {
    const r = ctrl.acceptNextWord("() => {");
    expect(r.accepted).toBe("()");
    expect(r.remaining).toBe(" => {");
  });

  it("accepts whitespace cluster", () => {
    const r = ctrl.acceptNextWord("   foo");
    expect(r.accepted).toBe("   ");
    expect(r.remaining).toBe("foo");
  });

  it("accepts identifier with underscores and numbers", () => {
    const r = ctrl.acceptNextWord("my_var123 = 42");
    expect(r.accepted).toBe("my_var123 ");
    expect(r.remaining).toBe("= 42");
  });

  it("repeated calls advance through completion", () => {
    let text = "const x = 1;";
    let accepted = "";
    let safeLimit = 20;
    while (text !== "" && safeLimit-- > 0) {
      const r = ctrl.acceptNextWord(text);
      accepted += r.accepted;
      text = r.remaining;
    }
    expect(accepted).toBe("const x = 1;");
  });
});

describe("PartialAcceptController — acceptNextLine", () => {
  const ctrl = new PartialAcceptController();

  it("returns entire text when no newline", () => {
    const r = ctrl.acceptNextLine("single line");
    expect(r.accepted).toBe("single line");
    expect(r.remaining).toBe("");
  });

  it("accepts up to and including first newline", () => {
    const r = ctrl.acceptNextLine("first line\nsecond line");
    expect(r.accepted).toBe("first line\n");
    expect(r.remaining).toBe("second line");
  });

  it("returns empty for empty input", () => {
    const r = ctrl.acceptNextLine("");
    expect(r.accepted).toBe("");
    expect(r.remaining).toBe("");
  });
});

describe("PartialAcceptController — acceptAll / dismiss", () => {
  const ctrl = new PartialAcceptController();

  it("acceptAll returns everything with empty remaining", () => {
    const r = ctrl.acceptAll("full completion text");
    expect(r.accepted).toBe("full completion text");
    expect(r.remaining).toBe("");
  });

  it("dismiss returns empty accepted and empty remaining", () => {
    const r = ctrl.dismiss();
    expect(r.accepted).toBe("");
    expect(r.remaining).toBe("");
  });
});

describe("globalPartialAcceptController", () => {
  it("is an instance of PartialAcceptController", () => {
    expect(globalPartialAcceptController).toBeInstanceOf(PartialAcceptController);
  });
});
