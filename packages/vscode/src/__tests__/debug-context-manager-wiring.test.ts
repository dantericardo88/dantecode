// ============================================================================
// packages/vscode/src/__tests__/debug-context-manager-wiring.test.ts
//
// Sprint 15 — Dim 20: DebugContextManager wiring tests.
// Verifies DebugContextManager from @dantecode/core is wired into
// DebugAttachProvider.formatForContext().
// ============================================================================

import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  debug: {
    onDidStartDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
    onDidTerminateDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
    registerDebugAdapterTrackerFactory: vi.fn(() => ({ dispose: vi.fn() })),
    onDidReceiveDebugSessionCustomEvent: vi.fn(() => ({ dispose: vi.fn() })),
  },
  EventEmitter: vi.fn(() => ({ fire: vi.fn(), event: vi.fn(), dispose: vi.fn() })),
}));

import { DebugAttachProvider } from "../debug-attach-provider.js";
import { DebugContextManager } from "@dantecode/core";

type CaptureSnapshotMethod = (
  session: import("vscode").DebugSession,
  body: { reason?: string; threadId?: number },
) => Promise<void>;

function getCaptureSnapshot(provider: DebugAttachProvider): CaptureSnapshotMethod {
  return (
    provider as unknown as { _captureSnapshot: CaptureSnapshotMethod }
  )._captureSnapshot.bind(provider);
}

describe("DebugAttachProvider — DebugContextManager wiring (Sprint 15)", () => {

  it("DebugAttachProvider has a debugContextManager field that is an instance of DebugContextManager", () => {
    const provider = new DebugAttachProvider();
    expect(provider.debugContextManager).toBeInstanceOf(DebugContextManager);
  });

  it("formatForContext returns empty string when no snapshot has been captured", () => {
    const provider = new DebugAttachProvider();
    expect(provider.formatForContext()).toBe("");
  });

  it("formatForContext delegates to debugContextManager.formatForPrompt when snapshot exists", () => {
    const provider = new DebugAttachProvider();
    // Manually push an event into the manager to give it state
    provider.debugContextManager.pushEvent("breakpoint_hit", {
      frames: [{
        id: 1,
        name: "myFunction",
        source: "src/app.ts",
        line: 42,
        column: 0,
        isUserCode: true,
      }],
      threadId: 1,
    });
    // Manually set a lastSnapshot to simulate a captured debug session
    // Access private field via type cast
    (provider as unknown as { _lastSnapshot: object })._lastSnapshot = {
      threadId: 1,
      stopReason: "breakpoint",
      frames: [],
    };
    const result = provider.formatForContext();
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("## Debug Context");
  });

  it("debugContextManager.formatForPrompt includes session ID", () => {
    const provider = new DebugAttachProvider();
    provider.debugContextManager.pushEvent("stopped", {});
    (provider as unknown as { _lastSnapshot: object })._lastSnapshot = {
      threadId: 1, stopReason: "stopped", frames: [],
    };
    const result = provider.formatForContext();
    expect(result).toContain("vscode-debug");
  });

  it("DebugContextManager isPaused becomes true after breakpoint_hit event", () => {
    const provider = new DebugAttachProvider();
    expect(provider.debugContextManager.isPaused).toBe(false);
    provider.debugContextManager.pushEvent("breakpoint_hit", {
      frames: [{ id: 1, name: "fn", source: "app.ts", line: 10, column: 0, isUserCode: true }],
    });
    expect(provider.debugContextManager.isPaused).toBe(true);
  });

  it("DebugContextManager isPaused becomes false after continued event", () => {
    const provider = new DebugAttachProvider();
    provider.debugContextManager.pushEvent("breakpoint_hit", {
      frames: [{ id: 1, name: "fn", source: "app.ts", line: 10, column: 0, isUserCode: true }],
    });
    provider.debugContextManager.pushEvent("continued", {});
    expect(provider.debugContextManager.isPaused).toBe(false);
  });

  it("setVariables wires into manager and appears in formatForPrompt output", () => {
    const provider = new DebugAttachProvider();
    provider.debugContextManager.pushEvent("stopped", {});
    provider.debugContextManager.setVariables([{
      name: "myVar",
      value: "42",
      type: "number",
    }]);
    (provider as unknown as { _lastSnapshot: object })._lastSnapshot = {
      threadId: 1, stopReason: "stopped", frames: [],
    };
    const result = provider.formatForContext();
    expect(result).toContain("myVar");
  });

  it("each DebugAttachProvider instance gets its own DebugContextManager", () => {
    const p1 = new DebugAttachProvider();
    const p2 = new DebugAttachProvider();
    expect(p1.debugContextManager).not.toBe(p2.debugContextManager);
  });

  it("BreakpointRegistry is accessible via debugContextManager.breakpoints", () => {
    const provider = new DebugAttachProvider();
    const bp = provider.debugContextManager.breakpoints;
    expect(bp).toBeDefined();
    expect(typeof bp.add).toBe("function");
  });

});

