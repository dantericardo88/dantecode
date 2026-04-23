// packages/core/src/__tests__/file-change-event-bus.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  globToRegex,
  matchesGlob,
  matchesPolicy,
  clearGlobCache,
  FileChangeEventBus,
  TriggerRouter,
  buildTriggerRule,
  DEFAULT_TRIGGER_RULES,
  globalFileChangeBus,
  type FileChangeEvent,
  type FileChangeBatch,
  type WatchPolicy,
} from "../file-change-event-bus.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(filePath: string, kind: FileChangeEvent["kind"] = "modified"): FileChangeEvent {
  return { filePath, kind, timestamp: new Date().toISOString(), source: "test" };
}

// ─── globToRegex ──────────────────────────────────────────────────────────────

describe("globToRegex", () => {
  beforeEach(() => clearGlobCache());

  it("matches exact path", () => {
    expect(globToRegex("src/index.ts").test("src/index.ts")).toBe(true);
  });

  it("* matches non-slash characters", () => {
    expect(globToRegex("src/*.ts").test("src/index.ts")).toBe(true);
    expect(globToRegex("src/*.ts").test("src/a/b.ts")).toBe(false);
  });

  it("** matches any depth", () => {
    expect(globToRegex("**/*.ts").test("src/a/b/c.ts")).toBe(true);
    expect(globToRegex("**/*.ts").test("index.ts")).toBe(true);
  });

  it("? matches single non-slash char", () => {
    expect(globToRegex("src/?.ts").test("src/a.ts")).toBe(true);
    expect(globToRegex("src/?.ts").test("src/ab.ts")).toBe(false);
  });

  it("caches compiled regex", () => {
    const r1 = globToRegex("**/*.ts");
    const r2 = globToRegex("**/*.ts");
    expect(r1).toBe(r2); // same reference
  });
});

// ─── matchesGlob ──────────────────────────────────────────────────────────────

describe("matchesGlob", () => {
  beforeEach(() => clearGlobCache());

  it("normalizes Windows backslashes", () => {
    expect(matchesGlob("src\\a\\b.ts", "**/*.ts")).toBe(true);
  });

  it("returns false for non-matching pattern", () => {
    expect(matchesGlob("src/a.js", "**/*.ts")).toBe(false);
  });
});

// ─── matchesPolicy ────────────────────────────────────────────────────────────

describe("matchesPolicy", () => {
  beforeEach(() => clearGlobCache());

  const policy: WatchPolicy = {
    include: ["**/*.ts"],
    exclude: ["**/node_modules/**"],
    debounceMs: 200,
    maxBatchSize: 50,
  };

  it("returns true for included file", () => {
    expect(matchesPolicy("src/index.ts", policy)).toBe(true);
  });

  it("returns false for excluded file", () => {
    expect(matchesPolicy("node_modules/react/index.ts", policy)).toBe(false);
  });

  it("returns false if not in include", () => {
    expect(matchesPolicy("src/index.py", policy)).toBe(false);
  });
});

// ─── FileChangeEventBus ───────────────────────────────────────────────────────

