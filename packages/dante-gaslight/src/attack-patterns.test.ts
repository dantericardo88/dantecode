// ============================================================================
// @dantecode/dante-gaslight — Attack Pattern Library Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { AttackPatternLibrary } from "./attack-patterns.js";

describe("AttackPatternLibrary", () => {
  let library: AttackPatternLibrary;

  beforeEach(() => {
    library = new AttackPatternLibrary();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Pattern retrieval by category
  // ──────────────────────────────────────────────────────────────────────────

  describe("getPatterns", () => {
    it("returns all patterns when no category filter is provided", () => {
      const patterns = library.getPatterns();
      expect(patterns.length).toBeGreaterThanOrEqual(15);
    });

    it("filters patterns by category", () => {
      const injections = library.getPatterns("prompt-injection");
      expect(injections.length).toBe(3);
      expect(injections.every((p) => p.category === "prompt-injection")).toBe(true);

      const hallucinations = library.getPatterns("hallucination");
      expect(hallucinations.length).toBe(3);
      expect(hallucinations.every((p) => p.category === "hallucination")).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Individual pattern retrieval
  // ──────────────────────────────────────────────────────────────────────────

  describe("getPattern", () => {
    it("retrieves a specific pattern by name", () => {
      const pattern = library.getPattern("system-override");
      expect(pattern).toBeDefined();
      expect(pattern!.category).toBe("prompt-injection");
      expect(pattern!.severity).toBe("critical");
    });

    it("returns undefined for non-existent pattern", () => {
      expect(library.getPattern("nonexistent")).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Coverage calculation
  // ──────────────────────────────────────────────────────────────────────────

  describe("calculateCoverage", () => {
    it("returns 100% when all categories are tested", () => {
      const allCategories = library.getCategories();
      const coverage = library.calculateCoverage(allCategories);
      expect(coverage).toBe(100);
    });

    it("returns partial coverage for incomplete testing", () => {
      const coverage = library.calculateCoverage(["prompt-injection", "hallucination"]);
      // 2/5 categories = 40%
      expect(coverage).toBe(40);
    });

    it("returns 0% when no categories are tested", () => {
      const coverage = library.calculateCoverage([]);
      expect(coverage).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Categories
  // ──────────────────────────────────────────────────────────────────────────

  describe("getCategories", () => {
    it("returns all 5 categories", () => {
      const categories = library.getCategories();
      expect(categories).toHaveLength(5);
      expect(categories).toContain("prompt-injection");
      expect(categories).toContain("hallucination");
      expect(categories).toContain("reasoning-trap");
      expect(categories).toContain("consistency");
      expect(categories).toContain("edge-case");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Severity levels
  // ──────────────────────────────────────────────────────────────────────────

  describe("severity levels", () => {
    it("contains patterns across all severity levels", () => {
      const patterns = library.getPatterns();
      const severities = new Set(patterns.map((p) => p.severity));
      expect(severities.has("critical")).toBe(true);
      expect(severities.has("high")).toBe(true);
      expect(severities.has("medium")).toBe(true);
      expect(severities.has("low")).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Pattern structure
  // ──────────────────────────────────────────────────────────────────────────

  describe("pattern structure", () => {
    it("every pattern has all required fields", () => {
      const patterns = library.getPatterns();
      for (const p of patterns) {
        expect(typeof p.name).toBe("string");
        expect(p.name.length).toBeGreaterThan(0);
        expect(typeof p.category).toBe("string");
        expect(typeof p.severity).toBe("string");
        expect(typeof p.prompt).toBe("string");
        expect(typeof p.expectedFailureMode).toBe("string");
        expect(typeof p.description).toBe("string");
      }
    });
  });
});
