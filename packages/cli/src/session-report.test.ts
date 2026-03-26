// ============================================================================
// Tests: session-report.ts
// Proves that PDSE verification results appear in REPL session run reports.
// Gap FC-2: the core product trust promise (PDSE score) was previously absent
// from plain REPL session reports - only mutation counts were included.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Mock @dantecode/core so we can intercept writeRunReport and accumulator calls
// without touching the filesystem.
// ---------------------------------------------------------------------------

vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    writeRunReport: vi.fn().mockResolvedValue("/tmp/test/.dantecode/reports/run-test.md"),
  };
});

import { generateSessionReport, shouldGenerateSessionReport } from "./session-report.js";
import { writeRunReport } from "@dantecode/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(mutationCount: number): Session {
  const messages: Session["messages"] = [];
  for (let i = 0; i < mutationCount; i++) {
    messages.push({
      id: `msg-${i}`,
      role: "assistant" as const,
      content: "done",
      toolUse: { name: "Write", input: {}, id: `tool-${i}` },
      tokensUsed: 100,
      timestamp: new Date().toISOString(),
    });
  }
  return {
    id: "sess-1",
    projectRoot: "/tmp/test",
    messages,
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "grok",
      modelId: "grok-3",
      maxTokens: 8192,
      temperature: 0.1,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: true,
    },
    agentStack: [],
    todoList: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function baseCtx(session: Session) {
  return {
    session,
    projectRoot: "/tmp/test",
    modelId: "grok-3",
    provider: "grok",
    dantecodeVersion: "1.0.0",
    sessionDurationMs: 10_000,
  };
}

// ---------------------------------------------------------------------------
// shouldGenerateSessionReport
// ---------------------------------------------------------------------------

describe("shouldGenerateSessionReport", () => {
  it("returns false when session has no mutation tool calls", () => {
    const session = makeSession(0);
    expect(shouldGenerateSessionReport(session)).toBe(false);
  });

  it("returns true when session has at least one mutation tool call", () => {
    const session = makeSession(1);
    expect(shouldGenerateSessionReport(session)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateSessionReport - no PDSE results
// ---------------------------------------------------------------------------

describe("generateSessionReport - without pdseResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeRunReport).mockResolvedValue("/tmp/test/.dantecode/reports/run-test.md");
  });

  it("returns null for sessions with no mutations", async () => {
    const result = await generateSessionReport(baseCtx(makeSession(0)));
    expect(result).toBeNull();
  });

  it("writes a report and returns the path when mutations exist", async () => {
    const result = await generateSessionReport(baseCtx(makeSession(2)));
    expect(result).toBe("/tmp/test/.dantecode/reports/run-test.md");
    expect(vi.mocked(writeRunReport)).toHaveBeenCalledOnce();
  });

  it("report markdown includes mutation count summary", async () => {
    await generateSessionReport(baseCtx(makeSession(3)));
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).toContain("3 file operation(s)");
  });

  it("report markdown does NOT include PDSE line when no results", async () => {
    await generateSessionReport(baseCtx(makeSession(1)));
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).not.toContain("PDSE");
  });

  it("marks unverified mutation sessions as partial instead of complete", async () => {
    await generateSessionReport(baseCtx(makeSession(2)));
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).toContain("### REPL Session");
    expect(call.markdown).toContain("PARTIAL");
    expect(call.markdown).toContain("**Execution truth:** applied");
    expect(call.markdown).toContain("applied without verification");
    expect(call.markdown).not.toContain("COMPLETE");
  });
});

// ---------------------------------------------------------------------------
// generateSessionReport - WITH pdseResults
// Gap FC-2 / Gap #1 closure: PDSE score MUST appear in REPL session reports.
// ---------------------------------------------------------------------------

describe("generateSessionReport - with pdseResults (Gap FC-2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeRunReport).mockResolvedValue("/tmp/test/.dantecode/reports/run-test.md");
  });

  it("includes PDSE score in the report when all files pass", async () => {
    const pdseResults = [
      { file: "src/auth.ts", pdseScore: 92, passed: true },
      { file: "src/utils.ts", pdseScore: 88, passed: true },
    ];
    await generateSessionReport({ ...baseCtx(makeSession(2)), pdseResults });
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).toContain("PDSE");
    expect(call.markdown).toContain("90");
  });

  it("marks verification failure explicitly when any file fails PDSE", async () => {
    const pdseResults = [
      { file: "src/stub.ts", pdseScore: 40, passed: false },
      { file: "src/ok.ts", pdseScore: 88, passed: true },
    ];
    await generateSessionReport({ ...baseCtx(makeSession(2)), pdseResults });
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).toContain("FAILED");
    expect(call.markdown).toContain("**Execution truth:** applied -> failed");
    expect(call.markdown).toContain("need attention");
  });

  it("includes verified execution truth when all files pass", async () => {
    const pdseResults = [{ file: "src/app.ts", pdseScore: 95, passed: true }];
    await generateSessionReport({ ...baseCtx(makeSession(1)), pdseResults });
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).toContain("COMPLETE");
    expect(call.markdown).toContain("**Execution truth:** applied -> verified");
    expect(call.markdown).toContain("verified");
  });

  it("correctly averages PDSE score across multiple files", async () => {
    const pdseResults = [
      { file: "a.ts", pdseScore: 80, passed: true },
      { file: "b.ts", pdseScore: 90, passed: true },
      { file: "c.ts", pdseScore: 100, passed: true },
    ];
    await generateSessionReport({ ...baseCtx(makeSession(3)), pdseResults });
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).toContain("90");
  });

  it("is non-fatal when writeRunReport throws", async () => {
    vi.mocked(writeRunReport).mockRejectedValueOnce(new Error("disk full"));
    const pdseResults = [{ file: "src/app.ts", pdseScore: 95, passed: true }];
    const result = await generateSessionReport({ ...baseCtx(makeSession(1)), pdseResults });
    expect(result).toBeNull();
  });

  it("records restored sessions explicitly when recovery information is provided", async () => {
    const pdseResults = [{ file: "src/app.ts", pdseScore: 40, passed: false }];
    await generateSessionReport({
      ...baseCtx(makeSession(1)),
      pdseResults,
      restoredAt: "2026-03-26T10:30:00.000Z",
      restoreSummary: "Restored workspace to checkpoint before mutation batch.",
    });
    const call = vi.mocked(writeRunReport).mock.calls[0]![0];
    expect(call.markdown).toContain("**Execution truth:** applied -> failed -> restored");
    expect(call.markdown).toContain("Restored workspace to checkpoint before mutation batch.");
    expect(call.markdown).toContain("restore");
  });
});
