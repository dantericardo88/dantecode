/**
 * memory-engine-bridge.test.ts — @dantecode/ux-polish
 * Tests for G19 — Memory Engine / UXPreferences weld.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  MemoryEnginePreferences,
  getMemoryEnginePreferences,
  resetMemoryEnginePreferences,
} from "./memory-engine-bridge.js";
import type { MemoryOrchestratorLike } from "./memory-engine-bridge.js";
import { UXPreferences } from "../preferences/ux-preferences.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrefs(): UXPreferences {
  const store = new Map<string, string>();
  return new UXPreferences({
    prefsFilePath: "/tmp/mem-bridge-prefs.json",
    writeFn: (_, data) => store.set("p", data),
    readFn: () => store.get("p") ?? null,
    existsFn: () => store.has("p"),
    mkdirFn: () => {},
  });
}

function makeMockMemory(): MemoryOrchestratorLike & { db: Map<string, unknown> } {
  const db = new Map<string, unknown>();
  return {
    db,
    async memoryStore(key, value) {
      db.set(key, value);
    },
    async memoryRecall(query, _limit) {
      const val = db.get(query);
      if (val === undefined) return [];
      return [{ key: query, value: val }];
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MemoryEnginePreferences", () => {
  let prefs: UXPreferences;
  let memory: ReturnType<typeof makeMockMemory>;
  let bridge: MemoryEnginePreferences;

  beforeEach(() => {
    prefs = makePrefs();
    memory = makeMockMemory();
    bridge = new MemoryEnginePreferences({ preferences: prefs, memory });
    resetMemoryEnginePreferences();
  });

  describe("hasMemoryEngine", () => {
    it("returns true when memory is provided", () => {
      expect(bridge.hasMemoryEngine).toBe(true);
    });

    it("returns false when no memory", () => {
      const b2 = new MemoryEnginePreferences({ preferences: prefs });
      expect(b2.hasMemoryEngine).toBe(false);
    });

    it("returns false when memory is null", () => {
      const b3 = new MemoryEnginePreferences({ preferences: prefs, memory: null });
      expect(b3.hasMemoryEngine).toBe(false);
    });
  });

  describe("preferences accessor", () => {
    it("returns the wrapped UXPreferences", () => {
      expect(bridge.preferences).toBe(prefs);
    });
  });

  describe("persist()", () => {
    it("is a no-op when no memory engine", async () => {
      const b = new MemoryEnginePreferences({ preferences: prefs });
      await expect(b.persist()).resolves.toBeUndefined();
    });

    it("stores current preferences to memory under the default key", async () => {
      prefs.applyTheme("ocean");
      await bridge.persist();
      expect(memory.db.has("uxPreferences")).toBe(true);
    });

    it("stores current preference values", async () => {
      prefs.applyTheme("matrix");
      prefs.update({ density: "compact" });
      await bridge.persist();
      const stored = memory.db.get("uxPreferences") as Record<string, unknown>;
      expect(stored["theme"]).toBe("matrix");
      expect(stored["density"]).toBe("compact");
    });

    it("uses custom key when provided", async () => {
      const b = new MemoryEnginePreferences({
        preferences: prefs,
        memory,
        memoryKey: "customKey",
      });
      await b.persist();
      expect(memory.db.has("customKey")).toBe(true);
    });

    it("uses custom scope when provided", async () => {
      let capturedScope: string | undefined;
      const scopedMemory: MemoryOrchestratorLike = {
        async memoryStore(_key, _value, scope) {
          capturedScope = scope;
        },
        async memoryRecall() {
          return [];
        },
      };
      const b = new MemoryEnginePreferences({
        preferences: prefs,
        memory: scopedMemory,
        scope: "my-scope",
      });
      await b.persist();
      expect(capturedScope).toBe("my-scope");
    });
  });

  describe("restore()", () => {
    it("returns false when no memory engine", async () => {
      const b = new MemoryEnginePreferences({ preferences: prefs });
      expect(await b.restore()).toBe(false);
    });

    it("returns false when nothing is stored", async () => {
      expect(await bridge.restore()).toBe(false);
    });

    it("returns true after persist and restore", async () => {
      prefs.applyTheme("ocean");
      await bridge.persist();

      const prefs2 = makePrefs();
      const bridge2 = new MemoryEnginePreferences({ preferences: prefs2, memory });
      expect(await bridge2.restore()).toBe(true);
    });

    it("restores theme from memory engine", async () => {
      prefs.applyTheme("rich");
      await bridge.persist();

      const prefs2 = makePrefs();
      const bridge2 = new MemoryEnginePreferences({ preferences: prefs2, memory });
      await bridge2.restore();
      expect(prefs2.getTheme()).toBe("rich");
    });

    it("restores density from memory engine", async () => {
      prefs.update({ density: "verbose" });
      await bridge.persist();

      const prefs2 = makePrefs();
      const bridge2 = new MemoryEnginePreferences({ preferences: prefs2, memory });
      await bridge2.restore();
      expect(prefs2.getDensity()).toBe("verbose");
    });

    it("restores onboardingComplete flag", async () => {
      prefs.markOnboardingComplete();
      await bridge.persist();

      const prefs2 = makePrefs();
      const bridge2 = new MemoryEnginePreferences({ preferences: prefs2, memory });
      await bridge2.restore();
      expect(prefs2.isOnboardingComplete()).toBe(true);
    });

    it("returns false when recalled value is not an object", async () => {
      const badMemory: MemoryOrchestratorLike = {
        async memoryStore() {},
        async memoryRecall() {
          return [{ key: "uxPreferences", value: "not-an-object" }];
        },
      };
      const b = new MemoryEnginePreferences({ preferences: prefs, memory: badMemory });
      expect(await b.restore()).toBe(false);
    });

    it("returns false when memory recall throws", async () => {
      const errorMemory: MemoryOrchestratorLike = {
        async memoryStore() {},
        async memoryRecall() {
          throw new Error("recall failed");
        },
      };
      const b = new MemoryEnginePreferences({ preferences: prefs, memory: errorMemory });
      expect(await b.restore()).toBe(false);
    });
  });

  describe("verifyRoundTrip()", () => {
    it("returns false when no memory engine", async () => {
      const b = new MemoryEnginePreferences({ preferences: prefs });
      expect(await b.verifyRoundTrip()).toBe(false);
    });

    it("returns true for a successful persist→restore round-trip", async () => {
      prefs.applyTheme("ocean");
      prefs.update({ density: "compact" });
      prefs.markOnboardingComplete();
      expect(await bridge.verifyRoundTrip()).toBe(true);
    });
  });

  describe("getMemoryEnginePreferences() singleton", () => {
    it("returns the same instance", () => {
      const opts = { preferences: prefs, memory };
      const a = getMemoryEnginePreferences(opts);
      const b = getMemoryEnginePreferences();
      expect(a).toBe(b);
    });

    it("reset clears the singleton", () => {
      const a = getMemoryEnginePreferences({ preferences: prefs, memory });
      resetMemoryEnginePreferences();
      const b = getMemoryEnginePreferences({ preferences: makePrefs(), memory });
      expect(a).not.toBe(b);
    });

    it("throws if singleton not created and no opts provided", () => {
      expect(() => getMemoryEnginePreferences()).toThrow();
    });
  });
});
