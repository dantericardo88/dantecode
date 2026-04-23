// ============================================================================
// Sprint Dim 9: Screenshot-to-code pipeline tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  analyzeScreenshotLayout,
  generateCodeFromScreenshot,
  recordScreenshotCodeOutcome,
  loadScreenshotCodeOutcomes,
  getScreenshotCodeAcceptanceRate,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim9-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── analyzeScreenshotLayout ───────────────────────────────────────────────────

describe("analyzeScreenshotLayout", () => {
  it("returns LayoutAnalysis with all required fields", async () => {
    const llmCall = async () =>
      JSON.stringify({
        description: "A dark dashboard",
        components: ["nav", "sidebar", "card"],
        colorScheme: "dark",
        layoutType: "dashboard",
        estimatedFramework: "react",
      });
    const result = await analyzeScreenshotLayout("base64data", "image/png", llmCall);
    expect(result.description).toBeTruthy();
    expect(Array.isArray(result.components)).toBe(true);
    expect(result.colorScheme).toBeDefined();
    expect(result.layoutType).toBeDefined();
    expect(result.estimatedFramework).toBeDefined();
  });

  it("falls back gracefully when LLM returns non-JSON", async () => {
    const llmCall = async () => "Sorry I cannot help with that.";
    const result = await analyzeScreenshotLayout("data", "image/jpeg", llmCall);
    expect(result.description).toBe("UI layout");
    expect(result.colorScheme).toBe("light");
    expect(result.layoutType).toBe("unknown");
    expect(result.estimatedFramework).toBe("html");
  });

  it("detects dark colorScheme from LLM response", async () => {
    const llmCall = async () =>
      '{"description":"dark UI","components":[],"colorScheme":"dark","layoutType":"grid","estimatedFramework":"vue"}';
    const result = await analyzeScreenshotLayout("img", "image/png", llmCall);
    expect(result.colorScheme).toBe("dark");
  });

  it("detects components array correctly", async () => {
    const llmCall = async () =>
      '{"description":"form","components":["button","input","label"],"colorScheme":"light","layoutType":"single-column","estimatedFramework":"html"}';
    const result = await analyzeScreenshotLayout("img", "image/png", llmCall);
    expect(result.components).toContain("button");
    expect(result.components).toContain("input");
  });

  it("falls back on partial JSON gracefully", async () => {
    const llmCall = async () => '{"description":"test"'; // malformed
    const result = await analyzeScreenshotLayout("img", "image/png", llmCall);
    expect(result).toBeDefined();
    expect(result.colorScheme).toBeDefined();
  });
});

// ── generateCodeFromScreenshot ────────────────────────────────────────────────

describe("generateCodeFromScreenshot", () => {
  it("returns non-empty code string", async () => {
    const llmCall = async (prompt: string) => {
      if (prompt.includes("Analyze")) {
        return '{"description":"UI","components":["div"],"colorScheme":"light","layoutType":"single-column","estimatedFramework":"html"}';
      }
      return '<file path="index.html"><!DOCTYPE html><html><body>Hello</body></html></file>';
    };
    const result = await generateCodeFromScreenshot("img", "image/png", "html", llmCall);
    expect(result.code).toBeTruthy();
    expect(result.code).not.toBe("");
  });

  it("returns confidence=0.9 when analysis has components", async () => {
    const llmCall = async (prompt: string) => {
      if (prompt.includes("Analyze")) {
        return '{"description":"nav","components":["nav","button"],"colorScheme":"light","layoutType":"single-column","estimatedFramework":"html"}';
      }
      return '<file path="index.html">code</file>';
    };
    const result = await generateCodeFromScreenshot("img", "image/png", "html", llmCall);
    expect(result.confidence).toBe(0.9);
  });

  it("returns confidence=0.6 when analysis falls back (no components)", async () => {
    const llmCall = async () => "not json"; // analysis fails → empty components
    const result = await generateCodeFromScreenshot("img", "image/png", "html", llmCall);
    expect(result.confidence).toBe(0.6);
  });

  it("uses react framework by default when specified", async () => {
    const llmCall = async (prompt: string) => {
      if (prompt.includes("Analyze")) return "{}";
      return '<file path="index.html">react code</file>';
    };
    const result = await generateCodeFromScreenshot("img", "image/png", "react", llmCall);
    expect(result.framework).toBe("react");
  });

  it("extracts code from <file> wrapper when present", async () => {
    const llmCall = async (prompt: string) => {
      if (prompt.includes("Analyze")) return "{}";
      return '<file path="index.html">MY_CODE_HERE</file>';
    };
    const result = await generateCodeFromScreenshot("img", "image/png", "html", llmCall);
    expect(result.code).toBe("MY_CODE_HERE");
  });
});

// ── Persistence ───────────────────────────────────────────────────────────────

describe("recordScreenshotCodeOutcome + loadScreenshotCodeOutcomes", () => {
  it("creates screenshot-code-outcomes.jsonl on first record", () => {
    recordScreenshotCodeOutcome(
      { sessionId: "s1", framework: "react", confidence: 0.9, accepted: true, recordedAt: "" },
      tmpDir,
    );
    expect(existsSync(join(tmpDir, ".danteforge", "screenshot-code-outcomes.jsonl"))).toBe(true);
  });

  it("reads back entries correctly", () => {
    recordScreenshotCodeOutcome({ sessionId: "a", framework: "html", confidence: 0.7, accepted: true, recordedAt: "" }, tmpDir);
    recordScreenshotCodeOutcome({ sessionId: "b", framework: "vue", confidence: 0.5, accepted: false, recordedAt: "" }, tmpDir);
    const outcomes = loadScreenshotCodeOutcomes(tmpDir);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.sessionId).toBe("a");
    expect(outcomes[1]!.accepted).toBe(false);
  });

  it("returns empty array when no file exists", () => {
    expect(loadScreenshotCodeOutcomes(tmpDir)).toEqual([]);
  });
});

// ── getScreenshotCodeAcceptanceRate ───────────────────────────────────────────

describe("getScreenshotCodeAcceptanceRate", () => {
  it("returns 0 for empty outcomes", () => {
    expect(getScreenshotCodeAcceptanceRate([])).toBe(0);
  });

  it("returns correct rate: 3 accepted / 5 total = 0.6", () => {
    const outcomes = [
      { sessionId: "1", framework: "html", confidence: 0.9, accepted: true, recordedAt: "" },
      { sessionId: "2", framework: "html", confidence: 0.8, accepted: true, recordedAt: "" },
      { sessionId: "3", framework: "html", confidence: 0.7, accepted: true, recordedAt: "" },
      { sessionId: "4", framework: "html", confidence: 0.5, accepted: false, recordedAt: "" },
      { sessionId: "5", framework: "html", confidence: 0.4, accepted: false, recordedAt: "" },
    ];
    expect(getScreenshotCodeAcceptanceRate(outcomes)).toBeCloseTo(0.6, 2);
  });

  it("returns 1.0 when all accepted", () => {
    const outcomes = [
      { sessionId: "1", framework: "react", confidence: 0.9, accepted: true, recordedAt: "" },
      { sessionId: "2", framework: "react", confidence: 0.9, accepted: true, recordedAt: "" },
    ];
    expect(getScreenshotCodeAcceptanceRate(outcomes)).toBe(1);
  });
});
