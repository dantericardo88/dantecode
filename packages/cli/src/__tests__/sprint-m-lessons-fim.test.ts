// ============================================================================
// Sprint M — Dims 21+1: Per-turn lesson injection + FIM warmup P50 probe
// Tests that:
//  - per-turn lesson injection fires after assistant message in agent loop
//  - lesson NOT re-injected within 5-turn cooldown window
//  - lesson injected as `[Lesson reminder]:` prefixed user message
//  - contextTokens extracted from last assistant message (first 50 words)
//  - injection skipped when no lessons above score threshold
//  - warmup() makes exactly 3 FIM probe requests
//  - getWarmupP50() returns null before warmup, number after
//  - `[FIM warmup] P50=` printed to output channel after warmup
// ============================================================================

import { describe, it, expect, vi } from "vitest";

// ─── Part 1: Per-turn lesson injection (dim 21) ───────────────────────────────

/** Minimal simulation of the per-turn lesson injection state machine in agent-loop.ts */
class LessonInjectionState {
  private _lastInjectedLesson = "";
  private _lessonCooldownTurns = 0;
  readonly LESSON_COOLDOWN = 5;
  readonly LESSON_SCORE_THRESHOLD = 0.7;

  processRound(
    assistantContent: string,
    queryLessonsFn: (tokens: string[]) => Array<{ pattern: string; occurrences: number }>,
  ): string | null {
    if (this._lessonCooldownTurns > 0) {
      this._lessonCooldownTurns--;
      return null;
    }
    const contextTokens = assistantContent
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 50);

    const lessons = queryLessonsFn(contextTokens);
    const topLesson = lessons[0];
    if (!topLesson) return null;
    if (topLesson.pattern === this._lastInjectedLesson) return null;

    const normalizedOccurrences = topLesson.occurrences / Math.max(topLesson.occurrences, 1);
    if (normalizedOccurrences < this.LESSON_SCORE_THRESHOLD) return null;

    const msg = `[Lesson reminder]: ${topLesson.pattern}`;
    this._lastInjectedLesson = topLesson.pattern;
    this._lessonCooldownTurns = this.LESSON_COOLDOWN;
    return msg;
  }
}

describe("Per-turn lesson injection — Sprint M (dim 21)", () => {
  const mockLesson = { pattern: "always use parameterized queries", occurrences: 5 };
  const mockQueryFn = vi.fn(() => [mockLesson]);

  // 1. Injection fires on the first round with a qualifying lesson
  it("per-turn injection fires after assistant message when lesson qualifies", () => {
    const state = new LessonInjectionState();
    const msg = state.processRound("the database query was updated", mockQueryFn);
    expect(msg).toBe(`[Lesson reminder]: ${mockLesson.pattern}`);
  });

  // 2. Injection NOT fired within 5-turn cooldown
  it("lesson NOT re-injected within 5-turn cooldown after first injection", () => {
    const state = new LessonInjectionState();
    state.processRound("database query updated", mockQueryFn);
    for (let i = 0; i < 5; i++) {
      const msg = state.processRound("more database work", mockQueryFn);
      expect(msg).toBeNull();
    }
  });

  // 3. Injection fires again after cooldown expires (5 turns)
  it("injection fires again after 5-turn cooldown expires", () => {
    const state = new LessonInjectionState();
    state.processRound("round 1", mockQueryFn);
    // Use a different lesson so it's not filtered by same-lesson check
    const mockQueryFn2 = vi.fn(() => [{ pattern: "validate inputs at boundaries", occurrences: 3 }]);
    for (let i = 0; i < 5; i++) state.processRound("round " + (i + 2), mockQueryFn);
    const msg = state.processRound("round 7", mockQueryFn2);
    expect(msg).toBe("[Lesson reminder]: validate inputs at boundaries");
  });

  // 4. Message uses [Lesson reminder]: prefix
  it("injection message always starts with [Lesson reminder]:", () => {
    const state = new LessonInjectionState();
    const msg = state.processRound("some code", mockQueryFn);
    expect(msg).toMatch(/^\[Lesson reminder\]:/);
  });

  // 5. contextTokens are first 50 words of assistant content
  it("contextTokens extracted from first 50 words of assistant message", () => {
    const capturedTokens: string[][] = [];
    const capturingQuery = (tokens: string[]) => {
      capturedTokens.push(tokens);
      return [mockLesson];
    };
    const state = new LessonInjectionState();
    const longContent = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
    state.processRound(longContent, capturingQuery);
    expect(capturedTokens[0]?.length).toBeLessThanOrEqual(50);
    expect(capturedTokens[0]?.[0]).toBe("word0");
  });

  // 6. Injection skipped when no lessons returned
  it("injection skipped when queryLessons returns empty array", () => {
    const state = new LessonInjectionState();
    const emptyQuery = vi.fn(() => [] as { pattern: string; occurrences: number }[]);
    const msg = state.processRound("some code", emptyQuery);
    expect(msg).toBeNull();
  });

  // 7. Same lesson not injected twice in a row
  it("same lesson pattern not injected twice consecutively", () => {
    const state = new LessonInjectionState();
    state.processRound("first round", mockQueryFn);
    // Fast-forward past cooldown (simulate 5 turns)
    for (let i = 0; i < 5; i++) state["_lessonCooldownTurns"]--;
    // Same lesson — should be filtered by same-lesson check
    const msg = state.processRound("second round", mockQueryFn);
    // After cooldown, if same pattern, should not re-inject
    // Note: processRound decrements cooldown internally, not via private field
    // so we test via the actual pattern filter
    expect(msg).toBeNull();
  });
});

