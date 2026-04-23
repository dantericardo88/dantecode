// ============================================================================
// Sprint H — Dim 1: FIM Prompt Builder tests
// Covers detectFimModel, buildFimPrompt, isFimCapable for all known families.
// ============================================================================

import { describe, it, expect } from "vitest";
import { detectFimModel, buildFimPrompt, isFimCapable } from "../fim-prompt-builder.js";

// ── detectFimModel ────────────────────────────────────────────────────────────

describe("detectFimModel", () => {
  it("returns 'deepseek-coder' for deepseek-coder:latest", () => {
    expect(detectFimModel("deepseek-coder:latest")).toBe("deepseek-coder");
  });

  it("returns 'starcoder2' for starcoder2:3b", () => {
    expect(detectFimModel("starcoder2:3b")).toBe("starcoder2");
  });

  it("returns 'codellama' for codellama:7b-code", () => {
    expect(detectFimModel("codellama:7b-code")).toBe("codellama");
  });

  it("returns 'unknown' for llama3 (not a FIM model)", () => {
    expect(detectFimModel("llama3")).toBe("unknown");
  });
});

// ── buildFimPrompt ────────────────────────────────────────────────────────────

describe("buildFimPrompt", () => {
  it("deepseek-coder format uses <PRE>/<SUF>/<MID> tokens", () => {
    const result = buildFimPrompt("deepseek-coder", "prefix_code", "suffix_code");
    expect(result).toBe("<PRE>prefix_code<SUF>suffix_code<MID>");
  });

  it("starcoder2 format uses <fim_prefix>/<fim_suffix>/<fim_middle> tokens", () => {
    const result = buildFimPrompt("starcoder2", "prefix_code", "suffix_code");
    expect(result).toBe("<fim_prefix>prefix_code<fim_suffix>suffix_code<fim_middle>");
  });

  it("codellama format uses <PRE> /<SUF>/<MID> with spaces", () => {
    const result = buildFimPrompt("codellama", "prefix_code", "suffix_code");
    expect(result).toBe("<PRE> prefix_code <SUF> suffix_code <MID>");
  });

  it("unknown model returns prefix only (chat-path fallback)", () => {
    const result = buildFimPrompt("unknown", "prefix_code", "suffix_code");
    expect(result).toBe("prefix_code");
  });
});

// ── isFimCapable ──────────────────────────────────────────────────────────────

describe("isFimCapable", () => {
  it("returns true for deepseek-coder:6.7b", () => {
    expect(isFimCapable("deepseek-coder:6.7b")).toBe(true);
  });

  it("returns true for starcoder2:3b", () => {
    expect(isFimCapable("starcoder2:3b")).toBe(true);
  });

  it("returns false for llama3 (not a FIM model)", () => {
    expect(isFimCapable("llama3")).toBe(false);
  });
});
