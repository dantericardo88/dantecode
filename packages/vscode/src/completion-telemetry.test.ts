import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CompletionTelemetry } from "./completion-telemetry.js";
import type { CompletionEvent } from "./completion-telemetry.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    timestamp: new Date().toISOString(),
    modelId: "grok/grok-3",
    language: "typescript",
    filePath: "/workspace/src/example.ts",
    completionLength: 40,
    completionLines: 1,
    isMultiline: false,
    outcome: "rejected",
    latencyMs: 200,
    cacheHit: false,
    contextTokens: 512,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "telemetry-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CompletionTelemetry", () => {
  it("record event → getStats() totalShown = 1", () => {
    const t = new CompletionTelemetry(tmpDir);
    t.record(makeEvent({ outcome: "accepted" }));
    expect(t.getStats().totalShown).toBe(1);
  });

  it("accept rate: 5 accepted / 10 shown = 0.5", () => {
    const t = new CompletionTelemetry(tmpDir);
    for (let i = 0; i < 5; i++) t.record(makeEvent({ outcome: "accepted" }));
    for (let i = 0; i < 5; i++) t.record(makeEvent({ outcome: "rejected" }));
    const stats = t.getStats();
    expect(stats.totalShown).toBe(10);
    expect(stats.accepted).toBe(5);
    expect(stats.acceptRate).toBeCloseTo(0.5, 5);
  });

  it("multiline vs single-line accept rates tracked separately", () => {
    const t = new CompletionTelemetry(tmpDir);
    // 3 multiline accepted, 1 multiline rejected
    t.record(makeEvent({ isMultiline: true, outcome: "accepted" }));
    t.record(makeEvent({ isMultiline: true, outcome: "accepted" }));
    t.record(makeEvent({ isMultiline: true, outcome: "accepted" }));
    t.record(makeEvent({ isMultiline: true, outcome: "rejected" }));
    // 1 single-line accepted, 3 single-line rejected
    t.record(makeEvent({ isMultiline: false, outcome: "accepted" }));
    t.record(makeEvent({ isMultiline: false, outcome: "rejected" }));
    t.record(makeEvent({ isMultiline: false, outcome: "rejected" }));
    t.record(makeEvent({ isMultiline: false, outcome: "rejected" }));

    const stats = t.getStats();
    expect(stats.multilineAcceptRate).toBeCloseTo(0.75, 5);
    expect(stats.singleLineAcceptRate).toBeCloseTo(0.25, 5);
  });

  it("byLanguage breakdown is correct", () => {
    const t = new CompletionTelemetry(tmpDir);
    t.record(makeEvent({ language: "typescript", outcome: "accepted" }));
    t.record(makeEvent({ language: "typescript", outcome: "rejected" }));
    t.record(makeEvent({ language: "python", outcome: "accepted" }));

    const { byLanguage } = t.getStats();
    expect(byLanguage["typescript"]?.shown).toBe(2);
    expect(byLanguage["typescript"]?.accepted).toBe(1);
    expect(byLanguage["typescript"]?.rate).toBeCloseTo(0.5, 5);
    expect(byLanguage["python"]?.shown).toBe(1);
    expect(byLanguage["python"]?.accepted).toBe(1);
    expect(byLanguage["python"]?.rate).toBeCloseTo(1.0, 5);
  });

  it("byModel breakdown is correct", () => {
    const t = new CompletionTelemetry(tmpDir);
    t.record(makeEvent({ modelId: "grok/grok-3", outcome: "accepted" }));
    t.record(makeEvent({ modelId: "grok/grok-3", outcome: "rejected" }));
    t.record(makeEvent({ modelId: "ollama/qwen2.5-coder", outcome: "accepted" }));
    t.record(makeEvent({ modelId: "ollama/qwen2.5-coder", outcome: "accepted" }));

    const { byModel } = t.getStats();
    expect(byModel["grok/grok-3"]?.shown).toBe(2);
    expect(byModel["grok/grok-3"]?.rate).toBeCloseTo(0.5, 5);
    expect(byModel["ollama/qwen2.5-coder"]?.shown).toBe(2);
    expect(byModel["ollama/qwen2.5-coder"]?.rate).toBeCloseTo(1.0, 5);
  });

  it('getMultilinePreference() returns "prefer-multiline" when multiline accept rate is higher', () => {
    const t = new CompletionTelemetry(tmpDir);
    // Need >= 10 events to get a non-neutral result
    for (let i = 0; i < 8; i++) t.record(makeEvent({ isMultiline: true, outcome: "accepted" }));
    for (let i = 0; i < 2; i++) t.record(makeEvent({ isMultiline: false, outcome: "rejected" }));
    expect(t.getMultilinePreference()).toBe("prefer-multiline");
  });

  it('getMultilinePreference() returns "neutral" when fewer than 10 events', () => {
    const t = new CompletionTelemetry(tmpDir);
    t.record(makeEvent({ isMultiline: true, outcome: "accepted" }));
    t.record(makeEvent({ isMultiline: false, outcome: "rejected" }));
    expect(t.getMultilinePreference()).toBe("neutral");
  });

  it("getAdaptiveHints() returns correct debounce suggestion", () => {
    const t = new CompletionTelemetry(tmpDir);
    // Accepted events with 100ms latency
    for (let i = 0; i < 5; i++) {
      t.record(makeEvent({ outcome: "accepted", latencyMs: 100 }));
    }
    const hints = t.getAdaptiveHints();
    // suggestedDebounceMs = max(80, min(300, 100 * 0.6)) = max(80, 60) = 80
    expect(hints.suggestedDebounceMs).toBeCloseTo(80, 0);
  });

  it("getAdaptiveHints() identifies strong (rate>0.4) and weak (rate<0.15, shown>20) languages", () => {
    const t = new CompletionTelemetry(tmpDir);
    // Strong language: typescript — 9 accepted / 10 shown = 0.9 > 0.4
    for (let i = 0; i < 9; i++)
      t.record(makeEvent({ language: "typescript", outcome: "accepted" }));
    t.record(makeEvent({ language: "typescript", outcome: "rejected" }));
    // Weak language: rust — 2 accepted / 21 shown = ~0.095 < 0.15, shown > 20
    for (let i = 0; i < 2; i++) t.record(makeEvent({ language: "rust", outcome: "accepted" }));
    for (let i = 0; i < 19; i++) t.record(makeEvent({ language: "rust", outcome: "rejected" }));

    const hints = t.getAdaptiveHints();
    expect(hints.strongLanguages).toContain("typescript");
    expect(hints.weakLanguages).toContain("rust");
  });

  it("flush() + load() roundtrip preserves events", async () => {
    const t1 = new CompletionTelemetry(tmpDir);
    t1.record(makeEvent({ outcome: "accepted", modelId: "test/model", completionLength: 42 }));
    t1.record(makeEvent({ outcome: "rejected", language: "python" }));
    await t1.flush();

    const t2 = new CompletionTelemetry(tmpDir);
    await t2.load();
    const stats = t2.getStats();
    expect(stats.totalShown).toBe(2);
    expect(stats.accepted).toBe(1);
    expect(stats.byModel["test/model"]?.shown).toBe(1);
    expect(stats.byLanguage["python"]?.shown).toBe(1);
  });

  it("prune() removes events older than 30 days", () => {
    const t = new CompletionTelemetry(tmpDir);
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();
    t.record(makeEvent({ timestamp: oldDate, outcome: "accepted" }));
    t.record(makeEvent({ timestamp: recentDate, outcome: "rejected" }));

    const removed = t.prune();
    expect(removed).toBe(1);
    expect(t.getStats().totalShown).toBe(1);
    expect(t.getStats().rejected).toBe(1);
  });

  it("max events cap: when > 10000 events, oldest are pruned on record()", () => {
    const t = new CompletionTelemetry(tmpDir);
    // Add 10001 events; oldest should be pruned
    const oldTimestamp = new Date(Date.now() - 1000).toISOString();
    t.record(makeEvent({ timestamp: oldTimestamp, modelId: "oldest/model" }));
    for (let i = 0; i < 10000; i++) {
      t.record(makeEvent({ modelId: "filler/model" }));
    }
    // After 10001 records, should have exactly 10000 and the oldest should be gone
    const stats = t.getStats();
    expect(stats.totalShown).toBe(10000);
    // The "oldest/model" entry should have been evicted
    expect(stats.byModel["oldest/model"]).toBeUndefined();
  });
});
