import { describe, it, expect } from "vitest";
import { FIMEngine } from "./fim-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngine(opts?: ConstructorParameters<typeof FIMEngine>[0]) {
  return new FIMEngine(opts);
}

const SAMPLE_PREFIX = Array.from({ length: 60 }, (_, i) => `line${i + 1}`).join("\n");
const SAMPLE_SUFFIX = Array.from({ length: 25 }, (_, i) => `sline${i + 1}`).join("\n");

// ---------------------------------------------------------------------------
// buildPrompt()
// ---------------------------------------------------------------------------

describe("FIMEngine.buildPrompt()", () => {
  it("1. returns a FIMPrompt for starcoder", () => {
    const engine = makeEngine();
    const ctx = { prefix: "const x = ", suffix: ";", cursorLine: 0, cursorCol: 10 };
    const result = engine.buildPrompt(ctx, "starcoder");

    expect(result.model).toBe("starcoder");
    expect(result.stopTokens).toBeDefined();
    expect(result.maxTokens).toBeGreaterThan(0);
    expect(typeof result.temperature).toBe("number");
    expect(typeof result.prompt).toBe("string");
  });

  it("2. uses starcoder FIM format tokens in prompt", () => {
    const engine = makeEngine();
    const ctx = { prefix: "const x = ", suffix: ";", cursorLine: 0, cursorCol: 10 };
    const result = engine.buildPrompt(ctx, "starcoder");

    expect(result.prompt).toContain("<fim_prefix>");
    expect(result.prompt).toContain("<fim_suffix>");
    expect(result.prompt).toContain("<fim_middle>");
  });

  it("3. returns a FIMPrompt for codellama", () => {
    const engine = makeEngine();
    const ctx = { prefix: "function foo() {", suffix: "}", cursorLine: 0, cursorCol: 16 };
    const result = engine.buildPrompt(ctx, "codellama");

    expect(result.model).toBe("codellama");
    expect(result.stopTokens).toContain("<PRE>");
  });

  it("4. uses codellama FIM format tokens in prompt", () => {
    const engine = makeEngine();
    const ctx = { prefix: "function foo() {", suffix: "}", cursorLine: 0, cursorCol: 16 };
    const result = engine.buildPrompt(ctx, "codellama");

    expect(result.prompt).toContain("<PRE>");
    expect(result.prompt).toContain("<SUF>");
    expect(result.prompt).toContain("<MID>");
  });

  it("5. defaults to generic model when no model specified", () => {
    const engine = makeEngine();
    const ctx = { prefix: "let a = ", suffix: ";", cursorLine: 0, cursorCol: 8 };
    const result = engine.buildPrompt(ctx);

    expect(result.model).toBe("generic");
    expect(result.prompt).toContain("[FILL]");
  });

  it("6. truncates prefix to prefixLines", () => {
    const engine = makeEngine({ prefixLines: 5 });
    const ctx = {
      prefix: SAMPLE_PREFIX, // 60 lines
      suffix: "end;",
      cursorLine: 60,
      cursorCol: 0,
    };
    const result = engine.buildPrompt(ctx, "generic");

    // Only last 5 lines of prefix should be present
    expect(result.prompt).toContain("line56");
    expect(result.prompt).toContain("line60");
    expect(result.prompt).not.toContain("line1\n");
  });

  it("7. truncates suffix to suffixLines", () => {
    const engine = makeEngine({ suffixLines: 5 });
    const ctx = {
      prefix: "start;",
      suffix: SAMPLE_SUFFIX, // 25 lines
      cursorLine: 0,
      cursorCol: 6,
    };
    const result = engine.buildPrompt(ctx, "generic");

    // Only first 5 lines of suffix should be present
    expect(result.prompt).toContain("sline1");
    expect(result.prompt).toContain("sline5");
    expect(result.prompt).not.toContain("sline25");
  });

  it("8. injects memory context into prompt", () => {
    const engine = makeEngine();
    const ctx = {
      prefix: "const x = ",
      suffix: ";",
      cursorLine: 0,
      cursorCol: 10,
      memoryContext: "Use the value 42 here",
    };
    const result = engine.buildPrompt(ctx, "starcoder");

    expect(result.prompt).toContain("Use the value 42 here");
  });

  it("24. deepseek-coder format uses correct delimiters", () => {
    const engine = makeEngine();
    const ctx = { prefix: "x = ", suffix: " + 1", cursorLine: 0, cursorCol: 4 };
    const result = engine.buildPrompt(ctx, "deepseek-coder");

    expect(result.prompt).toContain("<｜fim▁begin｜>");
    expect(result.prompt).toContain("<｜fim▁hole｜>");
    expect(result.prompt).toContain("<｜fim▁end｜>");
  });

  it("25. claude format uses system prompt as JSON", () => {
    const engine = makeEngine();
    const ctx = {
      prefix: "const result = ",
      suffix: ";",
      cursorLine: 0,
      cursorCol: 15,
      language: "typescript",
    };
    const result = engine.buildPrompt(ctx, "claude");

    // Claude format serialises to JSON with system + user keys
    const parsed = JSON.parse(result.prompt) as { system: string; user: string };
    expect(parsed).toHaveProperty("system");
    expect(parsed).toHaveProperty("user");
    expect(parsed.user).toContain("<cursor>");
  });
});

