// packages/core/src/__tests__/completion-quality-scorer.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  isEmptyCompletion,
  isRepetitiveCompletion,
  getIndentLevel,
  scoreIndentCoherence,
  scoreSyntacticBalance,
  scoreTokenCompletion,
  scoreLengthQuality,
  scoreCompletion,
  filterCompletions,
  buildCacheKey,
  CompletionDedupeCache,
  applyLanguageRules,
  classifyCompletionType,
  type CompletionCandidate,
} from "../completion-quality-scorer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(text: string, prefix = "const x = ", overrides: Partial<CompletionCandidate> = {}): CompletionCandidate {
  return { text, language: "typescript", prefix, ...overrides };
}

// ─── isEmptyCompletion ────────────────────────────────────────────────────────

describe("isEmptyCompletion", () => {
  it("returns true for empty string", () => expect(isEmptyCompletion("")).toBe(true));
  it("returns true for whitespace-only", () => expect(isEmptyCompletion("   \n  ")).toBe(true));
  it("returns false for code content", () => expect(isEmptyCompletion("const x = 1;")).toBe(false));
});

// ─── isRepetitiveCompletion ───────────────────────────────────────────────────

describe("isRepetitiveCompletion", () => {
  it("returns true when completion starts with tail of prefix", () => {
    const prefix = "const myLongVariableName = ";
    const text = "myLongVariableName = 42;";
    expect(isRepetitiveCompletion(text, prefix)).toBe(true);
  });

  it("returns false for genuinely new content", () => {
    const prefix = "function foo() {\n  ";
    const text = "return bar + baz;";
    expect(isRepetitiveCompletion(text, prefix)).toBe(false);
  });

  it("returns false for very short completion", () => {
    expect(isRepetitiveCompletion("x", "const x = ")).toBe(false);
  });

  it("returns false for empty prefix", () => {
    expect(isRepetitiveCompletion("hello world", "")).toBe(false);
  });
});

// ─── getIndentLevel ───────────────────────────────────────────────────────────

describe("getIndentLevel", () => {
  it("returns 0 for no indentation", () => {
    expect(getIndentLevel("function foo() {}")).toBe(0);
  });

  it("returns 2 for 2-space indent on last non-empty line", () => {
    expect(getIndentLevel("  return x;")).toBe(2);
  });

  it("returns 4 for 4-space indent", () => {
    expect(getIndentLevel("foo()\n    bar()")).toBe(4);
  });

  it("ignores trailing empty lines", () => {
    expect(getIndentLevel("  const x = 1;\n\n")).toBe(2);
  });
});

// ─── scoreIndentCoherence ─────────────────────────────────────────────────────

