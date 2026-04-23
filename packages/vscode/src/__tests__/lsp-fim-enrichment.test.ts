// packages/vscode/src/__tests__/lsp-fim-enrichment.test.ts
// 8 tests covering LSP context injection into FIM prompts

import { describe, it, expect, vi } from "vitest";

// Mock vscode before any imports that use it
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: (key: string, def: unknown) => {
        if (key === "diffMode") return "auto";
        return def;
      },
    })),
  },
  SymbolKind: {},
}));

import { buildFIMPrompt } from "../inline-completion.js";

// ── buildFIMPrompt LSP injection ──────────────────────────────────────────────

const BASE_INPUT = {
  prefix: "const x = ",
  suffix: ";\n",
  language: "typescript",
  filePath: "src/app.ts",
};

describe("buildFIMPrompt — LSP context injection", () => {
  it("includes '## Type context (LSP)' section when lspHover provided", () => {
    const result = buildFIMPrompt({
      ...BASE_INPUT,
      lspHover: "number — the count of retries",
    });
    expect(result.systemPrompt).toContain("## Type context (LSP):");
    expect(result.systemPrompt).toContain("number — the count of retries");
  });

  it("includes lspDefinition when provided", () => {
    const result = buildFIMPrompt({
      ...BASE_INPUT,
      lspDefinition: "function getCount(): number { return _count; }",
    });
    expect(result.systemPrompt).toContain("## Definition (LSP):");
    expect(result.systemPrompt).toContain("function getCount(): number");
  });

  it("FIM fires normally when lspHover is undefined (no LSP section added)", () => {
    const result = buildFIMPrompt({ ...BASE_INPUT });
    expect(result.systemPrompt).not.toContain("## Type context (LSP)");
    expect(result.systemPrompt).not.toContain("## Definition (LSP)");
  });

  it("injects lspHover after symbolDef in systemPrompt order", () => {
    const result = buildFIMPrompt({
      ...BASE_INPUT,
      symbolDef: "const x: number = 0;",
      lspHover: "type: number",
    });
    const sym = result.systemPrompt.indexOf("## Symbol definition:");
    const lsp = result.systemPrompt.indexOf("## Type context (LSP):");
    expect(sym).toBeGreaterThanOrEqual(0);
    expect(lsp).toBeGreaterThanOrEqual(0);
    expect(sym).toBeLessThan(lsp);
  });

  it("lspHover content is capped at 1050 chars", () => {
    const longHover = "x".repeat(2000);
    const result = buildFIMPrompt({ ...BASE_INPUT, lspHover: longHover });
    // The injected string is truncated at 1050
    expect(result.systemPrompt).toContain("x".repeat(1050));
    expect(result.systemPrompt).not.toContain("x".repeat(1051));
  });

  it("empty string lspHover is not injected (falsy guard)", () => {
    const result = buildFIMPrompt({ ...BASE_INPUT, lspHover: "" });
    expect(result.systemPrompt).not.toContain("## Type context (LSP)");
  });

  it("useUnifiedDiff=false produces standard completion instruction", () => {
    const result = buildFIMPrompt({ ...BASE_INPUT, useUnifiedDiff: false });
    expect(result.systemPrompt).toContain("Return ONLY the completion text");
    expect(result.systemPrompt).not.toContain("unified diff");
  });

  it("useUnifiedDiff=true changes instruction to unified diff format", () => {
    const result = buildFIMPrompt({ ...BASE_INPUT, useUnifiedDiff: true });
    expect(result.systemPrompt).toContain("unified diff");
    expect(result.systemPrompt).toContain("--- a/src/app.ts");
    expect(result.systemPrompt).toContain("+++ b/src/app.ts");
  });
});
