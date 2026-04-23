import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── VS Code mock ──────────────────────────────────────────────────────────────
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, defaultVal: unknown) => {
        if (key === "codebaseIndex.embeddingProvider") return "none";
        if (key === "codebaseIndex.maxChunkLines") return 200;
        return defaultVal;
      }),
    })),
  },
}));

// ── @dantecode/core mock ──────────────────────────────────────────────────────

let mockCodeIndexInstance: {
  load: ReturnType<typeof vi.fn>;
  buildIndex: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  incrementalUpdate: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  size: number;
};

vi.mock("@dantecode/core", () => {
  const CodeIndex = vi.fn().mockImplementation(() => mockCodeIndexInstance);
  const createEmbeddingProvider = vi.fn().mockReturnValue(null);
  return { CodeIndex, createEmbeddingProvider };
});

import { CodebaseIndexManager, type IndexState } from "../codebase-index-manager.js";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("CodebaseIndexManager", () => {
  let mgr: CodebaseIndexManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCodeIndexInstance = {
      load: vi.fn().mockResolvedValue(false),
      buildIndex: vi.fn().mockResolvedValue(5),
      save: vi.fn().mockResolvedValue(undefined),
      incrementalUpdate: vi.fn().mockResolvedValue(3),
      search: vi.fn().mockReturnValue([{ filePath: "foo.ts", startLine: 1, endLine: 10, content: "code", symbols: ["foo"] }]),
      size: 5,
    };
    mgr = new CodebaseIndexManager("/project");
  });

  afterEach(() => {
    mgr.dispose();
  });

  // ── initialize() ─────────────────────────────────────────────────────────

  it("initialize() tries load() before buildIndex()", async () => {
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();
    expect(mockCodeIndexInstance.load).toHaveBeenCalledWith("/project");
    expect(mockCodeIndexInstance.buildIndex).not.toHaveBeenCalled();
  });

  it("initialize() sets state to 'ready' immediately when load succeeds", async () => {
    mockCodeIndexInstance.load.mockResolvedValue(true);
    mockCodeIndexInstance.size = 42;
    await mgr.initialize();
    expect(mgr.currentState).toBe("ready");
    expect(mgr.indexedChunkCount).toBe(42);
  });

  it("initialize() falls back to buildIndex() when load returns false", async () => {
    mockCodeIndexInstance.load.mockResolvedValue(false);
    // Let build settle
    const buildDone = new Promise<void>((resolve) => {
      mockCodeIndexInstance.buildIndex.mockImplementation(async () => { resolve(); return 5; });
    });
    await mgr.initialize();
    await buildDone;
    expect(mockCodeIndexInstance.buildIndex).toHaveBeenCalledOnce();
  });

  it("initialize() is non-blocking — returns before buildIndex() completes", async () => {
    let buildResolve!: () => void;
    mockCodeIndexInstance.buildIndex.mockReturnValue(
      new Promise<void>((resolve) => { buildResolve = resolve; }),
    );
    // initialize() must resolve even though buildIndex is still pending
    await expect(mgr.initialize()).resolves.toBeUndefined();
    expect(mockCodeIndexInstance.buildIndex).toHaveBeenCalled();
    // Cleanup — resolve so no unhandled rejection
    buildResolve();
  });

  it("initialize({ force: true }) skips load() and always calls buildIndex()", async () => {
    mockCodeIndexInstance.load.mockResolvedValue(true);
    const buildDone = new Promise<void>((resolve) => {
      mockCodeIndexInstance.buildIndex.mockImplementation(async () => { resolve(); return 5; });
    });
    await mgr.initialize({ force: true });
    await buildDone;
    expect(mockCodeIndexInstance.load).not.toHaveBeenCalled();
    expect(mockCodeIndexInstance.buildIndex).toHaveBeenCalledOnce();
  });

  // ── search() ──────────────────────────────────────────────────────────────

  it("search() returns [] when state is not 'ready'", async () => {
    // No initialize — state is "idle"
    const result = await mgr.search("foo");
    expect(result).toEqual([]);
    expect(mockCodeIndexInstance.search).not.toHaveBeenCalled();
  });

  it("search() delegates to CodeIndex.search() when ready", async () => {
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();
    const results = await mgr.search("authentication");
    // search() now calls codeIndex with limit * 2 for RRF fusion headroom
    expect(mockCodeIndexInstance.search).toHaveBeenCalledWith("authentication", 16);
    expect(results).toHaveLength(1);
  });

  it("search() uses default limit of 8 (calls codeIndex with limit*2=16 for RRF headroom)", async () => {
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();
    await mgr.search("query");
    expect(mockCodeIndexInstance.search).toHaveBeenCalledWith("query", 16);
  });

  it("search() respects custom limit argument (passes limit*2 to codeIndex)", async () => {
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();
    await mgr.search("query", 3);
    expect(mockCodeIndexInstance.search).toHaveBeenCalledWith("query", 6);
  });

  // ── onFileSaved() ─────────────────────────────────────────────────────────

  it("onFileSaved() does nothing when state is not 'ready'", async () => {
    vi.useFakeTimers();
    mgr.onFileSaved("/project/src/foo.ts");
    vi.runAllTimers();
    expect(mockCodeIndexInstance.incrementalUpdate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("onFileSaved() triggers incrementalUpdate() after 300ms debounce", async () => {
    vi.useFakeTimers();
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();

    mgr.onFileSaved("/project/src/foo.ts");
    expect(mockCodeIndexInstance.incrementalUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);
    // Allow promise microtasks to settle
    await vi.runAllTimersAsync();
    expect(mockCodeIndexInstance.incrementalUpdate).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("onFileSaved() debounces — 2 rapid saves produce exactly 1 update", async () => {
    vi.useFakeTimers();
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();

    mgr.onFileSaved("/project/src/a.ts");
    await vi.advanceTimersByTimeAsync(100);
    mgr.onFileSaved("/project/src/b.ts");
    await vi.runAllTimersAsync();

    expect(mockCodeIndexInstance.incrementalUpdate).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  // ── State transitions ─────────────────────────────────────────────────────

  it("state transitions: idle → indexing → ready on successful build", async () => {
    const states: IndexState[] = [];
    mgr.onStateChange((s) => states.push(s));

    const buildDone = new Promise<void>((resolve) => {
      mockCodeIndexInstance.buildIndex.mockImplementation(async () => { resolve(); return 5; });
    });
    await mgr.initialize();
    await buildDone;
    // Give the _runBuild promise chain time to settle
    // Uses 200ms to account for _indexNotebooks() async I/O under parallel test load
    await new Promise((r) => setTimeout(r, 200));

    expect(states[0]).toBe("indexing");
    expect(states[states.length - 1]).toBe("ready");
  });

  it("state transitions: indexing → error when buildIndex() throws", async () => {
    const states: IndexState[] = [];
    mgr.onStateChange((s) => states.push(s));

    const buildFailed = new Promise<void>((resolve) => {
      mockCodeIndexInstance.buildIndex.mockImplementation(async () => {
        resolve();
        throw new Error("disk full");
      });
    });
    await mgr.initialize();
    await buildFailed;
    await new Promise((r) => setTimeout(r, 10));

    expect(states[0]).toBe("indexing");
    expect(states[states.length - 1]).toBe("error");
  });

  it("state stays 'ready' during incremental update (no flicker)", async () => {
    vi.useFakeTimers();
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();

    const states: IndexState[] = [];
    mgr.onStateChange((s) => states.push(s));

    mgr.onFileSaved("/project/src/foo.ts");
    await vi.runAllTimersAsync();

    // incrementalUpdate fires but state callback should NOT have received "indexing"
    expect(states).not.toContain("indexing");
    vi.useRealTimers();
  });

  // ── dispose() ─────────────────────────────────────────────────────────────

  it("dispose() cancels pending debounce timer", async () => {
    vi.useFakeTimers();
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();

    mgr.onFileSaved("/project/src/foo.ts");
    mgr.dispose();
    await vi.runAllTimersAsync();

    expect(mockCodeIndexInstance.incrementalUpdate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // ── Embedding provider ────────────────────────────────────────────────────

  it("embedding provider is null when config is 'none'", async () => {
    const { createEmbeddingProvider } = await import("@dantecode/core");
    mockCodeIndexInstance.load.mockResolvedValue(true);
    await mgr.initialize();
    expect(createEmbeddingProvider).not.toHaveBeenCalled();
  });

  // ── chunkCount and save ───────────────────────────────────────────────────

  it("chunkCount reflects codeIndex.size after successful build", async () => {
    mockCodeIndexInstance.size = 99;
    const buildDone = new Promise<void>((resolve) => {
      mockCodeIndexInstance.buildIndex.mockImplementation(async () => { resolve(); return 99; });
    });
    await mgr.initialize();
    await buildDone;
    await new Promise((r) => setTimeout(r, 10));
    expect(mgr.indexedChunkCount).toBe(99);
  });

  it("initialize() calls save() after successful buildIndex()", async () => {
    const buildDone = new Promise<void>((resolve) => {
      mockCodeIndexInstance.buildIndex.mockImplementation(async () => { resolve(); return 5; });
    });
    await mgr.initialize();
    await buildDone;
    await new Promise((r) => setTimeout(r, 10));
    expect(mockCodeIndexInstance.save).toHaveBeenCalledWith("/project");
  });

  it("onStateChange() callback is invoked on each state transition", async () => {
    const calls: [IndexState, number][] = [];
    mgr.onStateChange((s, c) => calls.push([s, c]));

    mockCodeIndexInstance.load.mockResolvedValue(true);
    mockCodeIndexInstance.size = 7;
    await mgr.initialize();

    // Should have fired: "indexing" then "ready"
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]![0]).toBe("indexing");
    expect(calls[calls.length - 1]![0]).toBe("ready");
    expect(calls[calls.length - 1]![1]).toBe(7);
  });
});
