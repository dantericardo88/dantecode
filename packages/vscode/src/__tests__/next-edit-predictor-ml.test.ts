// ============================================================================
// packages/vscode/src/__tests__/next-edit-predictor-ml.test.ts
// 20 tests: ML-backed NextEditPredictor (predictWithModel + predictBest)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextEditPredictor } from "../next-edit-predictor.js";
import type { EditHistoryTracker, EditRecord } from "../edit-history-tracker.js";

// ── Mock VSCode ───────────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  window: {
    activeTextEditor: null,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHistory(overrides?: Partial<EditHistoryTracker>): EditHistoryTracker {
  return {
    getRecent: vi.fn().mockReturnValue([]),
    getAdjacentLinePattern: vi.fn().mockReturnValue(null),
    getColumnPattern: vi.fn().mockReturnValue(null),
    getFilePairPattern: vi.fn().mockReturnValue(null),
    ...overrides,
  } as unknown as EditHistoryTracker;
}

function makeModelRouter(overrides?: Record<string, unknown>) {
  return {
    nextEditModelId: "dante-next-edit",
    ollamaUrl: "http://localhost:11434",
    specDecodeAvailable: false,
    draftModelId: null,
    ...overrides,
  };
}

function makeFetchOk(payload: object): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ response: JSON.stringify(payload) }),
  }) as unknown as typeof globalThis.fetch;
}

function makeFetchError(): typeof globalThis.fetch {
  return vi.fn().mockRejectedValue(new Error("Network error")) as unknown as typeof globalThis.fetch;
}

function makeFetchTimeout(): typeof globalThis.fetch {
  // Rejects when the AbortController fires — simulates a hanging request
  return vi.fn().mockImplementation(
    (_url: unknown, opts?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        const signal = opts?.signal;
        if (signal) {
          if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }
      }),
  ) as unknown as typeof globalThis.fetch;
}

const SAMPLE_EDIT: EditRecord = {
  filePath: "utils.ts",
  range: { startLine: 10, startChar: 0, endLine: 10, endChar: 0 },
  oldText: "const x = 1",
  newText: "const x = 2",
  timestamp: Date.now(),
  changeType: "replace",
};

// ── predictWithModel ──────────────────────────────────────────────────────────