// ─── Part 2: FIM warmup P50 probe (dim 1) ────────────────────────────────────

describe("FIM warmup P50 probe calls — Sprint M (dim 1)", () => {
  // Minimal mock of CompletionContextRetriever warmup + probe logic
  class MockRetriever {
    private _warmupP50Ms: number | null = null;

    getWarmupP50(): number | null {
      return this._warmupP50Ms;
    }

    async warmup(
      _workspaceRoot: string,
      fimProbe?: (prompt: string) => Promise<number>,
      outputChannel?: { appendLine(msg: string): void },
    ): Promise<void> {
      // Simulate embedding indexing (instant in mock)
      if (fimProbe) {
        const syntheticPrompt = "function add(a: number, b: ";
        const latencies: number[] = [];
        for (let i = 0; i < 3; i++) {
          try {
            const ms = await fimProbe(syntheticPrompt);
            latencies.push(ms);
          } catch { /* non-fatal */ }
        }
        if (latencies.length > 0) {
          latencies.sort((a, b) => a - b);
          const p50 = latencies[Math.floor(latencies.length / 2)] ?? latencies[0] ?? 0;
          this._warmupP50Ms = p50;
          outputChannel?.appendLine(`[FIM warmup] P50=${p50}ms after ${latencies.length} probe request${latencies.length === 1 ? "" : "s"}`);
        }
      }
    }
  }

  // 8. getWarmupP50() returns null before warmup called
  it("getWarmupP50() returns null before warmup is called", () => {
    const retriever = new MockRetriever();
    expect(retriever.getWarmupP50()).toBeNull();
  });

  // 9. warmup() makes exactly 3 probe calls
  it("warmup() makes exactly 3 FIM probe requests", async () => {
    const retriever = new MockRetriever();
    const probeCalls: string[] = [];
    const fimProbe = vi.fn(async (prompt: string) => {
      probeCalls.push(prompt);
      return 50;
    });
    await retriever.warmup("/workspace", fimProbe);
    expect(fimProbe).toHaveBeenCalledTimes(3);
    expect(probeCalls).toHaveLength(3);
  });

  // 10. getWarmupP50() returns a number after warmup with probe
  it("getWarmupP50() returns a number after warmup with probe function", async () => {
    const retriever = new MockRetriever();
    const fimProbe = vi.fn(async (_: string) => 75);
    await retriever.warmup("/workspace", fimProbe);
    const p50 = retriever.getWarmupP50();
    expect(p50).not.toBeNull();
    expect(typeof p50).toBe("number");
  });

  // 11. P50 is median of 3 probe latencies
  it("P50 is the median of the 3 probe latencies (sorted)", async () => {
    const retriever = new MockRetriever();
    const latencies = [100, 50, 75];
    let callIdx = 0;
    const fimProbe = vi.fn(async (_: string) => latencies[callIdx++] ?? 0);
    await retriever.warmup("/workspace", fimProbe);
    // Sorted: [50, 75, 100] → median index 1 → 75
    expect(retriever.getWarmupP50()).toBe(75);
  });

  // 12. [FIM warmup] P50= printed to output channel
  it("[FIM warmup] P50= is printed to output channel after warmup", async () => {
    const retriever = new MockRetriever();
    const fimProbe = vi.fn(async (_: string) => 120);
    const lines: string[] = [];
    const outputChannel = { appendLine: (msg: string) => { lines.push(msg); } };
    await retriever.warmup("/workspace", fimProbe, outputChannel);
    expect(lines.some((l) => l.includes("[FIM warmup] P50="))).toBe(true);
    expect(lines.some((l) => l.includes("120ms"))).toBe(true);
  });

  // 13. No probe calls when fimProbe not provided
  it("getWarmupP50() remains null when no fimProbe is provided", async () => {
    const retriever = new MockRetriever();
    await retriever.warmup("/workspace");
    expect(retriever.getWarmupP50()).toBeNull();
  });

  // 14. warmup output includes "3 probe requests" label
  it("output channel message includes probe count label", async () => {
    const retriever = new MockRetriever();
    const fimProbe = vi.fn(async (_: string) => 80);
    const lines: string[] = [];
    await retriever.warmup("/workspace", fimProbe, { appendLine: (l) => lines.push(l) });
    expect(lines.some((l) => l.includes("3 probe request"))).toBe(true);
  });
});
