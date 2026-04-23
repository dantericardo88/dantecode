import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => {
  return {
    debug: {
      onDidStartDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
      onDidReceiveDebugSessionCustomEvent: vi.fn(() => ({ dispose: vi.fn() })),
      onDidTerminateDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
    },
  };
});

import * as vscode from "vscode";
import { DebugAttachProvider } from "../debug-attach-provider.js";

function makeMockSession(overrides?: {
  customRequest?: (cmd: string, args?: unknown) => Promise<unknown>;
}) {
  return {
    customRequest: vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === "stackTrace")
        return {
          stackFrames: [
            { id: 1, name: "myFunction", source: { path: "/project/src/utils.ts" }, line: 42 },
            { id: 2, name: "main", source: { path: "/project/src/index.ts" }, line: 10 },
          ],
        };
      if (cmd === "scopes") return { scopes: [{ variablesReference: 100 }] };
      if (cmd === "variables")
        return {
          variables: [
            { name: "x", value: "5", type: "number" },
            { name: "result", value: "undefined", type: "undefined" },
          ],
        };
      if (cmd === "exceptionInfo") return { description: "TypeError: Cannot read property 'foo'" };
      return {};
    }),
    ...overrides,
  } as unknown as import("vscode").DebugSession;
}

describe("DebugAttachProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getSnapshot() returns null before any debug event", () => {
    const provider = new DebugAttachProvider();
    expect(provider.getSnapshot()).toBeNull();
  });

  it("formatForContext() returns empty string when no snapshot", () => {
    const provider = new DebugAttachProvider();
    expect(provider.formatForContext()).toBe("");
  });

  it("_captureSnapshot() populates _lastSnapshot with frames via stopped event", async () => {
    const provider = new DebugAttachProvider();
    provider.activate({} as vscode.ExtensionContext);

    const mockSession = makeMockSession();

    // Call _captureSnapshot directly (casting to access private method)
    await (provider as unknown as { _captureSnapshot: (session: vscode.DebugSession, body: { reason: string; threadId?: number }) => Promise<void> })._captureSnapshot(
      mockSession,
      { reason: "breakpoint", threadId: 1 },
    );

    const snap = provider.getSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.stopReason).toBe("breakpoint");
    expect(snap!.threadId).toBe(1);
    expect(snap!.frames).toHaveLength(2);
    expect(snap!.frames[0]!.name).toBe("myFunction");
    expect(snap!.frames[0]!.source).toBe("/project/src/utils.ts");
    expect(snap!.frames[0]!.line).toBe(42);
    // Variables now include type annotation: "type(value)" when type is available
    expect(snap!.frames[0]!.variables).toEqual({ x: "number(5)", result: "undefined(undefined)" });
  });

  it("formatForContext() includes exception message when stopReason is 'exception'", async () => {
    const provider = new DebugAttachProvider();
    provider.activate({} as vscode.ExtensionContext);

    const mockSession = makeMockSession();

    await (provider as unknown as { _captureSnapshot: (session: vscode.DebugSession, body: { reason: string; threadId?: number }) => Promise<void> })._captureSnapshot(
      mockSession,
      { reason: "exception", threadId: 1 },
    );

    const output = provider.formatForContext();
    expect(output).toContain("## Debug Context");
    expect(output).toContain("Call stack depth");
    expect(output).toContain("/project/src/utils.ts");
    expect(output).toContain("TypeError: Cannot read property 'foo'");
  });

  it("activate() returns array of 3 disposables", () => {
    const provider = new DebugAttachProvider();
    const disposables = provider.activate({} as vscode.ExtensionContext);
    expect(disposables).toHaveLength(3);
    expect(disposables[0]).toHaveProperty("dispose");
    expect(disposables[1]).toHaveProperty("dispose");
    expect(disposables[2]).toHaveProperty("dispose");
  });

  it("dispose() calls dispose on all registered listeners and nulls snapshot", async () => {
    const provider = new DebugAttachProvider();
    const disposables = provider.activate({} as vscode.ExtensionContext);

    const mockSession = makeMockSession();
    await (provider as unknown as { _captureSnapshot: (session: vscode.DebugSession, body: { reason: string; threadId?: number }) => Promise<void> })._captureSnapshot(
      mockSession,
      { reason: "step", threadId: 2 },
    );

    expect(provider.getSnapshot()).not.toBeNull();

    provider.dispose();

    // All 3 disposables should have had dispose() called
    for (const d of disposables) {
      expect((d as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
    }

    // Snapshot should be cleared
    expect(provider.getSnapshot()).toBeNull();
  });
});
