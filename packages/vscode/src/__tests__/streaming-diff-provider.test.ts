// ============================================================================
// packages/vscode/src/__tests__/streaming-diff-provider.test.ts
// 18 tests for StreamingDiffProvider.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vscode mock ───────────────────────────────────────────────────────────────

vi.mock("vscode", () => {
  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }
  class EventEmitter<T> {
    private _listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this._listeners.push(listener);
      return { dispose: vi.fn() };
    };
    fire(e: T) {
      for (const l of this._listeners) l(e);
    }
    dispose = vi.fn();
  }
  class CodeLens {
    constructor(
      public range: Range,
      public command?: { title: string; command: string; arguments?: unknown[] },
    ) {}
  }
  class ThemeColor {
    constructor(public id: string) {}
  }
  return {
    Position,
    Range,
    EventEmitter,
    CodeLens,
    ThemeColor,
    window: {
      createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
      visibleTextEditors: [],
    },
    languages: { registerCodeLensProvider: vi.fn(() => ({ dispose: vi.fn() })) },
  };
});

// ── @dantecode/core mock ──────────────────────────────────────────────────────

vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    // Use real parseSearchReplaceBlocks; mock MultiFileDiffSession for isolation
    MultiFileDiffSession: vi.fn().mockImplementation((blocks: unknown[]) => ({
      blocks,
      pendingBlocks: blocks,
      allSettled: false,
      affectedFiles: [],
      applyBlock: vi.fn(),
      rejectBlock: vi.fn(),
      applyAll: vi.fn(),
      rejectAll: vi.fn(),
    })),
  };
});

import { StreamingDiffProvider } from "../streaming-diff-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

type FakeEditor = {
  document: {
    uri: { fsPath: string };
    getText: () => string;
    positionAt: (offset: number) => { line: number; character: number };
  };
  setDecorations: ReturnType<typeof vi.fn>;
};

function makeEditor(fsPath: string, content = ""): FakeEditor {
  return {
    document: {
      uri: { fsPath },
      getText: () => content,
      positionAt: (offset: number) => ({ line: 0, character: offset }),
    },
    setDecorations: vi.fn(),
  };
}