describe("FileChangeEventBus", () => {
  let bus: FileChangeEventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new FileChangeEventBus({ debounceMs: 100, include: ["**/*"], exclude: [] });
  });

  afterEach(() => {
    bus.dispose();
    vi.useRealTimers();
  });

  it("starts with 0 handlers and 0 pending", () => {
    expect(bus.handlerCount).toBe(0);
    expect(bus.pendingCount).toBe(0);
  });

  it("register adds handler", () => {
    bus.register("**/*.ts", () => {});
    expect(bus.handlerCount).toBe(1);
  });

  it("unregister removes handler by ID", () => {
    const id = bus.register("**/*.ts", () => {});
    expect(bus.unregister(id)).toBe(true);
    expect(bus.handlerCount).toBe(0);
  });

  it("unregister returns false for unknown ID", () => {
    expect(bus.unregister("no-such-id")).toBe(false);
  });

  it("emit queues event without immediate delivery", () => {
    const calls: FileChangeBatch[] = [];
    bus.register("**/*.ts", (b) => { calls.push(b); });
    bus.emit(makeEvent("src/a.ts"));
    expect(bus.pendingCount).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("delivers batch after debounce timeout", () => {
    const calls: FileChangeBatch[] = [];
    bus.register("**/*.ts", (b) => { calls.push(b); });
    bus.emit(makeEvent("src/a.ts"));
    vi.advanceTimersByTime(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.events[0]!.filePath).toBe("src/a.ts");
  });

  it("batches multiple events within debounce window", () => {
    const calls: FileChangeBatch[] = [];
    bus.register("**/*.ts", (b) => { calls.push(b); });
    bus.emit(makeEvent("a.ts"));
    bus.emit(makeEvent("b.ts"));
    vi.advanceTimersByTime(100);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.events).toHaveLength(2);
  });

  it("flush delivers immediately", () => {
    const calls: FileChangeBatch[] = [];
    bus.register("**/*.ts", (b) => { calls.push(b); });
    bus.emit(makeEvent("a.ts"));
    bus.flush();
    expect(calls).toHaveLength(1);
  });

  it("excludes files not matching handler pattern", () => {
    const calls: FileChangeBatch[] = [];
    bus.register("**/*.ts", (b) => { calls.push(b); });
    bus.emit(makeEvent("src/a.py")); // .py — handler pattern is *.ts
    vi.advanceTimersByTime(100);
    expect(calls).toHaveLength(0);
  });

  it("filters by kind in registration", () => {
    const calls: FileChangeBatch[] = [];
    bus.register("**/*", (b) => { calls.push(b); }, ["created"]);
    bus.emit(makeEvent("a.ts", "modified"));
    vi.advanceTimersByTime(100);
    expect(calls).toHaveLength(0);
  });

  it("flushes immediately on maxBatchSize reached", () => {
    const smallBus = new FileChangeEventBus({ maxBatchSize: 2, include: ["**/*"], exclude: [] });
    const calls: FileChangeBatch[] = [];
    smallBus.register("**/*", (b) => { calls.push(b); });
    smallBus.emit(makeEvent("a.ts"));
    smallBus.emit(makeEvent("b.ts")); // triggers immediate flush
    expect(calls).toHaveLength(1);
    smallBus.dispose();
  });

  it("dispose clears handlers", () => {
    bus.register("**/*", () => {});
    bus.dispose();
    expect(bus.handlerCount).toBe(0);
  });

  it("policy getter returns copy", () => {
    const p = bus.policy;
    expect(p.debounceMs).toBe(100);
  });
});

// ─── TriggerRouter ────────────────────────────────────────────────────────────

describe("TriggerRouter", () => {
  let router: TriggerRouter;

  beforeEach(() => {
    router = new TriggerRouter();
  });

  it("starts with 0 rules", () => {
    expect(router.ruleCount).toBe(0);
  });

  it("addRule increments ruleCount", () => {
    router.addRule(buildTriggerRule("**/*.ts", "completion"));
    expect(router.ruleCount).toBe(1);
  });

  it("removeRule removes by pattern", () => {
    router.addRule(buildTriggerRule("**/*.ts", "completion"));
    expect(router.removeRule("**/*.ts")).toBe(true);
    expect(router.ruleCount).toBe(0);
  });

  it("removeRule returns false for unknown pattern", () => {
    expect(router.removeRule("**/*.ts")).toBe(false);
  });

  it("route returns matching triggers", () => {
    router.addRule(buildTriggerRule("**/*.ts", "lint", ["modified"]));
    const batch: FileChangeBatch = {
      events: [makeEvent("src/a.ts", "modified")],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    const triggers = router.route(batch);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]!.rule.action).toBe("lint");
  });

  it("route excludes events not matching kind filter", () => {
    router.addRule(buildTriggerRule("**/*.ts", "test", ["created"]));
    const batch: FileChangeBatch = {
      events: [makeEvent("a.ts", "modified")],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    expect(router.route(batch)).toHaveLength(0);
  });

  it("formatTriggerSummary returns '(No triggers)' on empty", () => {
    expect(router.formatTriggerSummary([])).toMatch(/No triggers/i);
  });

  it("formatTriggerSummary includes action name", () => {
    router.addRule(buildTriggerRule("**/*.ts", "completion", ["modified"], { label: "TS completion" }));
    const batch: FileChangeBatch = {
      events: [makeEvent("a.ts", "modified")],
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    const triggers = router.route(batch);
    const summary = router.formatTriggerSummary(triggers);
    expect(summary).toContain("completion");
  });
});

// ─── DEFAULT_TRIGGER_RULES ────────────────────────────────────────────────────

describe("DEFAULT_TRIGGER_RULES", () => {
  it("has rules for TypeScript", () => {
    expect(DEFAULT_TRIGGER_RULES.some((r) => r.pattern.includes("{ts"))).toBe(true);
  });

  it("has an index rule for re-indexing", () => {
    expect(DEFAULT_TRIGGER_RULES.some((r) => r.action === "index")).toBe(true);
  });
});

// ─── globalFileChangeBus ──────────────────────────────────────────────────────

describe("globalFileChangeBus", () => {
  it("is a FileChangeEventBus instance", () => {
    expect(globalFileChangeBus).toBeInstanceOf(FileChangeEventBus);
  });
});
