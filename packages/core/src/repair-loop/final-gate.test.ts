/**
 * final-gate.test.ts
 *
 * Tests for DanteForge final gate verification
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFinalGate, formatFinalGateResult, type FinalGateConfig } from "./final-gate.js";
import type { EventEngine } from "../event-engine.js";

describe("final-gate", () => {
  const projectRoot = "/test/project";
  const mutatedFiles = ["src/index.ts", "src/utils.ts"];

  const defaultConfig: FinalGateConfig = {
    enabled: true,
    pdseThreshold: 70,
    requireAntiStub: true,
    requireEvidence: false,
  };

  // Mock DanteForge module
  const createMockDanteForge = (pdseScore = 85, hasAntiStubViolations = false) => ({
    runLocalPDSEScorer: vi.fn((_content: string) => ({
      completeness: 90,
      correctness: 88,
      clarity: 82,
      consistency: 80,
      overall: pdseScore,
      violations: [],
      passedGate: pdseScore >= 85,
      scoredAt: new Date().toISOString(),
      scoredBy: "local-heuristic",
    })),
    runAntiStubScanner: vi.fn((_content: string) => ({
      hardViolations: hasAntiStubViolations
        ? [{ line: 10, message: "TODO comment detected", severity: "hard" }]
        : [],
      softViolations: [],
      passed: !hasAntiStubViolations,
      scannedLines: 100,
      filePath: "test.ts",
    })),
  });

  // Mock evidence sealer
  const createMockEvidenceSealer = () => {
    return class MockSealer {
      seal(_sessionId: string, _evidence: any, _config: any, _metrics: any) {
        return {
          sealId: "seal_test123",
          timestamp: new Date().toISOString(),
        };
      }
    };
  };

  // Mock file system
  beforeEach(() => {
    vi.mock("node:fs", () => ({
      readFileSync: vi.fn((path: string) => {
        if (path.includes("index.ts")) {
          return "export function foo() { return 42; }";
        }
        if (path.includes("utils.ts")) {
          return "export function bar() { return 'test'; }";
        }
        throw new Error("File not found");
      }),
    }));
  });

  describe("PDSE scoring integration", () => {
    it("should pass when PDSE score exceeds threshold", async () => {
      const mockDanteForge = createMockDanteForge(85, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(true);
      expect(result.pdseScore).toBe(85);
      expect(result.pdseDetails).toBeDefined();
      expect(result.pdseDetails?.completeness).toBe(90);
      expect(result.failureReasons).toHaveLength(0);
    });

    it("should fail when PDSE score below threshold", async () => {
      const mockDanteForge = createMockDanteForge(65, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(false);
      expect(result.pdseScore).toBe(65);
      expect(result.failureReasons).toContain("PDSE score 65.0 below threshold 70");
    });

    it("should average PDSE scores across multiple files", async () => {
      const mockDanteForge = {
        runLocalPDSEScorer: vi
          .fn()
          .mockReturnValueOnce({
            completeness: 100,
            correctness: 100,
            clarity: 100,
            consistency: 100,
            overall: 100,
            violations: [],
          })
          .mockReturnValueOnce({
            completeness: 60,
            correctness: 60,
            clarity: 60,
            consistency: 60,
            overall: 60,
            violations: [],
          }),
        runAntiStubScanner: vi.fn(() => ({
          hardViolations: [],
          softViolations: [],
          passed: true,
          scannedLines: 100,
        })),
      };

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.pdseScore).toBe(80); // (100 + 60) / 2
      expect(result.pdseDetails?.completeness).toBe(80); // (100 + 60) / 2
    });

    it("should collect PDSE violations from all files", async () => {
      const mockDanteForge = {
        runLocalPDSEScorer: vi.fn(() => ({
          completeness: 70,
          correctness: 70,
          clarity: 70,
          consistency: 70,
          overall: 70,
          violations: [
            { line: 5, message: "Empty function", severity: "soft" },
            { line: 10, message: "Long line", severity: "soft" },
          ],
        })),
        runAntiStubScanner: vi.fn(() => ({
          hardViolations: [],
          softViolations: [],
          passed: true,
          scannedLines: 100,
        })),
      };

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(true); // Score meets threshold
    });

    it("should handle PDSE scoring errors gracefully", async () => {
      const mockDanteForge = {
        runLocalPDSEScorer: vi.fn(() => {
          throw new Error("Scoring failed");
        }),
        runAntiStubScanner: vi.fn(() => ({
          hardViolations: [],
          softViolations: [],
          passed: true,
          scannedLines: 100,
        })),
      };

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.pdseScore).toBe(0);
      expect(result.passed).toBe(false);
    });

    it("should return zero PDSE score when no files processed", async () => {
      const mockDanteForge = createMockDanteForge(85, false);

      const result = await runFinalGate({
        mutatedFiles: [],
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.pdseScore).toBe(0);
      expect(result.passed).toBe(false);
    });

    it("should include PDSE details in result", async () => {
      const mockDanteForge = createMockDanteForge(85, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.pdseDetails).toEqual({
        completeness: 90,
        correctness: 88,
        clarity: 82,
        consistency: 80,
      });
    });

    it("should respect custom PDSE threshold", async () => {
      const mockDanteForge = createMockDanteForge(75, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, pdseThreshold: 80 },
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(false);
      expect(result.failureReasons).toContain("PDSE score 75.0 below threshold 80");
    });
  });

  describe("anti-stub detection", () => {
    it("should pass when no anti-stub violations", async () => {
      const mockDanteForge = createMockDanteForge(85, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(true);
      expect(result.antiStubViolations).toHaveLength(0);
    });

    it("should fail when anti-stub violations detected", async () => {
      const mockDanteForge = createMockDanteForge(85, true);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(false);
      expect(result.antiStubViolations.length).toBeGreaterThan(0);
      expect(result.failureReasons).toContain("2 anti-stub violation(s) detected");
    });

    it("should collect anti-stub violations from all files", async () => {
      const mockDanteForge = {
        runLocalPDSEScorer: vi.fn(() => ({
          completeness: 85,
          correctness: 85,
          clarity: 85,
          consistency: 85,
          overall: 85,
          violations: [],
        })),
        runAntiStubScanner: vi.fn(() => ({
          hardViolations: [
            { line: 5, message: "TODO comment", severity: "hard" },
            { line: 15, message: "FIXME comment", severity: "hard" },
          ],
          softViolations: [],
          passed: false,
          scannedLines: 100,
        })),
      };

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.antiStubViolations.length).toBeGreaterThan(0);
      expect(result.passed).toBe(false);
    });

    it("should skip anti-stub detection when not required", async () => {
      const mockDanteForge = createMockDanteForge(85, true);

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, requireAntiStub: false },
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(true); // Passes despite violations because not required
      expect(result.antiStubViolations).toHaveLength(0);
    });

    it("should handle anti-stub scan errors gracefully", async () => {
      const mockDanteForge = {
        runLocalPDSEScorer: vi.fn(() => ({
          completeness: 85,
          correctness: 85,
          clarity: 85,
          consistency: 85,
          overall: 85,
          violations: [],
        })),
        runAntiStubScanner: vi.fn(() => {
          throw new Error("Scan failed");
        }),
      };

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      // Should capture error in violations
      expect(result.antiStubViolations.length).toBeGreaterThan(0);
      expect(result.passed).toBe(false);
    });

    it("should format anti-stub violation messages correctly", async () => {
      const mockDanteForge = {
        runLocalPDSEScorer: vi.fn(() => ({
          completeness: 85,
          correctness: 85,
          clarity: 85,
          consistency: 85,
          overall: 85,
          violations: [],
        })),
        runAntiStubScanner: vi.fn((_content, _projectRoot, filePath) => ({
          hardViolations: [{ line: 10, message: "TODO detected", severity: "hard" }],
          softViolations: [],
          passed: false,
          scannedLines: 100,
          filePath,
        })),
      };

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.antiStubViolations[0]).toMatch(/src\/index\.ts:10 - TODO detected/);
    });
  });

  describe("threshold enforcement", () => {
    it("should enforce PDSE threshold correctly", async () => {
      const mockDanteForge = createMockDanteForge(69, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, pdseThreshold: 70 },
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(false);
    });

    it("should pass when score exactly meets threshold", async () => {
      const mockDanteForge = createMockDanteForge(70, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, pdseThreshold: 70 },
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(true);
    });

    it("should fail when both PDSE and anti-stub fail", async () => {
      const mockDanteForge = createMockDanteForge(65, true);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(false);
      expect(result.failureReasons.length).toBeGreaterThanOrEqual(2);
    });

    it("should use default threshold of 70", async () => {
      const mockDanteForge = createMockDanteForge(69, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.failureReasons[0]).toContain("below threshold 70");
    });

    it("should handle high threshold (90+)", async () => {
      const mockDanteForge = createMockDanteForge(85, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, pdseThreshold: 90 },
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(false);
      expect(result.failureReasons[0]).toContain("below threshold 90");
    });
  });

  describe("evidence chain sealing", () => {
    it("should create evidence seal when required and gate passes", async () => {
      const mockDanteForge = createMockDanteForge(85, false);
      const mockSealer = createMockEvidenceSealer();

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, requireEvidence: true },
        projectRoot,
        danteForgeModule: mockDanteForge,
        evidenceSealer: mockSealer,
      });

      expect(result.passed).toBe(true);
      expect(result.evidenceChain).toBe("seal_test123");
    });

    it("should not create evidence seal when gate fails", async () => {
      const mockDanteForge = createMockDanteForge(65, false);
      const mockSealer = createMockEvidenceSealer();

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, requireEvidence: true },
        projectRoot,
        danteForgeModule: mockDanteForge,
        evidenceSealer: mockSealer,
      });

      expect(result.passed).toBe(false);
      expect(result.evidenceChain).toBeUndefined();
    });

    it("should skip evidence seal when not required", async () => {
      const mockDanteForge = createMockDanteForge(85, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: { ...defaultConfig, requireEvidence: false },
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.passed).toBe(true);
      expect(result.evidenceChain).toBeUndefined();
    });
  });

  describe("run report integration", () => {
    it("should include timestamp in result", async () => {
      const mockDanteForge = createMockDanteForge(85, false);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });

    it("should collect all failure reasons", async () => {
      const mockDanteForge = createMockDanteForge(65, true);

      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
      });

      expect(result.failureReasons).toContain("PDSE score 65.0 below threshold 70");
      expect(result.failureReasons.some((r) => r.includes("anti-stub"))).toBe(true);
    });

    it("should emit events when event engine provided", async () => {
      const mockDanteForge = createMockDanteForge(85, false);
      const eventEngine = {
        emit: vi.fn(),
      } as unknown as EventEngine;

      await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: mockDanteForge,
        eventEngine,
      });

      expect(eventEngine.emit).toHaveBeenCalledTimes(2);
      expect(eventEngine.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "repair.final_gate.started",
          taskId: expect.any(String),
          payload: expect.objectContaining({
            filesCount: mutatedFiles.length,
            threshold: defaultConfig.pdseThreshold,
          }),
        }),
      );
      expect(eventEngine.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "repair.final_gate.completed",
          taskId: expect.any(String),
          payload: expect.objectContaining({
            passed: true,
          }),
        }),
      );
    });
  });

  describe("DanteForge unavailable", () => {
    it("should fail-closed when DanteForge not available", async () => {
      const result = await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: null, // null explicitly means unavailable
      });

      expect(result.passed).toBe(false);
      expect(result.pdseScore).toBeUndefined();
      expect(result.failureReasons).toContain("DanteForge not available - cannot verify");
    });

    it("should emit failure event when DanteForge unavailable", async () => {
      const eventEngine = {
        emit: vi.fn(),
      } as unknown as EventEngine;

      await runFinalGate({
        mutatedFiles,
        config: defaultConfig,
        projectRoot,
        danteForgeModule: null,
        eventEngine,
      });

      expect(eventEngine.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "repair.final_gate.completed",
          taskId: expect.any(String),
          payload: expect.objectContaining({
            passed: false,
            reason: "danteforge_unavailable",
          }),
        }),
      );
    });
  });

  describe("formatFinalGateResult", () => {
    it("should format passing result", () => {
      const result = formatFinalGateResult({
        passed: true,
        pdseScore: 85,
        pdseDetails: {
          completeness: 90,
          correctness: 88,
          clarity: 82,
          consistency: 80,
        },
        antiStubViolations: [],
        timestamp: new Date().toISOString(),
        failureReasons: [],
      });

      expect(result).toContain("✓ Final gate PASSED");
      expect(result).toContain("PDSE Score: 85.0/100");
    });

    it("should format failing result with violations", () => {
      const result = formatFinalGateResult({
        passed: false,
        pdseScore: 65,
        pdseDetails: {
          completeness: 70,
          correctness: 70,
          clarity: 60,
          consistency: 60,
        },
        antiStubViolations: ["file1:10 - TODO", "file2:20 - FIXME"],
        timestamp: new Date().toISOString(),
        failureReasons: ["PDSE score 65.0 below threshold 70", "2 anti-stub violation(s) detected"],
      });

      expect(result).toContain("✗ Final gate FAILED");
      expect(result).toContain("Anti-stub violations: 2");
      expect(result).toContain("Failure reasons:");
    });

    it("should format evidence chain when present", () => {
      const result = formatFinalGateResult({
        passed: true,
        pdseScore: 85,
        antiStubViolations: [],
        evidenceChain: "seal_test123",
        timestamp: new Date().toISOString(),
        failureReasons: [],
      });

      expect(result).toContain("Evidence chain: seal_test123");
    });

    it("should limit anti-stub violations in output", () => {
      const violations = Array.from({ length: 10 }, (_, i) => `file${i}:10 - TODO`);
      const result = formatFinalGateResult({
        passed: false,
        pdseScore: 65,
        antiStubViolations: violations,
        timestamp: new Date().toISOString(),
        failureReasons: [],
      });

      expect(result).toContain("... and 7 more");
    });
  });
});