function srBlock(file: string, search: string, replace: string): string {
  return `${file}\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
}

function makeProvider(
  editors: FakeEditor[] = [],
  createDecorationType?: ReturnType<typeof vi.fn>,
): StreamingDiffProvider {
  const dt = createDecorationType ?? vi.fn(() => ({ dispose: vi.fn() }));
  return new StreamingDiffProvider({} as import("vscode").ExtensionContext, {
    createDecorationType: dt as unknown as (
      opts: import("vscode").DecorationRenderOptions,
    ) => import("vscode").TextEditorDecorationType,
    getVisibleEditors: () =>
      editors as unknown as readonly import("vscode").TextEditor[],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("StreamingDiffProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── feedChunk ──────────────────────────────────────────────────────────────

  it("feedChunk with a complete block returns that block", () => {
    const provider = makeProvider();
    const blocks = provider.feedChunk(srBlock("src/app.ts", "old", "new"));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.filePath).toBe("src/app.ts");
    expect(blocks[0]!.searchContent).toBe("old");
  });

  it("block split across two chunks is detected after the second chunk", () => {
    const provider = makeProvider();
    const text = srBlock("f.ts", "old", "new");
    const mid = Math.floor(text.length / 2);
    const first = provider.feedChunk(text.slice(0, mid));
    const second = provider.feedChunk(text.slice(mid));
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
  });

  it("three blocks in one response are all returned", () => {
    const provider = makeProvider();
    const text =
      srBlock("a.ts", "a", "A") + "\n" + srBlock("b.ts", "b", "B") + "\n" + srBlock("c.ts", "c", "C");
    const blocks = provider.feedChunk(text);
    expect(blocks).toHaveLength(3);
  });

  it("feedChunk with empty string returns no blocks", () => {
    const provider = makeProvider();
    expect(provider.feedChunk("")).toHaveLength(0);
  });

  it("feedChunk with plain prose returns no blocks", () => {
    const provider = makeProvider();
    expect(provider.feedChunk("Just some prose, no blocks.")).toHaveLength(0);
  });

  // ── finalizeStream ─────────────────────────────────────────────────────────

  it("finalizeStream returns null when no blocks were found", () => {
    const provider = makeProvider();
    provider.feedChunk("plain text");
    expect(provider.finalizeStream()).toBeNull();
  });

  it("finalizeStream returns a session when blocks were found", () => {
    const provider = makeProvider();
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    expect(provider.finalizeStream()).not.toBeNull();
  });

  it("finalizeStream resets the parser — second call with no new input returns null", () => {
    const provider = makeProvider();
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    provider.finalizeStream();
    expect(provider.finalizeStream()).toBeNull();
  });

  // ── activeSession ──────────────────────────────────────────────────────────

  it("activeSession is null before finalizeStream", () => {
    const provider = makeProvider();
    expect(provider.activeSession).toBeNull();
  });

  it("activeSession is non-null after finalizeStream with blocks", () => {
    const provider = makeProvider();
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    provider.finalizeStream();
    expect(provider.activeSession).not.toBeNull();
  });

  // ── clearSession ───────────────────────────────────────────────────────────

  it("clearSession sets activeSession to null", () => {
    const provider = makeProvider();
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    provider.finalizeStream();
    provider.clearSession();
    expect(provider.activeSession).toBeNull();
  });

  it("clearSession disposes all created decoration types", () => {
    const disposeFn = vi.fn();
    const createDt = vi.fn(() => ({ dispose: disposeFn }));
    const editor = makeEditor("/workspace/src/app.ts", "old content here");
    const provider = makeProvider([editor], createDt);

    provider.feedChunk(srBlock("src/app.ts", "old", "new"));
    const createdCount = createDt.mock.calls.length;
    provider.clearSession();

    // dispose should be called once per created decoration type
    expect(disposeFn).toHaveBeenCalledTimes(createdCount);
  });

  // ── CodeLens ───────────────────────────────────────────────────────────────

  it("provideCodeLenses returns two lenses per detected block", () => {
    const provider = makeProvider();
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    expect(provider.provideCodeLenses()).toHaveLength(2);
  });

  it("accept CodeLens title contains 'Accept'", () => {
    const provider = makeProvider();
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    const lenses = provider.provideCodeLenses();
    expect(lenses.some((l) => l.command?.title.includes("Accept"))).toBe(true);
  });

  it("reject CodeLens title contains 'Reject'", () => {
    const provider = makeProvider();
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    const lenses = provider.provideCodeLenses();
    expect(lenses.some((l) => l.command?.title.includes("Reject"))).toBe(true);
  });

  it("onDidChangeCodeLenses fires when a new block arrives", () => {
    const provider = makeProvider();
    const listener = vi.fn();
    provider.onDidChangeCodeLenses(listener);
    provider.feedChunk(srBlock("f.ts", "old", "new"));
    expect(listener).toHaveBeenCalled();
  });

  // ── dispose ────────────────────────────────────────────────────────────────

  it("dispose does not throw even with no active decorations", () => {
    const provider = makeProvider();
    expect(() => provider.dispose()).not.toThrow();
  });

  it("createDecorationType is called when a block matches an open editor", () => {
    const createDt = vi.fn(() => ({ dispose: vi.fn() }));
    const editor = makeEditor("/workspace/src/app.ts", "old content here");
    const provider = makeProvider([editor], createDt);

    provider.feedChunk(srBlock("src/app.ts", "old", "new"));
    expect(createDt).toHaveBeenCalled();
  });

  it("decoration uses diffEditor.removedLineBackground theme color", () => {
    let capturedOpts: import("vscode").DecorationRenderOptions | null = null;
    const createDt = vi.fn((opts: import("vscode").DecorationRenderOptions) => {
      capturedOpts = opts;
      return { dispose: vi.fn() };
    });
    const editor = makeEditor("/workspace/src/app.ts", "old content here");
    const provider = makeProvider([editor], createDt);

    provider.feedChunk(srBlock("src/app.ts", "old", "new"));

    expect(capturedOpts).not.toBeNull();
    const bg = (capturedOpts as import("vscode").DecorationRenderOptions).backgroundColor;
    expect((bg as { id: string }).id).toBe("diffEditor.removedLineBackground");
  });
});
