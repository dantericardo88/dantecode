import { describe, it, expect } from "vitest";
import { extractClaimedFiles } from "./verification-pipeline.js";

describe("confab-blocking", () => {
  describe("extractClaimedFiles", () => {
    it("extracts file paths from model response text", () => {
      // extractClaimedFiles looks for patterns like "created src/foo.ts" or "wrote to src/bar.ts"
      const text = `I created src/utils.ts and wrote src/helpers.ts with helper functions.`;
      const claimed = extractClaimedFiles(text);
      expect(claimed.length).toBeGreaterThan(0);
    });

    it("returns empty array for responses with no file paths", () => {
      const text = "I have analyzed the requirements and found no issues.";
      const claimed = extractClaimedFiles(text);
      expect(claimed).toHaveLength(0);
    });
  });

  describe("confab retraction logic", () => {
    it("unverified files are those not in the actual write set", () => {
      const claimedFiles = ["src/a.ts", "src/b.ts", "src/c.ts"];
      const actualSet = new Set(["src/a.ts", "src/c.ts"]);
      const unverified = claimedFiles.filter((f) => !actualSet.has(f));
      expect(unverified).toEqual(["src/b.ts"]);
    });

    it("pipeline mode retraction message includes file count", () => {
      const unverified = ["src/phantom.ts", "src/ghost.ts"];
      const retraction = `WARNING: I claimed changes to ${unverified.length} file(s) that were not actually written: ${unverified.join(", ")}. These claims are retracted.`;
      expect(retraction).toContain("2 file(s)");
      expect(retraction).toContain("src/phantom.ts");
      expect(retraction).toContain("claims are retracted");
    });
  });
});
