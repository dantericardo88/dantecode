import { describe, it, expect } from "vitest";

import {
  getFIMTemplate,
  buildFIMPromptForModel,
  type FIMInput,
} from "./fim-templates.js";

// ---------------------------------------------------------------------------
// Template registry tests
// ---------------------------------------------------------------------------

describe("getFIMTemplate", () => {
  it("returns CodeLlama tokens for codellama model IDs", () => {
    const t = getFIMTemplate("ollama", "codellama-7b");
    expect(t.prefix).toBe("<PRE>");
    expect(t.suffix).toBe("<SUF>");
    expect(t.middle).toBe("<MID>");
  });

  it("matches codellama even with version suffixes", () => {
    const t = getFIMTemplate("ollama", "codellama-34b-instruct");
    expect(t.prefix).toBe("<PRE>");
  });

  it("returns StarCoder tokens for starcoder model IDs", () => {
    const t = getFIMTemplate("huggingface", "starcoder2-3b");
    expect(t.prefix).toBe("<fim_prefix>");
    expect(t.suffix).toBe("<fim_suffix>");
    expect(t.middle).toBe("<fim_middle>");
  });

  it("returns DeepSeek tokens for deepseek-coder model IDs", () => {
    const t = getFIMTemplate("ollama", "deepseek-coder-6.7b");
    expect(t.prefix).toBe("<|fim_begin|>");
    expect(t.suffix).toBe("<|fim_hole|>");
    expect(t.middle).toBe("<|fim_end|>");
  });

  it("returns StarCoder tokens for qwen model IDs", () => {
    const t = getFIMTemplate("ollama", "qwen2.5-coder");
    expect(t.prefix).toBe("<fim_prefix>");
    expect(t.suffix).toBe("<fim_suffix>");
    expect(t.middle).toBe("<fim_middle>");
  });

  it("falls back to generic template for unknown models", () => {
    const t = getFIMTemplate("openai", "gpt-4o");
    expect(t.prefix).toContain("prefix");
    expect(t.suffix).toContain("suffix");
    expect(t.middle).toContain("middle");
  });

  it("is case-insensitive when matching model IDs", () => {
    const t = getFIMTemplate("ollama", "CodeLlama-13B");
    expect(t.prefix).toBe("<PRE>");
  });

  it("matches deepseek-coder embedded in longer model names", () => {
    const t = getFIMTemplate("ollama", "some-deepseek-coder-v2");
    expect(t.prefix).toBe("<|fim_begin|>");
  });
});

// ---------------------------------------------------------------------------
// Prompt builder tests
// ---------------------------------------------------------------------------

describe("buildFIMPromptForModel", () => {
  const baseInput: FIMInput = {
    prefix: "function greet() {\n  ",
    suffix: "\n}\n",
  };

  it("assembles a CodeLlama prompt with correct token wrapping", () => {
    const result = buildFIMPromptForModel("ollama", "codellama-7b", baseInput);
    expect(result.prompt).toBe("<PRE>function greet() {\n  <SUF>\n}\n<MID>");
  });

  it("assembles a StarCoder prompt with correct token wrapping", () => {
    const result = buildFIMPromptForModel("ollama", "starcoder2-3b", baseInput);
    expect(result.prompt).toBe(
      "<fim_prefix>function greet() {\n  <fim_suffix>\n}\n<fim_middle>",
    );
  });

  it("assembles a DeepSeek prompt with correct token wrapping", () => {
    const result = buildFIMPromptForModel("ollama", "deepseek-coder-6.7b", baseInput);
    expect(result.prompt).toBe(
      "<|fim_begin|>function greet() {\n  <|fim_hole|>\n}\n<|fim_end|>",
    );
  });

  it("prepends cross-file context before the prefix code", () => {
    const input: FIMInput = {
      ...baseInput,
      crossFileContext: "// From utils.ts: export function trim(s: string): string",
    };
    const result = buildFIMPromptForModel("ollama", "codellama-7b", input);
    expect(result.prompt).toContain(
      "<PRE>// From utils.ts: export function trim(s: string): string\nfunction greet()",
    );
  });

  it("omits cross-file context block when context is empty", () => {
    const input: FIMInput = { ...baseInput, crossFileContext: "" };
    const result = buildFIMPromptForModel("ollama", "codellama-7b", input);
    expect(result.prompt).toBe("<PRE>function greet() {\n  <SUF>\n}\n<MID>");
  });

  it("returns stop tokens that include all FIM delimiters and endoftext", () => {
    const result = buildFIMPromptForModel("ollama", "codellama-7b", baseInput);
    expect(result.stop).toContain("<PRE>");
    expect(result.stop).toContain("<SUF>");
    expect(result.stop).toContain("<MID>");
    expect(result.stop).toContain("<|endoftext|>");
  });

  it("deduplicates stop tokens", () => {
    const result = buildFIMPromptForModel("ollama", "codellama-7b", baseInput);
    const unique = new Set(result.stop);
    expect(result.stop.length).toBe(unique.size);
  });

  it("uses the generic template for unknown provider/model pairs", () => {
    const result = buildFIMPromptForModel("custom", "my-model", baseInput);
    expect(result.prompt).toContain("prefix");
    expect(result.prompt).toContain("suffix");
    expect(result.prompt).toContain("middle");
  });
});