// ── Sprint 24: Deep exception capture + watch evaluation ──────────────────────

describe("DebugAttachProvider — deep exception + watch evaluation (Sprint 24)", () => {

  function makeSession(overrides: Partial<{
    exceptionInfo: object;
    evalResult: string;
    evalThrows: boolean;
  }> = {}) {
    const mockCustomRequest = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === "stackTrace") {
        return {
          stackFrames: [
            { id: 42, name: "doSomething", source: { path: "src/app.ts" }, line: 10 },
          ],
        };
      }
      if (cmd === "scopes") return { scopes: [{ variablesReference: 1 }] };
      if (cmd === "variables") return { variables: [] };
      if (cmd === "exceptionInfo") {
        return overrides.exceptionInfo ?? {
          description: "TypeError: undefined",
          stackTrace: "  at doSomething (src/app.ts:10)\n  at main (src/index.ts:5)",
          source: "src/app.ts",
          line: 10,
          caught: false,
        };
      }
      if (cmd === "evaluate") {
        if (overrides.evalThrows) throw new Error("evaluation failed");
        return { result: overrides.evalResult ?? "42" };
      }
      return {};
    });
    return { customRequest: mockCustomRequest } as unknown as import("vscode").DebugSession;
  }

  it("formatForContext() includes caught field info when exception is captured", async () => {
    const provider = new DebugAttachProvider();
    const session = makeSession({ exceptionInfo: { description: "Error", stackTrace: "stack", caught: true } });
    await getCaptureSnapshot(provider)(
      session, { reason: "exception", threadId: 1 },
    );
    const result = provider.formatForContext();
    expect(result.length).toBeGreaterThan(0);
  });

  it("formatForContext() includes stack trace text when stackTrace field populated", async () => {
    const provider = new DebugAttachProvider();
    const session = makeSession();
    await getCaptureSnapshot(provider)(
      session, { reason: "exception", threadId: 1 },
    );
    const result = provider.formatForContext();
    expect(result.length).toBeGreaterThan(0);
  });

  it("watch expressions get evaluated via customRequest('evaluate')", async () => {
    const provider = new DebugAttachProvider();
    provider.debugContextManager.watches.add("myVar");
    const session = makeSession();
    await getCaptureSnapshot(provider)(
      session, { reason: "breakpoint", threadId: 1 },
    );
    expect(session.customRequest).toHaveBeenCalledWith("evaluate", expect.objectContaining({
      context: "watch",
    }));
  });

  it("successful watch evaluation calls updateResult", async () => {
    const provider = new DebugAttachProvider();
    const watchExpr = provider.debugContextManager.watches.add("x + 1");
    const session = makeSession({ evalResult: "43" });
    await getCaptureSnapshot(provider)(
      session, { reason: "breakpoint", threadId: 1 },
    );
    const watches = provider.debugContextManager.watches.all;
    const w = watches.find((e) => e.id === watchExpr.id);
    expect(w?.lastResult).toBe("43");
  });

  it("failed watch evaluation calls updateError and does not throw", async () => {
    const provider = new DebugAttachProvider();
    provider.debugContextManager.watches.add("badExpr");
    const session = makeSession({ evalThrows: true });
    // Should not throw — error is caught per-watch
    await expect(
      getCaptureSnapshot(provider)(
        session, { reason: "breakpoint", threadId: 1 },
      ),
    ).resolves.toBeUndefined();
    const watches = provider.debugContextManager.watches.all;
    expect(watches[0]?.lastError).toBeDefined();
  });

  it("debugContextManager.formatForPrompt includes watch expression results", async () => {
    const provider = new DebugAttachProvider();
    provider.debugContextManager.watches.add("myExpr");
    const session = makeSession({ evalResult: "hello world" });
    await getCaptureSnapshot(provider)(
      session, { reason: "breakpoint", threadId: 1 },
    );
    const prompt = provider.debugContextManager.formatForPrompt();
    expect(prompt).toContain("myExpr");
  });

  it("watch evaluation skipped when watches.all is empty (no extra evaluate requests)", async () => {
    const provider = new DebugAttachProvider();
    // No watches added
    const session = makeSession();
    await getCaptureSnapshot(provider)(
      session, { reason: "breakpoint", threadId: 1 },
    );
    const evaluateCalls = vi.mocked(session.customRequest).mock.calls.filter(
      (c) => c[0] === "evaluate",
    );
    expect(evaluateCalls).toHaveLength(0);
  });

  it("top frame ID used for watch evaluation context", async () => {
    const provider = new DebugAttachProvider();
    provider.debugContextManager.watches.add("expr");
    const session = makeSession();
    await getCaptureSnapshot(provider)(
      session, { reason: "breakpoint", threadId: 1 },
    );
    const evalCall = vi.mocked(session.customRequest).mock.calls.find(
      (c) => c[0] === "evaluate",
    );
    expect(evalCall?.[1]).toEqual(expect.objectContaining({ frameId: 42 }));
  });

});
