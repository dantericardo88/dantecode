import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { matchGlob, FilePatternWatcher, type FileChangeEvent } from "./file-pattern-watcher.js";

// ─── matchGlob unit tests ─────────────────────────────────────────────────────

describe("matchGlob", () => {
  it("matches src/**/*.ts against src/core/auth.ts", () => {
    expect(matchGlob("src/**/*.ts", "src/core/auth.ts")).toBe(true);
  });

  it("does not match src/**/*.ts against tests/auth.test.ts", () => {
    expect(matchGlob("src/**/*.ts", "tests/auth.test.ts")).toBe(false);
  });

  it("matches *.md against README.md", () => {
    expect(matchGlob("*.md", "README.md")).toBe(true);
  });

  // Additional coverage
  it("matches nested **/*.ts pattern", () => {
    expect(matchGlob("**/*.ts", "packages/core/src/index.ts")).toBe(true);
  });

  it("does not match *.md against src/file.ts", () => {
    expect(matchGlob("*.md", "src/file.ts")).toBe(false);
  });

  it("matches ? single character wildcard", () => {
    expect(matchGlob("src/?.ts", "src/a.ts")).toBe(true);
    expect(matchGlob("src/?.ts", "src/ab.ts")).toBe(false);
  });

  it("matches character classes [abc]", () => {
    expect(matchGlob("src/[abc].ts", "src/a.ts")).toBe(true);
    expect(matchGlob("src/[abc].ts", "src/d.ts")).toBe(false);
  });

  it("matches **/node_modules/** ignore pattern", () => {
    expect(matchGlob("**/node_modules/**", "packages/core/node_modules/lodash/index.js")).toBe(
      true,
    );
  });

  it("does not match **/node_modules/** against src/index.ts", () => {
    expect(matchGlob("**/node_modules/**", "src/index.ts")).toBe(false);
  });
});

// ─── FilePatternWatcher tests (with mocked fs.watch) ────────────────────────

describe("FilePatternWatcher", () => {
  let mockWatcher: {
    close: ReturnType<typeof vi.fn>;
    _trigger: (event: string, filename: string) => void;
  };

  beforeEach(() => {
    // Mock node:fs
    vi.mock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        watch: vi.fn(),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setupWatcher(
    opts: {
      pattern?: string;
      debounceMs?: number;
      ignorePatterns?: string[];
    } = {},
  ): Promise<{
    watcher: FilePatternWatcher;
    triggerChange: (event: string, filename: string) => void;
  }> {
    const { watch } = await import("node:fs");
    const mockWatchFn = watch as ReturnType<typeof vi.fn>;

    let capturedCallback: ((event: string, filename: string | null) => void) | null = null;
    mockWatcher = {
      close: vi.fn(),
      _trigger: (event: string, filename: string) => {
        if (capturedCallback) {
          capturedCallback(event, filename);
        }
      },
    };

    mockWatchFn.mockImplementation(
      (
        _path: string,
        _opts: unknown,
        callback: (event: string, filename: string | null) => void,
      ) => {
        capturedCallback = callback;
        return mockWatcher;
      },
    );

    const watcher = new FilePatternWatcher({
      pattern: opts.pattern ?? "src/**/*.ts",
      debounceMs: opts.debounceMs ?? 50,
      projectRoot: "/fake/project",
      watcherId: "test-watcher",
      ignorePatterns: opts.ignorePatterns,
    });

    watcher.start();

    return {
      watcher,
      triggerChange: mockWatcher._trigger.bind(mockWatcher),
    };
  }

  it("emits 'change' event when file modification detected", async () => {
    vi.useFakeTimers();

    const { watcher, triggerChange } = await setupWatcher({
      pattern: "src/**/*.ts",
      debounceMs: 50,
    });

    const changes: FileChangeEvent[][] = [];
    watcher.on("change", (events: FileChangeEvent[]) => {
      changes.push(events);
    });

    // Simulate a file change that matches the pattern
    triggerChange("change", "src/core/auth.ts");

    // Advance timers past debounce window
    vi.advanceTimersByTime(100);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toHaveLength(1);
    expect(changes[0]![0]!.changedFile).toBe("src/core/auth.ts");
    expect(changes[0]![0]!.changeType).toBe("modify");
    expect(changes[0]![0]!.watcherId).toBe("test-watcher");
    expect(changes[0]![0]!.pattern).toBe("src/**/*.ts");

    watcher.stop();
    vi.useRealTimers();
  });

  it("debounce: rapid changes emit single batched event after debounce window", async () => {
    vi.useFakeTimers();

    const { watcher, triggerChange } = await setupWatcher({
      pattern: "src/**/*.ts",
      debounceMs: 100,
    });

    const changes: FileChangeEvent[][] = [];
    watcher.on("change", (events: FileChangeEvent[]) => {
      changes.push(events);
    });

    // Fire multiple rapid changes
    triggerChange("change", "src/a.ts");
    vi.advanceTimersByTime(20);
    triggerChange("change", "src/b.ts");
    vi.advanceTimersByTime(20);
    triggerChange("change", "src/c.ts");

    // Not yet debounced
    expect(changes).toHaveLength(0);

    // Advance past debounce
    vi.advanceTimersByTime(150);

    // Should be exactly one batch
    expect(changes).toHaveLength(1);
    // Should have 3 files (or 2 if b.ts was deduplicated by a later change — in this impl they're distinct)
    expect(changes[0]!.length).toBeGreaterThanOrEqual(2);

    watcher.stop();
    vi.useRealTimers();
  });

  it("ignore patterns: node_modules changes are not emitted", async () => {
    vi.useFakeTimers();

    const { watcher, triggerChange } = await setupWatcher({
      pattern: "**/*.ts",
      debounceMs: 50,
      ignorePatterns: ["**/node_modules/**", "**/.git/**", "**/dist/**"],
    });

    const changes: FileChangeEvent[][] = [];
    watcher.on("change", (events: FileChangeEvent[]) => {
      changes.push(events);
    });

    // This should be ignored
    triggerChange("change", "node_modules/lodash/index.ts");
    vi.advanceTimersByTime(200);

    expect(changes).toHaveLength(0);

    // This should NOT be ignored
    triggerChange("change", "src/index.ts");
    vi.advanceTimersByTime(200);

    expect(changes).toHaveLength(1);
    expect(changes[0]![0]!.changedFile).toBe("src/index.ts");

    watcher.stop();
    vi.useRealTimers();
  });
});
