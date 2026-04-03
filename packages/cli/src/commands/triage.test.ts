import { describe, it, expect, vi, beforeEach } from "vitest";

// ────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────

const mockGetIssue = vi.fn();
const mockAddLabels = vi.fn();
const mockInferFromGitRemote = vi.fn().mockResolvedValue(undefined);

vi.mock("@dantecode/core", () => ({
  GitHubClient: vi.fn().mockImplementation(() => ({
    inferFromGitRemote: mockInferFromGitRemote,
    getIssue: mockGetIssue,
    addLabels: mockAddLabels,
  })),
  buildRepoMap: vi.fn().mockResolvedValue([
    { filePath: "src/auth/login.ts", score: 10, symbols: [] },
    { filePath: "src/utils/helpers.ts", score: 5, symbols: [] },
  ]),
  ModelRouterImpl: vi.fn().mockImplementation(() => ({
    generate: vi
      .fn()
      .mockResolvedValue(
        '{"labels":["bug"],"priority":"P1","effort":"M","canAutoResolve":false,"confidence":0.85,"reasoning":"LLM classified as a bug."}',
      ),
  })),
  readOrInitializeState: vi.fn().mockResolvedValue({
    model: {
      default: "claude-sonnet-4-6",
      fallback: "claude-haiku-4-5-20251001",
      taskOverrides: {},
    },
  }),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

function makeIssue(
  overrides: Partial<import("@dantecode/core").GitHubIssue> = {},
): import("@dantecode/core").GitHubIssue {
  return {
    number: 42,
    title: "Fix login crash",
    state: "open",
    body: "The login page crashes when the user submits an empty form.",
    labels: [],
    url: "https://github.com/org/repo/issues/42",
    author: "tester",
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────

describe("triageIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInferFromGitRemote.mockResolvedValue(undefined);
    mockAddLabels.mockResolvedValue(undefined);
  });

  it("returns heuristic result when useLLM=false", async () => {
    mockGetIssue.mockResolvedValue(makeIssue());
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(42, "/proj", { useLLM: false });
    expect(result.issueNumber).toBe(42);
    expect(result.title).toBe("Fix login crash");
    // heuristic confidence is now calibrated (not static 0.5)
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.75);
    expect(result.postedToGitHub).toBe(false);
  });

  it("classifies 'crash' in body as P0 (crash = critical)", async () => {
    mockGetIssue.mockResolvedValue(makeIssue({ body: "App crashes on startup." }));
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(1, "/proj", { useLLM: false });
    expect(result.suggestedLabels).toContain("bug");
    expect(result.priority).toBe("P0");
  });

  it("classifies 'error' without crash as P1 bug", async () => {
    mockGetIssue.mockResolvedValue(makeIssue({ body: "Throws an error when saving." }));
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(1, "/proj", { useLLM: false });
    expect(result.suggestedLabels).toContain("bug");
    expect(result.priority).toBe("P1");
  });

  it("classifies 'security vulnerability' as P0", async () => {
    mockGetIssue.mockResolvedValue(
      makeIssue({ title: "Security vulnerability in auth", body: "SQL injection found." }),
    );
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(2, "/proj", { useLLM: false });
    expect(result.priority).toBe("P0");
    expect(result.suggestedLabels).toContain("security");
    expect(result.canAutoResolve).toBe(false); // P0 → never auto-resolve
  });

  it("classifies 'add feature request' as P2", async () => {
    mockGetIssue.mockResolvedValue(
      makeIssue({ title: "Feature request: add dark mode", body: "Would like dark mode support." }),
    );
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(3, "/proj", { useLLM: false });
    expect(result.priority).toBe("P2");
    expect(result.suggestedLabels).toContain("feature");
  });

  it("postLabels=true calls addLabels and sets postedToGitHub=true", async () => {
    mockGetIssue.mockResolvedValue(makeIssue());
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(42, "/proj", { postLabels: true, useLLM: false });
    expect(mockAddLabels).toHaveBeenCalled();
    expect(result.postedToGitHub).toBe(true);
  });

  it("postLabels=true but addLabels throws → postedToGitHub=false, no throw", async () => {
    mockGetIssue.mockResolvedValue(makeIssue());
    mockAddLabels.mockRejectedValue(new Error("API error"));
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(42, "/proj", { postLabels: true, useLLM: false });
    expect(result.postedToGitHub).toBe(false);
  });

  it("LLM refinement raises confidence above heuristic baseline", async () => {
    mockGetIssue.mockResolvedValue(makeIssue());
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(42, "/proj", { useLLM: true });
    // LLM mock returns confidence: 0.85
    expect(result.confidence).toBe(0.85);
    expect(result.reasoning).toBe("LLM classified as a bug.");
  });

  it("LLM error falls back to heuristic (calibrated confidence)", async () => {
    mockGetIssue.mockResolvedValue(makeIssue());
    const { ModelRouterImpl } = await import("@dantecode/core");
    (ModelRouterImpl as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      generate: vi.fn().mockRejectedValue(new Error("LLM unavailable")),
    }));
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(42, "/proj", { useLLM: true });
    // heuristic confidence is now calibrated (not static 0.5)
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(0.75);
  });

  it("relevantFiles matches filenames containing issue keywords", async () => {
    mockGetIssue.mockResolvedValue(
      makeIssue({ title: "Login page bug", body: "The login form fails." }),
    );
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(42, "/proj", { useLLM: false });
    // buildRepoMap mock returns "src/auth/login.ts" — "login" is in title
    expect(result.relevantFiles).toContain("src/auth/login.ts");
  });

  it("security+crash issue → confidence > 0.6 (calibrated, not static 0.5)", async () => {
    mockGetIssue.mockResolvedValue(
      makeIssue({
        title: "Security vulnerability: crash on login",
        body: "App crashes and exposes security vulnerability in auth module.",
      }),
    );
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(1, "/proj", { useLLM: false });
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.priority).toBe("P0");
  });

  it("malformed LLM JSON with invalid priority 'P5' falls back to heuristic priority", async () => {
    mockGetIssue.mockResolvedValue(makeIssue({ body: "App crashes badly." }));
    const { ModelRouterImpl } = await import("@dantecode/core");
    (ModelRouterImpl as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      generate: vi
        .fn()
        .mockResolvedValue(
          '{"labels":["bug"],"priority":"P5","effort":"M","canAutoResolve":false,"confidence":0.9,"reasoning":"test"}',
        ),
    }));
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(1, "/proj", { useLLM: true });
    // P5 is invalid → falls back to heuristic priority (P0 because "crashes")
    expect(["P0", "P1", "P2", "P3"]).toContain(result.priority);
    expect(result.priority).not.toBe("P5" as any);
  });

  it("empty issue body → no crash, heuristic runs cleanly", async () => {
    mockGetIssue.mockResolvedValue(makeIssue({ body: "", title: "Something happened" }));
    const { triageIssue } = await import("./triage.js");
    await expect(triageIssue(1, "/proj", { useLLM: false })).resolves.toBeDefined();
  });

  it("LLM returns confidence > 1.0 → clamped to 1.0", async () => {
    mockGetIssue.mockResolvedValue(makeIssue());
    const { ModelRouterImpl } = await import("@dantecode/core");
    (ModelRouterImpl as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      generate: vi
        .fn()
        .mockResolvedValue(
          '{"labels":["bug"],"priority":"P1","effort":"M","canAutoResolve":false,"confidence":1.5,"reasoning":"very confident"}',
        ),
    }));
    const { triageIssue } = await import("./triage.js");
    const result = await triageIssue(1, "/proj", { useLLM: true });
    expect(result.confidence).toBeLessThanOrEqual(1.0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("DANTECODE_DEBUG=1 writes to stderr when buildRepoMap fails", async () => {
    const originalDebug = process.env["DANTECODE_DEBUG"];
    process.env["DANTECODE_DEBUG"] = "1";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockGetIssue.mockResolvedValue(makeIssue());
    const { buildRepoMap } = await import("@dantecode/core");
    (buildRepoMap as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk full"));
    const { triageIssue } = await import("./triage.js");
    await triageIssue(1, "/proj", { useLLM: false });
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("buildRepoMap failed"));
    stderrSpy.mockRestore();
    if (originalDebug === undefined) delete process.env["DANTECODE_DEBUG"];
    else process.env["DANTECODE_DEBUG"] = originalDebug;
  });
});

describe("formatTriageOutput", () => {
  it("includes priority and effort", async () => {
    const { formatTriageOutput } = await import("./triage.js");
    const result = {
      issueNumber: 5,
      title: "Something broke",
      suggestedLabels: ["bug"],
      priority: "P1" as const,
      effort: "M" as const,
      relevantFiles: ["src/foo.ts"],
      canAutoResolve: false,
      confidence: 0.8,
      reasoning: "Looks like a medium bug.",
      postedToGitHub: false,
    };
    const output = formatTriageOutput(result);
    const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(clean).toContain("Issue #5");
    expect(clean).toContain("P1");
    expect(clean).toContain("Medium");
    expect(clean).toContain("src/foo.ts");
  });
});

describe("runTriageCommand", () => {
  it("prints help when no args", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runTriageCommand } = await import("./triage.js");
    await runTriageCommand([], "/proj");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("errors on non-numeric issue arg", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runTriageCommand } = await import("./triage.js");
    await runTriageCommand(["notanumber"], "/proj");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("positive integer"));
    consoleSpy.mockRestore();
  });
});