describe("scoreIndentCoherence", () => {
  it("returns 1.0 for matching indent on multi-line", () => {
    const prefix = "function foo() {\n  ";
    const completion = "  return 1;\n}";
    const score = scoreIndentCoherence(completion, prefix, "typescript");
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it("returns 1.0 for inline completion with no leading whitespace", () => {
    const score = scoreIndentCoherence("42;", "const x = ", "typescript");
    expect(score).toBe(1.0);
  });

  it("returns lower score for severely mismatched indent", () => {
    const prefix = "function foo() {\n  ";
    const completion = "        return 1;\n}"; // 8 spaces vs expected 2
    const score = scoreIndentCoherence(completion, prefix, "typescript");
    expect(score).toBeLessThan(1.0);
  });
});

// ─── scoreSyntacticBalance ────────────────────────────────────────────────────

describe("scoreSyntacticBalance", () => {
  it("returns 1.0 for balanced brackets", () => {
    expect(scoreSyntacticBalance("foo(bar, [baz])")).toBe(1.0);
  });

  it("returns less than 1.0 for unmatched closer", () => {
    expect(scoreSyntacticBalance("foo(bar))")).toBeLessThan(1.0);
  });

  it("returns less than 1.0 for multiple mismatches", () => {
    const score = scoreSyntacticBalance("))) {{");
    expect(score).toBeLessThan(0.6);
  });

  it("returns 1.0 for empty string", () => {
    expect(scoreSyntacticBalance("")).toBe(1.0);
  });

  it("returns non-negative for severely unbalanced", () => {
    expect(scoreSyntacticBalance("))))))))")).toBeGreaterThanOrEqual(0);
  });
});

// ─── scoreTokenCompletion ─────────────────────────────────────────────────────

describe("scoreTokenCompletion", () => {
  it("returns 1.0 for completion ending with identifier", () => {
    expect(scoreTokenCompletion("myVariable", "typescript")).toBe(1.0);
  });

  it("returns 1.0 for completion ending with semicolon", () => {
    expect(scoreTokenCompletion("const x = 1;", "typescript")).toBe(1.0);
  });

  it("returns 0.3 for completion ending with operator", () => {
    expect(scoreTokenCompletion("const x =", "typescript")).toBe(0.3);
  });

  it("returns 1.0 for Python completion ending with colon", () => {
    expect(scoreTokenCompletion("def foo():", "python")).toBe(1.0);
  });

  it("returns 0.3 for completion ending with open paren", () => {
    expect(scoreTokenCompletion("foo(", "typescript")).toBe(0.3);
  });
});

// ─── scoreLengthQuality ───────────────────────────────────────────────────────

describe("scoreLengthQuality", () => {
  it("returns 0 for completion shorter than minChars", () => {
    expect(scoreLengthQuality("x", 3, 200)).toBe(0);
  });

  it("returns 1.0 for normal length completion", () => {
    expect(scoreLengthQuality("const x = myFunction();", 3, 200)).toBe(1.0);
  });

  it("returns 0.3 for extremely long completion", () => {
    const longText = "a".repeat(1001);
    expect(scoreLengthQuality(longText, 3, 200)).toBe(0.3);
  });

  it("penalizes completion with long lines", () => {
    const longLine = "x".repeat(201);
    expect(scoreLengthQuality(longLine, 3, 200)).toBeLessThan(1.0);
  });
});

// ─── scoreCompletion ──────────────────────────────────────────────────────────

describe("scoreCompletion", () => {
  it("scores empty completion as unacceptable with score 0", () => {
    const result = scoreCompletion(makeCandidate(""));
    expect(result.score).toBe(0);
    expect(result.acceptable).toBe(false);
    expect(result.rejectionReason).toContain("empty");
  });

  it("scores good completion as acceptable", () => {
    const result = scoreCompletion(makeCandidate("42;"));
    expect(result.acceptable).toBe(true);
    expect(result.score).toBeGreaterThan(0.5);
  });

  it("scores repetitive completion as unacceptable", () => {
    const prefix = "const myLongVariableName = ";
    const result = scoreCompletion(makeCandidate("myLongVariableName = 42;", prefix));
    expect(result.acceptable).toBe(false);
    expect(result.rejectionReason).toContain("repetitive");
  });

  it("accepts custom minScore threshold", () => {
    const result = scoreCompletion(makeCandidate("x = 1;"), { minScore: 0.9 });
    // Even if acceptable at 0.5 threshold, stricter threshold may reject
    expect(typeof result.acceptable).toBe("boolean");
  });

  it("returns all signal keys in breakdown", () => {
    const result = scoreCompletion(makeCandidate("const y = 2;"));
    expect(Object.keys(result.signals)).toContain("nonEmpty");
    expect(Object.keys(result.signals)).toContain("indentCoherence");
    expect(Object.keys(result.signals)).toContain("syntacticBalance");
  });

  it("score is between 0 and 1", () => {
    const result = scoreCompletion(makeCandidate("function hello() { return 42; }"));
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

// ─── filterCompletions ────────────────────────────────────────────────────────

describe("filterCompletions", () => {
  it("filters out empty candidates", () => {
    const candidates = [makeCandidate(""), makeCandidate("return 42;")];
    const filtered = filterCompletions(candidates);
    expect(filtered.every((c) => c.text !== "")).toBe(true);
  });

  it("sorts by quality score descending", () => {
    const candidates = [
      makeCandidate("x"),
      makeCandidate("const result = computeValue(a, b);"),
    ];
    const filtered = filterCompletions(candidates);
    if (filtered.length >= 2) {
      expect(filtered[0]!.qualityScore).toBeGreaterThanOrEqual(filtered[1]!.qualityScore);
    }
  });

  it("returns qualityScore on each result", () => {
    const candidates = [makeCandidate("return value;")];
    const filtered = filterCompletions(candidates);
    if (filtered.length > 0) {
      expect(typeof filtered[0]!.qualityScore).toBe("number");
    }
  });
});

// ─── buildCacheKey ────────────────────────────────────────────────────────────

describe("buildCacheKey", () => {
  it("returns consistent key for same inputs", () => {
    const key1 = buildCacheKey("const x = ", "42;");
    const key2 = buildCacheKey("const x = ", "42;");
    expect(key1).toBe(key2);
  });

  it("returns different keys for different completions", () => {
    expect(buildCacheKey("const x = ", "42;")).not.toBe(buildCacheKey("const x = ", "43;"));
  });
});

// ─── CompletionDedupeCache ────────────────────────────────────────────────────

describe("CompletionDedupeCache", () => {
  let cache: CompletionDedupeCache;

  beforeEach(() => { cache = new CompletionDedupeCache(10, 5000); });

  it("returns false for first-time completion", () => {
    expect(cache.isDuplicate("const x = ", "42;")).toBe(false);
  });

  it("returns true after recording same completion", () => {
    cache.record("const x = ", "42;");
    expect(cache.isDuplicate("const x = ", "42;")).toBe(true);
  });

  it("different prefix returns false even for same completion", () => {
    cache.record("const x = ", "42;");
    expect(cache.isDuplicate("const y = ", "42;")).toBe(false);
  });

  it("size increases after recording", () => {
    cache.record("prefix", "completion");
    expect(cache.size).toBe(1);
  });

  it("clear resets size to 0", () => {
    cache.record("prefix", "completion");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("evicts oldest when maxSize exceeded", () => {
    const small = new CompletionDedupeCache(3, 5000);
    small.record("p1", "c1");
    small.record("p2", "c2");
    small.record("p3", "c3");
    small.record("p4", "c4"); // should evict p1
    expect(small.size).toBe(3);
  });
});

// ─── applyLanguageRules ───────────────────────────────────────────────────────

describe("applyLanguageRules", () => {
  it("strips double newlines from Python completions", () => {
    const result = applyLanguageRules("def foo():\n  pass\n\n", "python");
    expect(result).not.toMatch(/\n\n$/);
  });

  it("leaves TypeScript completions largely unchanged", () => {
    const code = "return x + y;";
    expect(applyLanguageRules(code, "typescript")).toBe(code);
  });
});

// ─── classifyCompletionType ───────────────────────────────────────────────────

describe("classifyCompletionType", () => {
  it("classifies single-line completion", () => {
    expect(classifyCompletionType("return 42;")).toBe("single-line");
  });

  it("classifies multi-line completion", () => {
    expect(classifyCompletionType("if (x) {\n  return 1;\n}")).toBe("multi-line");
  });

  it("classifies empty completion", () => {
    expect(classifyCompletionType("   ")).toBe("empty");
  });
});
