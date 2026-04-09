import { describe, it, expect } from "vitest";
import { ShortTermStore } from "./short-term-store.js";

// ---------------------------------------------------------------------------
// ShortTermStore — in-memory working memory with LRU eviction and TTL
// ---------------------------------------------------------------------------

describe("ShortTermStore — set / get", () => {
  it("stores and retrieves a value by key", () => {
    const store = new ShortTermStore();
    store.set("mykey", "myvalue", "session");
    const item = store.get("mykey", "session");
    expect(item).not.toBeNull();
    expect(item!.key).toBe("mykey");
    expect(item!.value).toBe("myvalue");
    expect(item!.scope).toBe("session");
  });

  it("returns null for a missing key", () => {
    const store = new ShortTermStore();
    expect(store.get("nonexistent", "session")).toBeNull();
  });

  it("increments recallCount on each get", () => {
    const store = new ShortTermStore();
    store.set("k", "v", "session");
    const first = store.get("k", "session");
    const second = store.get("k", "session");
    expect(first!.recallCount).toBe(1);
    expect(second!.recallCount).toBe(2);
  });

  it("scopes are isolated — same key in different scopes does not collide", () => {
    const store = new ShortTermStore();
    store.set("key", "session-value", "session");
    store.set("key", "project-value", "project");
    expect(store.get("key", "session")!.value).toBe("session-value");
    expect(store.get("key", "project")!.value).toBe("project-value");
  });

  it("overwrites value on set with same key", () => {
    const store = new ShortTermStore();
    store.set("k", "first", "session");
    store.set("k", "second", "session");
    expect(store.get("k", "session")!.value).toBe("second");
  });
});

describe("ShortTermStore — delete", () => {
  it("delete removes the item", () => {
    const store = new ShortTermStore();
    store.set("k", "v", "session");
    const deleted = store.delete("k", "session");
    expect(deleted).toBe(true);
    expect(store.get("k", "session")).toBeNull();
  });

  it("delete returns false for missing key", () => {
    const store = new ShortTermStore();
    expect(store.delete("missing", "session")).toBe(false);
  });
});

describe("ShortTermStore — TTL expiry", () => {
  it("returns null for expired item", async () => {
    const store = new ShortTermStore(500, 1); // 1ms default TTL
    store.set("k", "v", "session");
    await new Promise((r) => setTimeout(r, 10)); // wait for TTL
    expect(store.get("k", "session")).toBeNull();
  });

  it("honours per-item TTL override", async () => {
    const store = new ShortTermStore(500, 60_000); // 1min default
    store.set("k", "v", "session", 1); // 1ms custom TTL
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get("k", "session")).toBeNull();
  });

  it("item with no TTL does not expire", async () => {
    const store = new ShortTermStore(500, 0); // defaultTtlMs=0 means no TTL
    store.set("k", "v", "session");
    await new Promise((r) => setTimeout(r, 10));
    expect(store.get("k", "session")).not.toBeNull();
  });

  it("pruneExpired removes expired items and returns count", async () => {
    const store = new ShortTermStore(500, 1);
    store.set("a", "va", "session");
    store.set("b", "vb", "session");
    await new Promise((r) => setTimeout(r, 10));
    const count = store.pruneExpired();
    expect(count).toBe(2);
    expect(store.size).toBe(0);
  });
});

describe("ShortTermStore — listByScope / listAll", () => {
  it("listByScope returns only items in specified scope", () => {
    const store = new ShortTermStore();
    store.set("a", 1, "session");
    store.set("b", 2, "session");
    store.set("c", 3, "project");
    const items = store.listByScope("session");
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.scope).toBe("session");
    }
  });

  it("listAll returns items across scopes", () => {
    const store = new ShortTermStore();
    store.set("a", 1, "session");
    store.set("b", 2, "project");
    store.set("c", 3, "global");
    expect(store.listAll()).toHaveLength(3);
  });

  it("listByScope excludes expired items", async () => {
    const store = new ShortTermStore(500, 1);
    store.set("x", "v", "session");
    await new Promise((r) => setTimeout(r, 10));
    expect(store.listByScope("session")).toHaveLength(0);
  });
});

describe("ShortTermStore — search", () => {
  it("matches key substring", () => {
    const store = new ShortTermStore();
    store.set("payment-processing", "logic", "session");
    const results = store.search("payment", "session");
    expect(results).toHaveLength(1);
    expect(results[0]!.key).toBe("payment-processing");
  });

  it("matches value substring", () => {
    const store = new ShortTermStore();
    store.set("k", "authentication flow", "session");
    const results = store.search("auth");
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty array when no match", () => {
    const store = new ShortTermStore();
    store.set("a", "b", "session");
    expect(store.search("zzz")).toHaveLength(0);
  });
});

describe("ShortTermStore — LRU eviction", () => {
  it("evicts least-recently-used when capacity is exceeded", () => {
    const store = new ShortTermStore(3, 0); // capacity 3, no TTL
    store.set("a", 1, "session");
    store.set("b", 2, "session");
    store.set("c", 3, "session");
    // access 'a' to bump it to most-recently-used
    store.get("a", "session");
    // add a 4th item — 'b' should be evicted (LRU)
    store.set("d", 4, "session");
    expect(store.get("b", "session")).toBeNull(); // evicted
    expect(store.get("a", "session")).not.toBeNull(); // still alive
  });
});

describe("ShortTermStore — clearScope", () => {
  it("removes all items for a scope, leaves others intact", () => {
    const store = new ShortTermStore();
    store.set("a", 1, "session");
    store.set("b", 2, "session");
    store.set("c", 3, "project");
    store.clearScope("session");
    expect(store.listByScope("session")).toHaveLength(0);
    expect(store.listByScope("project")).toHaveLength(1);
  });
});