describe("predictWithModel", () => {
  it("calls Ollama with serialized edit history", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 42, endLine: 42, confidence: 0.91 });
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);

    await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "function foo() {}",
      "http://localhost:11434",
      "dante-next-edit",
    );

    expect(fetchFn).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("utils.ts"),
      }),
    );
    predictor.dispose();
  });

  it("includes edit history in the prompt body", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 5, endLine: 5, confidence: 0.85 });
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);

    await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "// context",
      "http://localhost:11434",
      "dante-next-edit",
    );

    const call = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, { body: string }];
    const body = JSON.parse(call[1].body) as { prompt: string };
    expect(body.prompt).toContain("EDIT_HISTORY");
    expect(body.prompt).toContain("utils.ts");
    predictor.dispose();
  });

  it("respects 200ms timeout via AbortController", async () => {
    const fetchFn = makeFetchTimeout();
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);

    // Use real timers but set timeout to be small — test just verifies abort path returns null
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );

    // The fetch mock rejects on abort signal — predictWithModel catches and returns null
    // This test verifies the null-on-abort path (timeout fires in production)
    expect(result).toBeNull();
    predictor.dispose();
  });

  it("returns null on network error", async () => {
    const predictor = new NextEditPredictor(makeHistory(), makeFetchError());
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );
    expect(result).toBeNull();
    predictor.dispose();
  });

  it("returns null on invalid JSON response", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "not json at all" }),
    }) as unknown as typeof globalThis.fetch;
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );
    expect(result).toBeNull();
    predictor.dispose();
  });

  it("returns null on missing startLine field", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", endLine: 42, confidence: 0.9 });
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );
    expect(result).toBeNull();
    predictor.dispose();
  });

  it("clamps confidence to [0.0, 1.0]", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 1, endLine: 1, confidence: 1.5 });
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
    predictor.dispose();
  });

  it("maps ML result to NextEditPrediction with strategy=ml-model", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 42, endLine: 42, confidence: 0.88 });
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );
    expect(result).not.toBeNull();
    expect(result!.strategy).toBe("ml-model");
    expect(result!.line).toBe(42);
    expect(result!.filePath).toBe("utils.ts");
    predictor.dispose();
  });

  it("serializes only last 5 edits from history", async () => {
    const fetchFn = makeFetchOk({ filePath: "f.ts", startLine: 1, endLine: 1, confidence: 0.8 });
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);

    const edits: EditRecord[] = Array.from({ length: 10 }, (_, i) => ({
      ...SAMPLE_EDIT,
      filePath: `file${i}.ts`,
      timestamp: Date.now() + i,
    }));

    await predictor.predictWithModel(edits, "", "http://localhost:11434", "dante-next-edit");

    const call2 = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown, { body: string }];
    const body = JSON.parse(call2[1].body) as { prompt: string };
    // Should only include last 5 files (file5.ts through file9.ts)
    expect(body.prompt).toContain("file9.ts");
    expect(body.prompt).not.toContain("file0.ts");
    predictor.dispose();
  });

  it("handles ```json wrapped model output", async () => {
    const payload = { filePath: "app.ts", startLine: 5, endLine: 5, confidence: 0.82 };
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "```json\n" + JSON.stringify(payload) + "\n```" }),
    }) as unknown as typeof globalThis.fetch;
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );
    expect(result).not.toBeNull();
    expect(result!.line).toBe(5);
    predictor.dispose();
  });

  it("returns null when Ollama returns non-ok status", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof globalThis.fetch;
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);
    const result = await predictor.predictWithModel(
      [SAMPLE_EDIT],
      "",
      "http://localhost:11434",
      "dante-next-edit",
    );
    expect(result).toBeNull();
    predictor.dispose();
  });
});

// ── predictBest ───────────────────────────────────────────────────────────────

