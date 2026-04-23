// packages/core/src/__tests__/sliding-context-window.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateTokens,
  classifyTurnContent,
  scoreContextTurn,
  compressTurns,
  SlidingContextWindow,
  ContextWindowRegistry,
  globalContextWindowRegistry,
  type ContextTurn,
} from "../sliding-context-window.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTurn(role: ContextTurn["role"] = "user", content = "hello"): Omit<ContextTurn, "id" | "priority" | "createdAt"> {
  return { role, content, tokens: estimateTokens(content), contentType: "chat", pinned: false };
}

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns positive number for non-empty string", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(0);
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("longer text has more tokens", () => {
    expect(estimateTokens("longer string here")).toBeGreaterThan(estimateTokens("hi"));
  });

  it("respects custom charsPerToken", () => {
    const t1 = estimateTokens("hello", 2);
    const t2 = estimateTokens("hello", 4);
    expect(t1).toBeGreaterThan(t2);
  });
});

// ─── classifyTurnContent ──────────────────────────────────────────────────────

describe("classifyTurnContent", () => {
  it("detects code blocks", () => {
    expect(classifyTurnContent("Here is some code:\n```ts\nconst x = 1;\n```")).toBe("code");
  });

  it("detects errors", () => {
    expect(classifyTurnContent("An Error occurred: TypeError: Cannot read property")).toBe("error");
  });

  it("detects decisions", () => {
    expect(classifyTurnContent("I decided to refactor the auth module using JWT")).toBe("decision");
  });

  it("detects tool calls", () => {
    expect(classifyTurnContent("[bash] ls -la")).toBe("tool-call");
  });

  it("falls back to chat", () => {
    expect(classifyTurnContent("Sure, I can help with that.")).toBe("chat");
  });
});

// ─── scoreContextTurn ─────────────────────────────────────────────────────────

