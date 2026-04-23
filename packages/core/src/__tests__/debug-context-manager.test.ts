// packages/core/src/__tests__/debug-context-manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  inferVariableType,
  formatVariableValue,
  buildVariable,
  isUserCodeFrame,
  filterUserFrames,
  formatCallStack,
  BreakpointRegistry,
  WatchRegistry,
  DebugContextManager,
  type StackFrame,
} from "../debug-context-manager.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFrame(overrides: Partial<StackFrame> = {}): StackFrame {
  return {
    id: 1,
    name: "myFunction",
    source: "src/util.ts",
    line: 42,
    column: 8,
    isUserCode: true,
    ...overrides,
  };
}

// ─── inferVariableType ────────────────────────────────────────────────────────

describe("inferVariableType", () => {
  it("returns null for null", () => expect(inferVariableType(null)).toBe("null"));
  it("returns undefined for undefined", () => expect(inferVariableType(undefined)).toBe("undefined"));
  it("returns string for strings", () => expect(inferVariableType("hello")).toBe("string"));
  it("returns number for numbers", () => expect(inferVariableType(42)).toBe("number"));
  it("returns boolean for booleans", () => expect(inferVariableType(true)).toBe("boolean"));
  it("returns array for arrays", () => expect(inferVariableType([1, 2])).toBe("array"));
  it("returns object for plain objects", () => expect(inferVariableType({ a: 1 })).toBe("object"));
  it("returns function for functions", () => expect(inferVariableType(() => {})).toBe("function"));
});

// ─── formatVariableValue ──────────────────────────────────────────────────────

describe("formatVariableValue", () => {
  it("wraps strings in quotes", () => {
    const { display } = formatVariableValue("hello", "string");
    expect(display).toBe('"hello"');
  });

  it("formats null as 'null'", () => {
    expect(formatVariableValue(null, "null").display).toBe("null");
  });

  it("truncates long values", () => {
    const { display, truncated } = formatVariableValue("a".repeat(200), "string");
    expect(truncated).toBe(true);
    expect(display.endsWith("…")).toBe(true);
  });

  it("short value not truncated", () => {
    const { truncated } = formatVariableValue("short", "string");
    expect(truncated).toBe(false);
  });
});

// ─── buildVariable ────────────────────────────────────────────────────────────

describe("buildVariable", () => {
  it("builds a string variable", () => {
    const v = buildVariable("x", "hello");
    expect(v.name).toBe("x");
    expect(v.type).toBe("string");
  });

  it("expands object children at depth 0", () => {
    const v = buildVariable("obj", { a: 1, b: 2 });
    expect(v.children).toBeDefined();
    expect(v.childCount).toBe(2);
  });

  it("does not expand children beyond maxDepth", () => {
    const v = buildVariable("obj", { a: { b: { c: 1 } } }, 0, 1);
    const child = v.children?.find((c) => c.name === "a");
    expect(child?.children).toBeUndefined();
  });

  it("limits children to 10 for large objects", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 20; i++) big[`k${i}`] = i;
    const v = buildVariable("big", big);
    expect((v.children?.length ?? 0)).toBeLessThanOrEqual(10);
  });
});

// ─── isUserCodeFrame ──────────────────────────────────────────────────────────

describe("isUserCodeFrame", () => {
  it("returns true for src/ frame", () => {
    expect(isUserCodeFrame(makeFrame({ source: "src/util.ts" }))).toBe(true);
  });

  it("returns false for node_modules frame", () => {
    expect(isUserCodeFrame(makeFrame({ source: "node_modules/express/lib/router.js" }))).toBe(false);
  });

  it("returns false for node:internal frame", () => {
    expect(isUserCodeFrame(makeFrame({ source: "node:internal/process/task_queues.js" }))).toBe(false);
  });

  it("returns false for frame with no source", () => {
    expect(isUserCodeFrame(makeFrame({ source: undefined }))).toBe(false);
  });
});

// ─── filterUserFrames ─────────────────────────────────────────────────────────

describe("filterUserFrames", () => {
  it("keeps user frames and removes library frames", () => {
    const frames = [
      makeFrame({ source: "src/app.ts" }),
      makeFrame({ source: "node_modules/express/index.js" }),
    ];
    const filtered = filterUserFrames(frames);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.source).toBe("src/app.ts");
  });
});

// ─── formatCallStack ──────────────────────────────────────────────────────────

describe("formatCallStack", () => {
  it("formats frames with source locations", () => {
    const frames = [makeFrame({ name: "myFn", source: "src/a.ts", line: 10, column: 4 })];
    const out = formatCallStack(frames);
    expect(out).toContain("myFn");
    expect(out).toContain("src/a.ts:10:4");
  });

  it("shows library badge for non-user frames", () => {
    const frames = [makeFrame({ isUserCode: false, source: "node_modules/x.js" })];
    const out = formatCallStack(frames);
    expect(out).toContain("[lib]");
  });

  it("limits frames and shows overflow message", () => {
    const frames = Array.from({ length: 15 }, (_, i) => makeFrame({ id: i, name: `fn${i}` }));
    const out = formatCallStack(frames, 5);
    expect(out).toContain("more frames");
  });
});

// ─── BreakpointRegistry ───────────────────────────────────────────────────────

