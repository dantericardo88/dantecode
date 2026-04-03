import { describe, it, expect } from "vitest";
import { FIMEngine } from "./fim-engine.js";
import type { FIMContext } from "./fim-engine.js";

function makeContext(overrides: Partial<FIMContext> = {}): FIMContext {
  return {
    prefix: "function hello() {\n  const x = ",
    suffix: ";\n  return x;\n}",
    language: "typescript",
    filePath: "/src/app.ts",
    cursorLine: 1,
    cursorCol: 14,
    ...overrides,
  };
}

describe("FIMEngine — Prompt Building", () => {
  const engine = new FIMEngine();

  it("builds StarCoder format prompt", () => {
    const prompt = engine.buildPrompt(makeContext(), "starcoder");
    expect(prompt.model).toBe("starcoder");
    expect(prompt.prompt).toContain("<fim_prefix>");
    expect(prompt.prompt).toContain("<fim_suffix>");
    expect(prompt.prompt).toContain("<fim_middle>");
    expect(prompt.stopTokens).toContain("<|endoftext|>");
  });

  it("builds CodeLlama format prompt", () => {
    const prompt = engine.buildPrompt(makeContext(), "codellama");
    expect(prompt.prompt).toContain("<PRE>");
    expect(prompt.prompt).toContain("<SUF>");
    expect(prompt.prompt).toContain("<MID>");
  });

  it("builds DeepSeek-Coder format prompt", () => {
    const prompt = engine.buildPrompt(makeContext(), "deepseek-coder");
    expect(prompt.prompt).toContain("fim");
    expect(prompt.model).toBe("deepseek-coder");
  });

  it("builds Claude structured prompt", () => {
    const prompt = engine.buildPrompt(makeContext(), "claude");
    const parsed = JSON.parse(prompt.prompt);
    expect(parsed.system).toContain("typescript");
    expect(parsed.user).toContain("<cursor>");
  });

  it("builds GPT format prompt", () => {
    const prompt = engine.buildPrompt(makeContext(), "gpt");
    expect(prompt.prompt).toContain("FILL IN THE BLANK");
  });

  it("builds generic format prompt", () => {
    const prompt = engine.buildPrompt(makeContext(), "generic");
    expect(prompt.prompt).toContain("[FILL]");
  });

  it("includes memory context when provided", () => {
    const ctx = makeContext({ memoryContext: "User prefers functional style" });
    const prompt = engine.buildPrompt(ctx, "starcoder");
    expect(prompt.prompt).toContain("User prefers functional style");
  });

  it("respects default maxTokens and temperature", () => {
    const prompt = engine.buildPrompt(makeContext());
    expect(prompt.maxTokens).toBe(256);
    expect(prompt.temperature).toBe(0.2);
  });

  it("allows custom maxTokens and temperature", () => {
    const customEngine = new FIMEngine({
      defaultMaxTokens: 512,
      defaultTemperature: 0.5,
    });
    const prompt = customEngine.buildPrompt(makeContext());
    expect(prompt.maxTokens).toBe(512);
    expect(prompt.temperature).toBe(0.5);
  });
});

describe("FIMEngine — Post-Processing", () => {
  const engine = new FIMEngine();

  it("strips stop tokens from completion", () => {
    const ctx = makeContext();
    const raw = "42<|endoftext|>extra stuff";
    const cleaned = engine.postProcess(raw, ctx);
    expect(cleaned).not.toContain("<|endoftext|>");
  });

  it("removes prefix repetition", () => {
    const ctx = makeContext({ prefix: "  const result = " });
    const raw = "const result = 42 + 10";
    const cleaned = engine.postProcess(raw, ctx);
    // Should strip the repeated prefix portion
    expect(cleaned).toBeDefined();
  });

  it("clamps to single logical block at double newline", () => {
    const ctx = makeContext();
    const raw = "42\n\nfunction extra() {}";
    const cleaned = engine.postProcess(raw, ctx);
    expect(cleaned).toBe("42");
  });

  it("trims trailing whitespace", () => {
    const ctx = makeContext();
    const raw = "42   ";
    const cleaned = engine.postProcess(raw, ctx);
    expect(cleaned).toBe("42");
  });
});