// ---------------------------------------------------------------------------
// postProcess()
// ---------------------------------------------------------------------------

describe("FIMEngine.postProcess()", () => {
  it("9. removes leading and trailing whitespace artefacts", () => {
    const engine = makeEngine();
    const ctx = { prefix: "const x = ", suffix: ";", cursorLine: 0, cursorCol: 10 };
    const result = engine.postProcess("   42   ", ctx);

    // trimEnd applied — trailing spaces removed
    expect(result).toBe("   42");
  });

  it("10. stops at double newline (single logical block)", () => {
    const engine = makeEngine();
    const ctx = { prefix: "x = ", suffix: ";", cursorLine: 0, cursorCol: 4 };
    const result = engine.postProcess("42\n\nconst extra = 1;", ctx);

    expect(result).toBe("42");
    expect(result).not.toContain("extra");
  });
});

// ---------------------------------------------------------------------------
// validateCompletion()
// ---------------------------------------------------------------------------

describe("FIMEngine.validateCompletion()", () => {
  it("11. returns true for a valid short completion", () => {
    const engine = makeEngine();
    const ctx = { prefix: "const x = ", suffix: ";", cursorLine: 0, cursorCol: 10 };
    expect(engine.validateCompletion("42", ctx)).toBe(true);
  });

  it("12. returns false for empty string", () => {
    const engine = makeEngine();
    const ctx = { prefix: "const x = ", suffix: ";", cursorLine: 0, cursorCol: 10 };
    expect(engine.validateCompletion("", ctx)).toBe(false);
  });

  it("13. returns false for whitespace-only string", () => {
    const engine = makeEngine();
    const ctx = { prefix: "const x = ", suffix: ";", cursorLine: 0, cursorCol: 10 };
    expect(engine.validateCompletion("   \t\n  ", ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildContext()
// ---------------------------------------------------------------------------

describe("FIMEngine.buildContext()", () => {
  it("14. splits code correctly at cursor offset", () => {
    const engine = makeEngine();
    const code = "const x = 42; const y = ";
    const offset = 13; // after "const x = 42;"
    const ctx = engine.buildContext("/src/app.ts", code, offset);

    expect(ctx.prefix).toBe("const x = 42;");
    expect(ctx.suffix).toBe(" const y = ");
  });

  it("15. sets cursorLine based on prefix newlines", () => {
    const engine = makeEngine();
    const code = "line1\nline2\nline3|line4";
    const offset = code.indexOf("|");
    const ctx = engine.buildContext("/src/app.ts", code, offset);

    // Cursor is on the third line (0-based index 2)
    expect(ctx.cursorLine).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// estimateConfidence()
// ---------------------------------------------------------------------------

describe("FIMEngine.estimateConfidence()", () => {
  it("16. returns 0 for empty completion", () => {
    const engine = makeEngine();
    const ctx = { prefix: "const x = ", suffix: ";", cursorLine: 0, cursorCol: 10 };
    expect(engine.estimateConfidence("", ctx)).toBe(0);
  });

  it("17. gives non-zero credit for a valid completion", () => {
    const engine = makeEngine();
    const ctx = {
      prefix: "const x = ",
      suffix: ";",
      cursorLine: 0,
      cursorCol: 10,
    };
    const score = engine.estimateConfidence("42", ctx);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// truncateToLines()
// ---------------------------------------------------------------------------

describe("FIMEngine.truncateToLines()", () => {
  it("18. takes last N lines when fromEnd=true", () => {
    const engine = makeEngine();
    const text = "a\nb\nc\nd\ne";
    const result = engine.truncateToLines(text, 3, true);

    expect(result).toBe("c\nd\ne");
  });

  it("19. takes first N lines when fromEnd=false", () => {
    const engine = makeEngine();
    const text = "a\nb\nc\nd\ne";
    const result = engine.truncateToLines(text, 3, false);

    expect(result).toBe("a\nb\nc");
  });
});

// ---------------------------------------------------------------------------
// detectLanguage()
// ---------------------------------------------------------------------------

describe("FIMEngine.detectLanguage()", () => {
  it("20. returns typescript for .ts file", () => {
    const engine = makeEngine();
    expect(engine.detectLanguage("/src/app.ts")).toBe("typescript");
  });

  it("21. returns python for .py file", () => {
    const engine = makeEngine();
    expect(engine.detectLanguage("/scripts/run.py")).toBe("python");
  });

  it("22. returns unknown for unrecognised extension", () => {
    const engine = makeEngine();
    expect(engine.detectLanguage("/file.zzz")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// getStopTokens()
// ---------------------------------------------------------------------------

describe("FIMEngine.getStopTokens()", () => {
  it("23. returns stop tokens for starcoder", () => {
    const engine = makeEngine();
    const tokens = engine.getStopTokens("starcoder");

    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens).toContain("<fim_prefix>");
    expect(tokens).toContain("<|endoftext|>");
  });
});
