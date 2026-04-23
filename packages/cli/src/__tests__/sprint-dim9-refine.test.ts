// packages/cli/src/__tests__/sprint-dim9-refine.test.ts
// Dim 9 — Iterative Refinement Loop, Component Decomposition, Visual Fidelity Scoring
// Patterns from: draw-a-ui IMPROVED_ORIGINAL, abi/screenshot-to-code update pipeline

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  refineCodeFromScreenshot,
  decomposeIntoComponents,
  scoreVisualFidelity,
  recordScreenshotCodeOutcome,
  loadScreenshotCodeOutcomes,
  type ComponentDecomposition,
  type VisualFidelityScore,
  type ScreenshotCodeOutcome,
} from "@dantecode/core";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const FAKE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Test App</title></head>
<body>
  <nav class="nav-bar"><a href="/">Home</a><a href="/about">About</a></nav>
  <main>
    <div class="card">Card 1</div>
    <div class="card">Card 2</div>
    <div class="card">Card 3</div>
  </main>
  <footer><p>Footer content</p></footer>
</body>
</html>`;

// ── refineCodeFromScreenshot ───────────────────────────────────────────────────

describe("refineCodeFromScreenshot", () => {
  it("returns refined code with file tag in LLM response", async () => {
    const llmCall = vi.fn().mockResolvedValue(
      '<file path="index.html"><!DOCTYPE html><html lang="en"><body><h1>Refined</h1></body></html></file>',
    );
    const result = await refineCodeFromScreenshot(
      FAKE_BASE64,
      FAKE_HTML,
      FAKE_BASE64,
      "html",
      llmCall,
    );
    expect(result.code).toContain("<h1>Refined</h1>");
    expect(result.confidence).toBe(0.95);
  });

  it("returns refined code when LLM responds with raw DOCTYPE html", async () => {
    const html = "<!DOCTYPE html><html><body><h2>Updated</h2></body></html>";
    const llmCall = vi.fn().mockResolvedValue(html);
    const result = await refineCodeFromScreenshot(FAKE_BASE64, FAKE_HTML, FAKE_BASE64, "html", llmCall);
    expect(result.code).toContain("<h2>Updated</h2>");
    expect(result.confidence).toBe(0.95);
  });

  it("falls back to original generatedCode on LLM error", async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error("LLM failure"));
    const result = await refineCodeFromScreenshot(FAKE_BASE64, FAKE_HTML, FAKE_BASE64, "html", llmCall);
    expect(result.code).toBe(FAKE_HTML);
    expect(result.confidence).toBe(0.6);
  });

  it("passes framework as 'react' to framework instructions", async () => {
    const llmCall = vi.fn().mockResolvedValue('<file path="index.html"><div>React</div></file>');
    const result = await refineCodeFromScreenshot(FAKE_BASE64, FAKE_HTML, FAKE_BASE64, "react", llmCall);
    expect(result.framework).toBe("react");
    const callPrompt = llmCall.mock.calls[0]![0] as string;
    expect(callPrompt).toContain("HISTORY:");
    expect(callPrompt).toContain("INSTRUCTIONS:");
  });

  it("prompt includes the existing generatedCode as history", async () => {
    const llmCall = vi.fn().mockResolvedValue("no file tag raw code here");
    await refineCodeFromScreenshot(FAKE_BASE64, FAKE_HTML, FAKE_BASE64, "html", llmCall);
    const callPrompt = llmCall.mock.calls[0]![0] as string;
    expect(callPrompt).toContain(FAKE_HTML);
  });

  it("uses refinedImageBase64 as the image for llmCall", async () => {
    const refinedB64 = "REFINED_BASE64";
    const llmCall = vi.fn().mockResolvedValue("<!DOCTYPE html><html></html>");
    await refineCodeFromScreenshot(FAKE_BASE64, FAKE_HTML, refinedB64, "html", llmCall);
    expect(llmCall.mock.calls[0]![1].base64).toBe(refinedB64);
  });

  it("returns framework from input", async () => {
    const llmCall = vi.fn().mockResolvedValue('<file path="x.html"><div>ok</div></file>');
    const result = await refineCodeFromScreenshot(FAKE_BASE64, FAKE_HTML, FAKE_BASE64, "tailwind", llmCall);
    expect(result.framework).toBe("tailwind");
  });

  it("generatedAt is an ISO date string", async () => {
    const llmCall = vi.fn().mockResolvedValue('<file path="x.html"><div></div></file>');
    const result = await refineCodeFromScreenshot(FAKE_BASE64, FAKE_HTML, FAKE_BASE64, "html", llmCall);
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── decomposeIntoComponents ───────────────────────────────────────────────────

describe("decomposeIntoComponents", () => {
  it("extracts NavBar from <nav> element for react framework", () => {
    const result: ComponentDecomposition = decomposeIntoComponents(FAKE_HTML, "react");
    const navComponent = result.components.find((c) => c.name === "NavBar");
    expect(navComponent).toBeDefined();
    expect(navComponent!.description).toContain("navigation");
  });

  it("extracts Footer from <footer> element for react framework", () => {
    const result: ComponentDecomposition = decomposeIntoComponents(FAKE_HTML, "react");
    const footer = result.components.find((c) => c.name === "Footer");
    expect(footer).toBeDefined();
  });

  it("extracts Card when 2+ card divs exist in react", () => {
    const result: ComponentDecomposition = decomposeIntoComponents(FAKE_HTML, "react");
    const card = result.components.find((c) => c.name === "Card");
    expect(card).toBeDefined();
  });

  it("entry string for react references component names", () => {
    const result: ComponentDecomposition = decomposeIntoComponents(FAKE_HTML, "react");
    expect(result.entry).toContain("function App");
  });

  it("html framework returns section-based decomposition", () => {
    const htmlWithSections = `<html><body>
      <section class="hero">Hero</section>
      <article class="content">Content</article>
      <aside class="sidebar">Sidebar</aside>
    </body></html>`;
    const result: ComponentDecomposition = decomposeIntoComponents(htmlWithSections, "html");
    expect(result.components.length).toBeGreaterThan(0);
    expect(result.entry).toContain("<!--");
  });

  it("returns empty components array for HTML with no known structural elements", () => {
    const simple = "<html><body><p>Hello</p></body></html>";
    const result: ComponentDecomposition = decomposeIntoComponents(simple, "react");
    expect(Array.isArray(result.components)).toBe(true);
    expect(result.entry).toBeDefined();
  });

  it("each component has name, description, and code fields", () => {
    const result: ComponentDecomposition = decomposeIntoComponents(FAKE_HTML, "react");
    for (const comp of result.components) {
      expect(comp.name).toBeTruthy();
      expect(comp.description).toBeTruthy();
      expect(comp.code).toBeTruthy();
    }
  });
});

// ── scoreVisualFidelity ───────────────────────────────────────────────────────

describe("scoreVisualFidelity", () => {
  it("parses layoutMatch, colorMatch, componentCoverage from LLM JSON", async () => {
    const llmCall = vi.fn().mockResolvedValue(
      JSON.stringify({
        layoutMatch: 0.9,
        colorMatch: 0.85,
        componentCoverage: 0.8,
        fidelityScore: 0.86,
        notes: "Minor spacing differences",
      }),
    );
    const result: VisualFidelityScore = await scoreVisualFidelity(FAKE_BASE64, FAKE_BASE64, llmCall);
    expect(result.layoutMatch).toBe(0.9);
    expect(result.colorMatch).toBe(0.85);
    expect(result.componentCoverage).toBe(0.8);
    expect(result.fidelityScore).toBe(0.86);
  });

  it("returns fallback 0.5 scores on LLM error", async () => {
    const llmCall = vi.fn().mockRejectedValue(new Error("network error"));
    const result: VisualFidelityScore = await scoreVisualFidelity(FAKE_BASE64, FAKE_BASE64, llmCall);
    expect(result.fidelityScore).toBe(0.5);
    expect(result.layoutMatch).toBe(0.5);
  });

  it("clamps values to 0-1 range even if LLM returns out-of-range", async () => {
    const llmCall = vi.fn().mockResolvedValue(
      JSON.stringify({ layoutMatch: 1.5, colorMatch: -0.2, componentCoverage: 0.7, fidelityScore: 1.2, notes: "" }),
    );
    const result: VisualFidelityScore = await scoreVisualFidelity(FAKE_BASE64, FAKE_BASE64, llmCall);
    expect(result.layoutMatch).toBe(1);
    expect(result.colorMatch).toBe(0);
    expect(result.fidelityScore).toBeLessThanOrEqual(1);
  });

  it("computes fidelityScore from weighted average when missing from LLM response", async () => {
    const llmCall = vi.fn().mockResolvedValue(
      JSON.stringify({ layoutMatch: 0.8, colorMatch: 0.6, componentCoverage: 0.7, notes: "" }),
    );
    const result: VisualFidelityScore = await scoreVisualFidelity(FAKE_BASE64, FAKE_BASE64, llmCall);
    // 0.8*0.4 + 0.6*0.3 + 0.7*0.3 = 0.32 + 0.18 + 0.21 = 0.71
    expect(result.fidelityScore).toBeCloseTo(0.71, 2);
  });

  it("returns fallback when LLM response has no JSON", async () => {
    const llmCall = vi.fn().mockResolvedValue("Sorry, I cannot compare images.");
    const result: VisualFidelityScore = await scoreVisualFidelity(FAKE_BASE64, FAKE_BASE64, llmCall);
    expect(result.fidelityScore).toBe(0.5);
    expect(result.notes).toContain("not parseable");
  });

  it("notes field is present and is a string", async () => {
    const llmCall = vi.fn().mockResolvedValue(
      JSON.stringify({ layoutMatch: 0.7, colorMatch: 0.7, componentCoverage: 0.7, fidelityScore: 0.7, notes: "Good match" }),
    );
    const result: VisualFidelityScore = await scoreVisualFidelity(FAKE_BASE64, FAKE_BASE64, llmCall);
    expect(typeof result.notes).toBe("string");
    expect(result.notes).toBe("Good match");
  });
});

// ── Seed data: outcomes with refinement metadata ──────────────────────────────

describe("ScreenshotCodeOutcome with refinement metadata", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("records and loads outcomes with iterationCount and fidelityScore", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim9-refine-"));
    const outcome: ScreenshotCodeOutcome = {
      sessionId: "ref1",
      framework: "react",
      confidence: 0.95,
      accepted: true,
      recordedAt: new Date().toISOString(),
      iterationCount: 2,
      fidelityScore: 0.87,
    };
    recordScreenshotCodeOutcome(outcome, tmpDir);
    const loaded = loadScreenshotCodeOutcomes(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.iterationCount).toBe(2);
    expect(loaded[0]!.fidelityScore).toBe(0.87);
  });

  it("outcomes without refinement metadata still load correctly", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim9-refine-"));
    const outcome: ScreenshotCodeOutcome = {
      sessionId: "ref2",
      framework: "html",
      confidence: 0.8,
      accepted: false,
      recordedAt: new Date().toISOString(),
    };
    recordScreenshotCodeOutcome(outcome, tmpDir);
    const loaded = loadScreenshotCodeOutcomes(tmpDir);
    expect(loaded[0]!.iterationCount).toBeUndefined();
    expect(loaded[0]!.fidelityScore).toBeUndefined();
  });
});
