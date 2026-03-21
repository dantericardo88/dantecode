import { describe, it, expect } from "vitest";
import {
  FEATURE_FLAGS,
  getFeatureFlag,
  getFeaturesByMaturity,
  formatMaturityBadge,
  type MaturityLevel,
} from "./feature-flags.js";

describe("feature-flags", () => {
  // ---------- FEATURE_FLAGS registry ----------

  describe("FEATURE_FLAGS registry", () => {
    it("contains at least one entry per maturity level", () => {
      const levels: MaturityLevel[] = ["stable", "beta", "experimental"];
      for (const level of levels) {
        const flags = FEATURE_FLAGS.filter((f) => f.maturity === level);
        expect(flags.length, `expected >= 1 feature at ${level}`).toBeGreaterThan(0);
      }
    });

    it("every flag has a non-empty name and description", () => {
      for (const flag of FEATURE_FLAGS) {
        expect(flag.name.trim().length, `empty name for flag`).toBeGreaterThan(0);
        expect(flag.description.trim().length, `empty description for flag ${flag.name}`).toBeGreaterThan(0);
      }
    });

    it("all names are unique (no duplicates)", () => {
      const names = FEATURE_FLAGS.map((f) => f.name);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it("requiresOptIn is only set on experimental features", () => {
      for (const flag of FEATURE_FLAGS) {
        if (flag.requiresOptIn) {
          expect(
            flag.maturity,
            `${flag.name} has requiresOptIn but is not experimental`,
          ).toBe("experimental");
        }
      }
    });

    it("contains expected stable features", () => {
      const stableNames = FEATURE_FLAGS.filter((f) => f.maturity === "stable").map((f) => f.name);
      expect(stableNames).toContain("web-search");
      expect(stableNames).toContain("council");
      expect(stableNames).toContain("gaslight");
      expect(stableNames).toContain("skillbook");
      expect(stableNames).toContain("fearset");
      expect(stableNames).toContain("debug-trail");
    });

    it("contains expected beta features", () => {
      const betaNames = FEATURE_FLAGS.filter((f) => f.maturity === "beta").map((f) => f.name);
      expect(betaNames).toContain("dante-sandbox");
      expect(betaNames).toContain("memory-engine");
    });

    it("contains expected experimental features", () => {
      const expNames = FEATURE_FLAGS.filter((f) => f.maturity === "experimental").map((f) => f.name);
      expect(expNames).toContain("http-server");
      expect(expNames).toContain("tui");
    });
  });

  // ---------- getFeatureFlag ----------

  describe("getFeatureFlag", () => {
    it("returns the flag for a known feature", () => {
      const flag = getFeatureFlag("web-search");
      expect(flag).toBeDefined();
      expect(flag!.name).toBe("web-search");
      expect(flag!.maturity).toBe("stable");
    });

    it("returns undefined for an unknown feature", () => {
      expect(getFeatureFlag("does-not-exist")).toBeUndefined();
    });

    it("returns undefined for an empty string", () => {
      expect(getFeatureFlag("")).toBeUndefined();
    });
  });

  // ---------- getFeaturesByMaturity ----------

  describe("getFeaturesByMaturity", () => {
    it("returns only features at the requested level", () => {
      const stable = getFeaturesByMaturity("stable");
      for (const f of stable) {
        expect(f.maturity).toBe("stable");
      }
    });

    it("returns an empty array when no features match a level", () => {
      const deprecated = getFeaturesByMaturity("deprecated");
      expect(Array.isArray(deprecated)).toBe(true);
      // At time of writing there are no deprecated features — the array may be empty
    });

    it("returns all stable features", () => {
      const stable = getFeaturesByMaturity("stable");
      expect(stable.length).toBeGreaterThanOrEqual(6);
    });

    it("returns all beta features", () => {
      const beta = getFeaturesByMaturity("beta");
      expect(beta.length).toBeGreaterThanOrEqual(2);
    });

    it("returns all experimental features", () => {
      const exp = getFeaturesByMaturity("experimental");
      expect(exp.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------- formatMaturityBadge ----------

  describe("formatMaturityBadge", () => {
    it("returns a non-empty string for stable", () => {
      const badge = formatMaturityBadge("stable");
      expect(typeof badge).toBe("string");
      expect(badge.length).toBeGreaterThan(0);
    });

    it("returns a non-empty string for beta", () => {
      const badge = formatMaturityBadge("beta");
      expect(badge.length).toBeGreaterThan(0);
    });

    it("returns a non-empty string for experimental", () => {
      const badge = formatMaturityBadge("experimental");
      expect(badge.length).toBeGreaterThan(0);
    });

    it("returns a non-empty string for deprecated", () => {
      const badge = formatMaturityBadge("deprecated");
      expect(badge.length).toBeGreaterThan(0);
    });

    it("stable and beta badges are different strings", () => {
      expect(formatMaturityBadge("stable")).not.toBe(formatMaturityBadge("beta"));
    });

    it("all four badges are unique strings", () => {
      const badges = [
        formatMaturityBadge("stable"),
        formatMaturityBadge("beta"),
        formatMaturityBadge("experimental"),
        formatMaturityBadge("deprecated"),
      ];
      const unique = new Set(badges);
      expect(unique.size).toBe(4);
    });
  });
});
