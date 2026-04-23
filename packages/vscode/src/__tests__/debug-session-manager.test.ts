// packages/vscode/src/__tests__/debug-session-manager.test.ts
import { describe, it, expect, vi } from "vitest";
import { DebugSessionManager } from "../debug-session-manager.js";

// ─── VSCode Mock ──────────────────────────────────────────────────────────────

function makeVsCodeMock() {
  const listeners: Record<string, Array<(arg?: unknown) => void>> = {
    start: [],
    terminate: [],
    changeActive: [],
  };

  const session = {
    name: "Test Session",
    customRequest: vi.fn().mockRejectedValue(new Error("not paused")),
  };

  const vsCodeApi = {
    debug: {
      onDidStartDebugSession: vi.fn((cb: (s: unknown) => void) => {
        listeners["start"]!.push(cb as (arg?: unknown) => void);
        return { dispose: vi.fn() };
      }),
      onDidTerminateDebugSession: vi.fn((cb: () => void) => {
        listeners["terminate"]!.push(cb as (arg?: unknown) => void);
        return { dispose: vi.fn() };
      }),
      onDidChangeActiveDebugSession: vi.fn((cb: (s: unknown) => void) => {
        listeners["changeActive"]!.push(cb as (arg?: unknown) => void);
        return { dispose: vi.fn() };
      }),
      get activeDebugSession() { return session; },
    },
    Uri: {
      file: vi.fn((path: string) => ({ path, scheme: "file" })),
    },
    workspace: {
      openTextDocument: vi.fn().mockRejectedValue(new Error("no doc")),
    },
  };

  return { vsCodeApi, listeners, session };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DebugSessionManager — lifecycle", () => {
  it("starts with null snapshot", () => {
    const { vsCodeApi } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    expect(mgr.getSnapshot()).toBeNull();
  });

  it("creates snapshot when debug session starts", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const snap = mgr.getSnapshot();
    expect(snap).not.toBeNull();
    expect(snap!.sessionName).toBe("Test Session");
    expect(snap!.isPaused).toBe(false);

    mgr.dispose();
  });

  it("clears snapshot when session terminates", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    expect(mgr.getSnapshot()).not.toBeNull();

    listeners["terminate"]![0]!();
    expect(mgr.getSnapshot()).toBeNull();

    mgr.dispose();
  });

  it("updates snapshot on active session change", () => {
    const { vsCodeApi, listeners } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    const newSession = { name: "New Session", customRequest: vi.fn() };
    listeners["changeActive"]![0]!(newSession);

    const snap = mgr.getSnapshot();
    expect(snap!.sessionName).toBe("New Session");

    mgr.dispose();
  });

  it("clears snapshot when active session changes to null", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    expect(mgr.getSnapshot()).not.toBeNull();

    listeners["changeActive"]![0]!(null);
    expect(mgr.getSnapshot()).toBeNull();

    mgr.dispose();
  });

  it("dispose clears all disposables without error", () => {
    const { vsCodeApi } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();
    expect(() => mgr.dispose()).not.toThrow();
  });
});

describe("DebugSessionManager — formatForContext", () => {
  it("returns empty string when no snapshot", () => {
    const { vsCodeApi } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    expect(mgr.formatForContext()).toBe("");
  });

  it("includes session name in output", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const output = mgr.formatForContext();
    expect(output).toContain("Test Session");

    mgr.dispose();
  });

  it("shows running status when not paused", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const output = mgr.formatForContext();
    expect(output).toMatch(/running/i);

    mgr.dispose();
  });

  it("shows paused status with pause reason when paused", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);

    // Manually set paused state via internal snapshot manipulation
    const snap = mgr.getSnapshot()!;
    snap.isPaused = true;
    snap.pauseReason = "breakpoint";
    snap.frames = [{ id: 1, name: "myFunction", source: "/src/foo.ts", line: 42, column: 0 }];
    snap.locals = [{ name: "x", value: "42", type: "number" }];

    const output = mgr.formatForContext();
    expect(output).toContain("PAUSED");
    expect(output).toContain("breakpoint");
    expect(output).toContain("myFunction");
    expect(output).toContain("x");

    mgr.dispose();
  });

  it("shows exception message when present", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const snap = mgr.getSnapshot()!;
    snap.isPaused = true;
    snap.exceptionMessage = "TypeError: Cannot read property 'foo' of undefined";
    snap.frames = [];
    snap.locals = [];

    const output = mgr.formatForContext();
    expect(output).toContain("TypeError");

    mgr.dispose();
  });

  it("shows current source line when present", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const snap = mgr.getSnapshot()!;
    snap.isPaused = true;
    snap.currentSourceLine = "const result = computeValue(x, y);";
    snap.frames = [];
    snap.locals = [];

    const output = mgr.formatForContext();
    expect(output).toContain("computeValue");

    mgr.dispose();
  });

  it("limits local variables to 15", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const snap = mgr.getSnapshot()!;
    snap.isPaused = true;
    snap.frames = [];
    snap.locals = Array.from({ length: 20 }, (_, i) => ({ name: `var${i}`, value: String(i) }));

    const output = mgr.formatForContext();
    expect(output).toContain("more variables");

    mgr.dispose();
  });
});

describe("DebugSessionManager — snapshot state", () => {
  it("snapshot capturedAt is a valid ISO string", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const snap = mgr.getSnapshot()!;
    expect(() => new Date(snap.capturedAt)).not.toThrow();
    expect(new Date(snap.capturedAt).toISOString()).toBe(snap.capturedAt);

    mgr.dispose();
  });

  it("snapshot starts with empty frames and locals", () => {
    const { vsCodeApi, listeners, session } = makeVsCodeMock();
    const mgr = new DebugSessionManager(vsCodeApi as never);
    mgr.register();

    listeners["start"]![0]!(session);
    const snap = mgr.getSnapshot()!;
    expect(snap.frames).toHaveLength(0);
    expect(snap.locals).toHaveLength(0);

    mgr.dispose();
  });
});