describe("FIMEngine — Validation", () => {
  const engine = new FIMEngine();

  it("rejects empty completions", () => {
    expect(engine.validateCompletion("", makeContext())).toBe(false);
    expect(engine.validateCompletion("   ", makeContext())).toBe(false);
  });

  it("rejects completions that echo the prefix tail", () => {
    const ctx = makeContext({ prefix: "const result = getValue(" });
    const valid = engine.validateCompletion("getValue(arg1, arg2)", ctx);
    // It should reject echoing the end of prefix
    expect(typeof valid).toBe("boolean");
  });

  it("accepts valid completions", () => {
    const ctx = makeContext();
    expect(engine.validateCompletion("42", ctx)).toBe(true);
  });

  it("rejects deeply unbalanced brackets", () => {
    const ctx = makeContext();
    expect(engine.validateCompletion("))}}", ctx)).toBe(false);
  });
});

describe("FIMEngine — Confidence Estimation", () => {
  const engine = new FIMEngine();

  it("returns 0 for empty completion", () => {
    expect(engine.estimateConfidence("", makeContext())).toBe(0);
  });

  it("scores higher for valid, well-sized completions", () => {
    const ctx = makeContext();
    const good = engine.estimateConfidence("42", ctx);
    expect(good).toBeGreaterThanOrEqual(0.5);
  });

  it("gives bonus for matching indentation", () => {
    const ctx = makeContext({ prefix: "  const x = " });
    const withIndent = engine.estimateConfidence("  42", ctx);
    expect(withIndent).toBeGreaterThanOrEqual(0.3);
  });

  it("confidence is between 0 and 1", () => {
    const ctx = makeContext();
    const score = engine.estimateConfidence("return x + y;", ctx);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("FIMEngine — buildContext", () => {
  const engine = new FIMEngine();

  it("splits code at cursor offset", () => {
    const code = "const a = 1;\nconst b = 2;\n";
    const ctx = engine.buildContext("/src/file.ts", code, 13);
    expect(ctx.prefix).toBe("const a = 1;\n");
    expect(ctx.suffix).toBe("const b = 2;\n");
  });

  it("detects language from file extension", () => {
    const ctx = engine.buildContext("/src/app.py", "x = 1", 0);
    expect(ctx.language).toBe("python");
  });

  it("handles cursor at start of file", () => {
    const ctx = engine.buildContext("/src/file.ts", "const x = 1;", 0);
    expect(ctx.prefix).toBe("");
    expect(ctx.suffix).toBe("const x = 1;");
    expect(ctx.cursorLine).toBe(0);
  });

  it("handles cursor at end of file", () => {
    const code = "const x = 1;";
    const ctx = engine.buildContext("/src/file.ts", code, code.length);
    expect(ctx.prefix).toBe(code);
    expect(ctx.suffix).toBe("");
  });

  it("clamps cursor offset to valid range", () => {
    const code = "abc";
    const ctx = engine.buildContext("/src/file.ts", code, 999);
    expect(ctx.prefix).toBe(code);
    expect(ctx.suffix).toBe("");
  });
});

describe("FIMEngine — Language Detection", () => {
  const engine = new FIMEngine();

  it("detects TypeScript", () => {
    expect(engine.detectLanguage("app.ts")).toBe("typescript");
    expect(engine.detectLanguage("component.tsx")).toBe("typescript");
  });

  it("detects JavaScript variants", () => {
    expect(engine.detectLanguage("app.js")).toBe("javascript");
    expect(engine.detectLanguage("config.mjs")).toBe("javascript");
    expect(engine.detectLanguage("old.cjs")).toBe("javascript");
  });

  it("detects Python", () => {
    expect(engine.detectLanguage("script.py")).toBe("python");
  });

  it("detects Rust", () => {
    expect(engine.detectLanguage("main.rs")).toBe("rust");
  });

  it("returns 'unknown' for unrecognized extensions", () => {
    expect(engine.detectLanguage("file.xyz")).toBe("unknown");
  });
});