describe("BreakpointRegistry", () => {
  let reg: BreakpointRegistry;

  beforeEach(() => { reg = new BreakpointRegistry(); });

  it("adds a breakpoint with enabled state", () => {
    const bp = reg.add("src/a.ts", 10);
    expect(bp.state).toBe("enabled");
    expect(bp.source).toBe("src/a.ts");
  });

  it("removes a breakpoint", () => {
    const bp = reg.add("src/a.ts", 10);
    expect(reg.remove(bp.id)).toBe(true);
    expect(reg.all).toHaveLength(0);
  });

  it("toggle switches enabled↔disabled", () => {
    const bp = reg.add("src/a.ts", 10);
    reg.toggle(bp.id);
    expect(reg.all[0]!.state).toBe("disabled");
    reg.toggle(bp.id);
    expect(reg.all[0]!.state).toBe("enabled");
  });

  it("recordHit increments hit count", () => {
    const bp = reg.add("src/a.ts", 10);
    reg.recordHit(bp.id);
    reg.recordHit(bp.id);
    expect(reg.all[0]!.hitCount).toBe(2);
  });

  it("resetHitCount zeroes hitCount", () => {
    const bp = reg.add("src/a.ts", 10);
    reg.recordHit(bp.id);
    reg.resetHitCount(bp.id);
    expect(reg.all[0]!.hitCount).toBe(0);
  });

  it("getBySource filters correctly", () => {
    reg.add("src/a.ts", 10);
    reg.add("src/b.ts", 20);
    expect(reg.getBySource("src/a.ts")).toHaveLength(1);
  });

  it("enabledCount excludes disabled breakpoints", () => {
    const bp = reg.add("src/a.ts", 10);
    reg.add("src/b.ts", 20);
    reg.toggle(bp.id);
    expect(reg.enabledCount).toBe(1);
  });

  it("clear removes all breakpoints", () => {
    reg.add("src/a.ts", 10);
    reg.clear();
    expect(reg.all).toHaveLength(0);
  });
});

// ─── WatchRegistry ────────────────────────────────────────────────────────────

describe("WatchRegistry", () => {
  let wr: WatchRegistry;

  beforeEach(() => { wr = new WatchRegistry(); });

  it("adds a watch expression", () => {
    const w = wr.add("myVar.length");
    expect(w.expression).toBe("myVar.length");
    expect(wr.all).toHaveLength(1);
  });

  it("updateResult sets lastResult and clears lastError", () => {
    const w = wr.add("x");
    wr.updateResult(w.id, "42");
    expect(wr.all[0]!.lastResult).toBe("42");
    expect(wr.all[0]!.lastError).toBeUndefined();
  });

  it("updateError sets lastError and clears lastResult", () => {
    const w = wr.add("x");
    wr.updateError(w.id, "ReferenceError: x is not defined");
    expect(wr.all[0]!.lastError).toContain("ReferenceError");
    expect(wr.all[0]!.lastResult).toBeUndefined();
  });

  it("remove deletes a watch", () => {
    const w = wr.add("x");
    wr.remove(w.id);
    expect(wr.all).toHaveLength(0);
  });
});

// ─── DebugContextManager ──────────────────────────────────────────────────────

describe("DebugContextManager", () => {
  let mgr: DebugContextManager;

  beforeEach(() => { mgr = new DebugContextManager("test-session-1"); });

  it("starts as not paused", () => {
    expect(mgr.isPaused).toBe(false);
  });

  it("stopped event sets isPaused=true", () => {
    mgr.pushEvent("stopped", { frames: [makeFrame()] });
    expect(mgr.isPaused).toBe(true);
  });

  it("continued event sets isPaused=false", () => {
    mgr.pushEvent("stopped", { frames: [makeFrame()] });
    mgr.pushEvent("continued");
    expect(mgr.isPaused).toBe(false);
  });

  it("getSnapshot includes frames", () => {
    mgr.pushEvent("stopped", { frames: [makeFrame()] });
    const snap = mgr.getSnapshot();
    expect(snap.frames).toHaveLength(1);
  });

  it("setVariables stores variable list", () => {
    mgr.setVariables([buildVariable("x", 42)]);
    expect(mgr.getSnapshot().variables).toHaveLength(1);
  });

  it("getRecentEvents returns last N events", () => {
    for (let i = 0; i < 25; i++) mgr.pushEvent("output");
    expect(mgr.getRecentEvents(10)).toHaveLength(10);
  });

  it("formatForPrompt includes paused location", () => {
    mgr.pushEvent("stopped", { frames: [makeFrame({ source: "src/app.ts", line: 55 })] });
    const out = mgr.formatForPrompt();
    expect(out).toContain("PAUSED");
    expect(out).toContain("src/app.ts");
  });

  it("formatForPrompt includes variables", () => {
    mgr.setVariables([buildVariable("counter", 7)]);
    const out = mgr.formatForPrompt();
    expect(out).toContain("counter");
  });

  it("formatForPrompt includes watch expressions", () => {
    const w = mgr.watches.add("myList.length");
    mgr.watches.updateResult(w.id, "5");
    const out = mgr.formatForPrompt();
    expect(out).toContain("myList.length");
    expect(out).toContain("5");
  });

  it("reset clears all state", () => {
    mgr.pushEvent("stopped", { frames: [makeFrame()] });
    mgr.setVariables([buildVariable("x", 1)]);
    mgr.breakpoints.add("src/a.ts", 10);
    mgr.reset();
    const snap = mgr.getSnapshot();
    expect(snap.frames).toHaveLength(0);
    expect(snap.variables).toHaveLength(0);
    expect(snap.breakpoints).toHaveLength(0);
    expect(mgr.isPaused).toBe(false);
  });
});
