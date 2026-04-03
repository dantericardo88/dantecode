import { beforeEach, describe, it, expect, vi } from "vitest";

import { PrefixTreeCache } from "./prefix-tree-cache.js";

describe("PrefixTreeCache", () => {
  let cache: PrefixTreeCache;

  beforeEach(() => {
    cache = new PrefixTreeCache(5);
  });

  // -----------------------------------------------------------------------
  // Basic get / set
  // -----------------------------------------------------------------------

  it("returns undefined for an empty cache", () => {
    expect(cache.get("anything")).toBeUndefined();
  });

  it("stores and retrieves an exact-match entry", () => {
    cache.set("const x", "= 42;");
    expect(cache.get("const x")).toBe("= 42;");
  });

  it("returns the longest matching prefix, not just exact", () => {
    cache.set("func", "tion greet()");
    // Querying "function" is longer than the stored key "func" — the
    // trie walk should still match "func" as the longest stored prefix.
    expect(cache.get("function")).toBe("tion greet()");
  });

  it("prefers a deeper match over a shallower one", () => {
    cache.set("con", "st a = 1;");
    cache.set("const", " b = 2;");
    expect(cache.get("const x")).toBe(" b = 2;");
  });

  it("returns undefined when the query does not match any prefix", () => {
    cache.set("abc", "123");
    expect(cache.get("xyz")).toBeUndefined();
  });

  it("overwrites an existing entry without incrementing count", () => {
    cache.set("hello", "world");
    cache.set("hello", "universe");
    expect(cache.get("hello")).toBe("universe");
    expect(cache.size).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Size & clear
  // -----------------------------------------------------------------------

  it("reports the correct size after multiple inserts", () => {
    cache.set("a", "1");
    cache.set("ab", "2");
    cache.set("abc", "3");
    expect(cache.size).toBe(3);
  });

  it("clear empties the cache and resets size to zero", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // LRU eviction
  // -----------------------------------------------------------------------

  it("evicts the least-recently used entry when maxEntries is exceeded", () => {
    // Cache has capacity 5 — fill it, then add a 6th entry.
    vi.useFakeTimers();

    vi.setSystemTime(100);
    cache.set("a", "1");
    vi.setSystemTime(200);
    cache.set("b", "2");
    vi.setSystemTime(300);
    cache.set("c", "3");
    vi.setSystemTime(400);
    cache.set("d", "4");
    vi.setSystemTime(500);
    cache.set("e", "5");

    // "a" was set earliest and never accessed again, so it should be evicted.
    vi.setSystemTime(600);
    cache.set("f", "6");

    expect(cache.size).toBe(5);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("f")).toBe("6");

    vi.useRealTimers();
  });

  it("refreshes LRU timestamp on get, keeping accessed entries alive", () => {
    vi.useFakeTimers();

    vi.setSystemTime(100);
    cache.set("a", "1");
    vi.setSystemTime(200);
    cache.set("b", "2");
    vi.setSystemTime(300);
    cache.set("c", "3");
    vi.setSystemTime(400);
    cache.set("d", "4");
    vi.setSystemTime(500);
    cache.set("e", "5");

    // Access "a" to bump its timestamp above "b".
    vi.setSystemTime(600);
    cache.get("a");

    // Now insert a 6th entry — "b" should be evicted (oldest access).
    vi.setSystemTime(700);
    cache.set("f", "6");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("1");

    vi.useRealTimers();
  });

  it("handles single-entry capacity without errors", () => {
    const tiny = new PrefixTreeCache(1);
    tiny.set("x", "1");
    tiny.set("y", "2");
    expect(tiny.size).toBe(1);
    expect(tiny.get("x")).toBeUndefined();
    expect(tiny.get("y")).toBe("2");
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("handles empty string as a prefix key", () => {
    cache.set("", "root");
    // An empty prefix is stored at the root node itself — any query will
    // match it as the longest prefix found.
    expect(cache.get("anything")).toBe("root");
    expect(cache.size).toBe(1);
  });

  it("handles Unicode characters in prefix keys", () => {
    cache.set("const \u03B1", "= 3.14;");
    expect(cache.get("const \u03B1")).toBe("= 3.14;");
  });
});