describe("predictBest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns heuristic immediately when no modelRouter provided", async () => {
    const history = makeHistory({
      getAdjacentLinePattern: vi.fn().mockReturnValue(null),
      getColumnPattern: vi.fn().mockReturnValue(null),
      getFilePairPattern: vi.fn().mockReturnValue(null),
      getRecent: vi.fn().mockReturnValue([]),
    });
    const predictor = new NextEditPredictor(history);
    const promise = predictor.predictBest("utils.ts", 10, 0);
    vi.runAllTimers();
    const result = await promise;
    expect(result.strategy).not.toBe("ml-model");
    predictor.dispose();
  });

  it("fires ML call after 150ms debounce", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 42, endLine: 42, confidence: 0.91 });
    const history = makeHistory({ getRecent: vi.fn().mockReturnValue([SAMPLE_EDIT]) });
    const predictor = new NextEditPredictor(history, fetchFn);
    const router = makeModelRouter();

    const promise = predictor.predictBest("utils.ts", 10, 0, router as never);
    vi.advanceTimersByTime(160);
    await promise;
    expect(fetchFn).toHaveBeenCalled();
    predictor.dispose();
  });

  it("returns ML result when confidence >= 0.70", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 42, endLine: 42, confidence: 0.91 });
    const history = makeHistory({ getRecent: vi.fn().mockReturnValue([SAMPLE_EDIT]) });
    const predictor = new NextEditPredictor(history, fetchFn);
    const router = makeModelRouter();

    const promise = predictor.predictBest("utils.ts", 10, 0, router as never);
    vi.advanceTimersByTime(200);
    const result = await promise;
    expect(result.strategy).toBe("ml-model");
    expect(result.confidence).toBe(0.91);
    predictor.dispose();
  });

  it("falls back to heuristic when ML confidence < 0.70", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 42, endLine: 42, confidence: 0.50 });
    const history = makeHistory({ getRecent: vi.fn().mockReturnValue([SAMPLE_EDIT]) });
    const predictor = new NextEditPredictor(history, fetchFn);
    const router = makeModelRouter();

    const promise = predictor.predictBest("utils.ts", 10, 0, router as never);
    vi.advanceTimersByTime(200);
    const result = await promise;
    expect(result.strategy).not.toBe("ml-model");
    predictor.dispose();
  });

  it("falls back to heuristic when ML returns null", async () => {
    const predictor = new NextEditPredictor(makeHistory(), makeFetchError());
    const router = makeModelRouter();

    const promise = predictor.predictBest("utils.ts", 10, 0, router as never);
    vi.advanceTimersByTime(200);
    const result = await promise;
    expect(result.strategy).not.toBe("ml-model");
    predictor.dispose();
  });

  it("rapid calls are debounced — ML called once per 150ms window", async () => {
    const fetchFn = makeFetchOk({ filePath: "utils.ts", startLine: 1, endLine: 1, confidence: 0.9 });
    const history = makeHistory({ getRecent: vi.fn().mockReturnValue([SAMPLE_EDIT]) });
    const predictor = new NextEditPredictor(history, fetchFn);
    const router = makeModelRouter();

    // Fire 3 rapid calls: each resets the 150ms debounce timer
    void predictor.predictBest("utils.ts", 10, 0, router as never);
    vi.advanceTimersByTime(50);
    void predictor.predictBest("utils.ts", 11, 0, router as never);
    vi.advanceTimersByTime(50);
    void predictor.predictBest("utils.ts", 12, 0, router as never);
    // Now advance past debounce — only the last call's timer fires
    await vi.runAllTimersAsync();

    // Fetch should only be called once (debounced to last call only)
    expect(fetchFn).toHaveBeenCalledTimes(1);
    predictor.dispose();
  });

  it("dispose() cancels in-flight Ollama request", async () => {
    const fetchFn = makeFetchTimeout();
    const predictor = new NextEditPredictor(makeHistory(), fetchFn);
    const router = makeModelRouter();

    const promise = predictor.predictBest("utils.ts", 10, 0, router as never);
    vi.advanceTimersByTime(160); // trigger debounce
    predictor.dispose();
    vi.advanceTimersByTime(1000);

    // Should resolve (not hang) after dispose
    const result = await promise;
    expect(result).toBeDefined();
  });
});

// ── FimModelRouter spec decode getters ────────────────────────────────────────

describe("FimModelRouter spec decode getters", () => {
  it("specDecodeAvailable = false when no draft model", async () => {
    const { FimModelRouter } = await import("../fim-model-router.js");
    const router = new FimModelRouter();
    expect(router.specDecodeAvailable).toBe(false);
    router.dispose();
  });

  it("nextEditModelId = null before probe", async () => {
    const { FimModelRouter } = await import("../fim-model-router.js");
    const router = new FimModelRouter();
    expect(router.nextEditModelId).toBeNull();
    router.dispose();
  });

  it("probes for draftModel and nextEditModel when configured", async () => {
    const { FimModelRouter } = await import("../fim-model-router.js");
    let callCount = 0;
    const fetchFn = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: async () => ({
          models: [
            { name: "qwen2.5-coder:7b" },
            { name: "qwen2.5-coder:0.5b" },
            { name: "dante-next-edit" },
          ],
        }),
      };
    }) as unknown as typeof globalThis.fetch;

    const router = new FimModelRouter(fetchFn);
    router.startHealthProbe({
      ollamaUrl: "http://localhost:11434",
      localModel: "qwen2.5-coder",
      autoDetect: true,
      draftModel: "qwen2.5-coder:0.5b",
      nextEditModel: "dante-next-edit",
    });

    // Flush all microtasks — the probe does 3 sequential awaited fetches
    // so we need enough microtask ticks for all 3 to complete
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }

    // Should have probed 3 times (main + draft + next-edit)
    expect(callCount).toBeGreaterThanOrEqual(3);
    router.dispose();
  });
});
