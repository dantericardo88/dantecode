/**
 * STANDARD DANTEFORGE TEST MOCK
 *
 * @dantecode/danteforge is an obfuscated compiled binary.
 * NEVER use vi.importActual("@dantecode/danteforge") in tests — it will
 * crash the Vitest worker with cryptic initialization errors from the binary.
 *
 * Always use vi.mock("@dantecode/danteforge", () => createDanteforgeMock())
 * or pass overrides for the specific symbols under test.
 *
 * @example
 * vi.mock("@dantecode/danteforge", () => createDanteforgeMock());
 *
 * @example With overrides:
 * vi.mock("@dantecode/danteforge", () =>
 *   createDanteforgeMock({
 *     runLocalPDSEScorer: vi.fn().mockReturnValue({ overall: 55, passedGate: false, ... }),
 *   }),
 * );
 */

import { vi } from "vitest";

export interface DanteforgeMockShape {
  runLocalPDSEScorer: ReturnType<typeof vi.fn>;
  runGStack: ReturnType<typeof vi.fn>;
  allGStackPassed: ReturnType<typeof vi.fn>;
  summarizeGStackResults: ReturnType<typeof vi.fn>;
  queryLessons: ReturnType<typeof vi.fn>;
  formatLessonsForPrompt: ReturnType<typeof vi.fn>;
  runAutoforgeIAL: ReturnType<typeof vi.fn>;
  formatBladeProgressLine: ReturnType<typeof vi.fn>;
  runConstitutionCheck: ReturnType<typeof vi.fn>;
  detectAndRecordPatterns: ReturnType<typeof vi.fn>;
  recordSuccessPattern: ReturnType<typeof vi.fn>;
}

/** Default PDSE score returned by the mock scorer — passes the gate. */
export const DEFAULT_MOCK_PDSE_SCORE = {
  overall: 92,
  completeness: 92,
  correctness: 92,
  clarity: 92,
  consistency: 92,
  passedGate: true,
  violations: [] as unknown[],
  scoredAt: "2026-01-01T00:00:00.000Z",
  scoredBy: "mock",
};

/**
 * Create a complete danteforge mock object with sensible defaults.
 * Pass overrides to replace specific symbol stubs for targeted tests.
 */
export function createDanteforgeMock(
  overrides: Partial<DanteforgeMockShape> = {},
): DanteforgeMockShape {
  return {
    runLocalPDSEScorer: vi.fn().mockReturnValue(DEFAULT_MOCK_PDSE_SCORE),
    runGStack: vi.fn().mockResolvedValue([]),
    allGStackPassed: vi.fn().mockReturnValue(true),
    summarizeGStackResults: vi.fn().mockReturnValue("All GStack checks passed"),
    queryLessons: vi.fn().mockResolvedValue([]),
    formatLessonsForPrompt: vi.fn().mockReturnValue(""),
    runAutoforgeIAL: vi.fn().mockResolvedValue({ success: true, output: "" }),
    formatBladeProgressLine: vi.fn().mockReturnValue(""),
    runConstitutionCheck: vi.fn().mockReturnValue({ violations: [] }),
    detectAndRecordPatterns: vi.fn().mockResolvedValue([]),
    recordSuccessPattern: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}