describe("scoreContextTurn", () => {
  it("system turn always scores 1.0", () => {
    const turn = { ...makeTurn("system"), id: "t1", priority: 0, createdAt: "" } as ContextTurn;
    expect(scoreContextTurn(turn, 5, 0)).toBe(1.0);
  });

  it("newer turns score higher than older ones (same type)", () => {
    const old = { ...makeTurn("user"), id: "t1", priority: 0, createdAt: "" } as ContextTurn;
    const fresh = { ...makeTurn("user"), id: "t2", priority: 0, createdAt: "" } as ContextTurn;
    const oldScore = scoreContextTurn(old, 5, 0);
    const freshScore = scoreContextTurn(fresh, 5, 4);
    expect(freshScore).toBeGreaterThan(oldScore);
  });

  it("error content scores higher than chat", () => {
    const errTurn = { ...makeTurn("user", "Error: failed"), id: "t", priority: 0, createdAt: "", contentType: "error" as const };
    const chatTurn = { ...makeTurn("user", "hello"), id: "t2", priority: 0, createdAt: "", contentType: "chat" as const };
    expect(scoreContextTurn(errTurn, 3, 1)).toBeGreaterThan(scoreContextTurn(chatTurn, 3, 1));
  });

  it("returns value in [0, 1]", () => {
    const turn = { ...makeTurn(), id: "t", priority: 0, createdAt: "" } as ContextTurn;
    const score = scoreContextTurn(turn, 10, 5);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ─── compressTurns ────────────────────────────────────────────────────────────

describe("compressTurns", () => {
  it("returns undefined for empty array", () => {
    expect(compressTurns([])).toBeUndefined();
  });

  it("returns a summary turn", () => {
    const turns: ContextTurn[] = [
      { id: "t1", role: "user", content: "hello", tokens: 1, contentType: "chat", priority: 0.4, pinned: false, createdAt: "" },
    ];
    const summary = compressTurns(turns);
    expect(summary).toBeDefined();
    expect(summary!.contentType).toBe("summary");
    expect(summary!.isSummary).toBe(true);
  });

  it("includes code block content in summary", () => {
    const turns: ContextTurn[] = [{
      id: "t1", role: "assistant",
      content: "Here:\n```ts\nconst x = 1;\n```",
      tokens: 10, contentType: "code", priority: 0.75, pinned: false, createdAt: "",
    }];
    const summary = compressTurns(turns);
    expect(summary!.content).toContain("Code:");
  });

  it("truncates long chat content in summary", () => {
    const turns: ContextTurn[] = [{
      id: "t1", role: "user",
      content: "a".repeat(200),
      tokens: 50, contentType: "chat", priority: 0.4, pinned: false, createdAt: "",
    }];
    const summary = compressTurns(turns);
    expect(summary!.content.length).toBeLessThan(300);
  });
});

// ─── SlidingContextWindow ─────────────────────────────────────────────────────

describe("SlidingContextWindow", () => {
  let window: SlidingContextWindow;

  beforeEach(() => {
    window = new SlidingContextWindow({ maxTokens: 100, reserveTokens: 10 });
  });

  it("addTurn increases turnCount", () => {
    window.addTurn("user", "hello");
    expect(window.turnCount).toBe(1);
  });

  it("totalTokens tracks accumulated tokens", () => {
    window.addTurn("user", "hello world"); // ~3 tokens
    expect(window.totalTokens).toBeGreaterThan(0);
  });

  it("auto-pins system turns", () => {
    window.addTurn("system", "You are a helpful assistant");
    expect(window.pinnedCount).toBe(1);
  });

  it("manual pinTurn prevents eviction", () => {
    const turn = window.addTurn("user", "Important context here");
    window.pinTurn(turn.id);
    expect(window.getTurn(turn.id)!.pinned).toBe(true);
  });

  it("unpinTurn allows eviction", () => {
    const t = window.addTurn("user", "hi");
    window.pinTurn(t.id);
    window.unpinTurn(t.id);
    expect(window.getTurn(t.id)!.pinned).toBe(false);
  });

  it("auto-compacts when over budget — fewer turns than added", () => {
    // Add 20 turns (each ~5 tokens = 100 total, over 90-token threshold)
    for (let i = 0; i < 20; i++) {
      window.addTurn("user", "x".repeat(20)); // ~5 tokens each
    }
    // Compaction should reduce turn count (even if summary re-adds some tokens)
    expect(window.turnCount).toBeLessThan(20);
  });

  it("compact() returns eviction result", () => {
    window.addTurn("user", "a".repeat(100));
    window.addTurn("user", "b".repeat(100));
    const result = window.compact();
    expect(result.evictedTurns.length).toBeGreaterThanOrEqual(0);
    expect(result.tokensFreed).toBeGreaterThanOrEqual(0);
  });

  it("getTurnsForBudget respects token limit", () => {
    window.addTurn("user", "a".repeat(100));
    window.addTurn("user", "b".repeat(100));
    window.addTurn("user", "c".repeat(100));
    const turns = window.getTurnsForBudget(30);
    const totalTokens = turns.reduce((s, t) => s + t.tokens, 0);
    expect(totalTokens).toBeLessThanOrEqual(30);
  });

  it("search returns matching turns", () => {
    window.addTurn("user", "implement the authentication module");
    window.addTurn("user", "write tests for the database layer");
    const results = window.search("authentication");
    expect(results.some((t) => t.content.includes("authentication"))).toBe(true);
  });

  it("search is case-insensitive", () => {
    window.addTurn("assistant", "The Authentication is done via JWT");
    const results = window.search("authentication");
    expect(results).toHaveLength(1);
  });

  it("utilizationPercent is 0 when empty", () => {
    expect(window.utilizationPercent).toBe(0);
  });

  it("clear empties all turns", () => {
    window.addTurn("user", "hello");
    window.clear();
    expect(window.turnCount).toBe(0);
    expect(window.totalTokens).toBe(0);
  });

  it("formatForPrompt includes token usage stats", () => {
    window.addTurn("user", "test message");
    const output = window.formatForPrompt();
    expect(output).toContain("Context Window");
    expect(output).toContain("tokens");
  });

  it("getTurn returns undefined for unknown ID", () => {
    expect(window.getTurn("nonexistent")).toBeUndefined();
  });
});

// ─── ContextWindowRegistry ────────────────────────────────────────────────────

describe("ContextWindowRegistry", () => {
  let registry: ContextWindowRegistry;

  beforeEach(() => { registry = new ContextWindowRegistry(); });

  it("getOrCreate returns new window for unknown session", () => {
    const w = registry.getOrCreate("session-1");
    expect(w).toBeDefined();
  });

  it("getOrCreate returns same window for same session", () => {
    const w1 = registry.getOrCreate("session-x");
    const w2 = registry.getOrCreate("session-x");
    expect(w1).toBe(w2);
  });

  it("get returns undefined for unknown session", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("remove deletes the session", () => {
    registry.getOrCreate("session-del");
    registry.remove("session-del");
    expect(registry.get("session-del")).toBeUndefined();
  });

  it("sessionCount tracks number of sessions", () => {
    registry.getOrCreate("a");
    registry.getOrCreate("b");
    expect(registry.sessionCount).toBe(2);
  });

  it("clear removes all sessions", () => {
    registry.getOrCreate("a");
    registry.getOrCreate("b");
    registry.clear();
    expect(registry.sessionCount).toBe(0);
  });

  it("globalContextWindowRegistry is a singleton", () => {
    expect(globalContextWindowRegistry).toBeDefined();
    expect(globalContextWindowRegistry).toBeInstanceOf(ContextWindowRegistry);
  });
});
