import { describe, it, expect } from "vitest";
import { verifyCompletion, deriveWaveExpectations } from "@dantecode/core";

// These tests validate that the completion verifier and wave expectations
// derivation work correctly when used as integrated by agent-loop.ts.

describe("deliverables-verification (Wave 1 integration)", () => {
  describe("verifyCompletion", () => {
    it("returns 'complete' when all expected files exist", async () => {
      // Use actual project files as test targets (files known to have content)
      const result = await verifyCompletion(process.cwd(), {
        expectedFiles: ["package.json"],
        intentDescription: "Test deliverables",
      });
      expect(result.verdict).toBe("complete");
      expect(result.failed).toHaveLength(0);
      expect(result.passed.length).toBeGreaterThan(0);
    });

    it("returns 'failed' when expected files do not exist", async () => {
      const result = await verifyCompletion(process.cwd(), {
        expectedFiles: ["nonexistent-file-abc123.ts", "another-missing-file.ts"],
        intentDescription: "Missing deliverables",
      });
      expect(result.verdict).toBe("failed");
      expect(result.failed.length).toBe(2);
      expect(result.passed).toHaveLength(0);
    });

    it("returns 'partial' when some files exist and some don't", async () => {
      const result = await verifyCompletion(process.cwd(), {
        expectedFiles: ["package.json", "nonexistent-file-xyz789.ts"],
        intentDescription: "Partial deliverables",
      });
      expect(result.verdict).toBe("partial");
      expect(result.passed.length).toBe(1);
      expect(result.failed.length).toBe(1);
    });

    it("returns 'failed' with low confidence when no concrete expectations", async () => {
      const result = await verifyCompletion(process.cwd(), {
        intentDescription: "Research only wave",
      });
      expect(result.verdict).toBe("failed");
      expect(result.confidence).toBe("low");
    });
  });

  describe("deriveWaveExpectations", () => {
    it("extracts file paths from wave instructions", () => {
      const wave = {
        number: 1,
        title: "Create modules",
        instructions: "Create `src/utils.ts` and write `src/helpers.ts` with helper functions",
        steps: [],
        status: "pending" as const,
      };
      const expectations = deriveWaveExpectations(wave);
      expect(expectations.expectedFiles).toBeDefined();
      expect(expectations.expectedFiles!.length).toBeGreaterThan(0);
      expect(expectations.intentDescription).toBe("Create modules");
    });

    it("returns empty expectedFiles for research-only waves", () => {
      const wave = {
        number: 2,
        title: "Research patterns",
        instructions: "Analyze the codebase and identify patterns used for error handling",
        steps: [],
        status: "pending" as const,
      };
      const expectations = deriveWaveExpectations(wave);
      // Research waves have no file creation instructions
      expect(
        !expectations.expectedFiles || expectations.expectedFiles.length === 0,
      ).toBe(true);
    });
  });

  describe("wave verification retry logic", () => {
    it("verification results include summary for display", async () => {
      const result = await verifyCompletion(process.cwd(), {
        expectedFiles: ["package.json"],
        intentDescription: "Single file check",
      });
      expect(result.summary).toBeTruthy();
      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    });

    it("verification failed array contains descriptive messages", async () => {
      const result = await verifyCompletion(process.cwd(), {
        expectedFiles: ["does-not-exist-7890.ts"],
      });
      expect(result.failed.length).toBe(1);
      expect(result.failed[0]).toContain("does-not-exist-7890.ts");
    });
  });
});
