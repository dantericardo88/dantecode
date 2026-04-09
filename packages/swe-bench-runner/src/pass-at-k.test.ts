// ============================================================================
// @dantecode/swe-bench-runner — pass@k Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { passAtK, computePassAtK } from "./pass-at-k.js";

describe("passAtK", () => {
  it("passAtK(1, 1, 1) === 1.0", () => {
    expect(passAtK(1, 1, 1)).toBeCloseTo(1.0);
  });

  it("passAtK(1, 0, 1) === 0.0", () => {
    expect(passAtK(1, 0, 1)).toBeCloseTo(0.0);
  });

  it("passAtK(10, 5, 1) is approximately 0.5", () => {
    // With n=10, c=5, k=1: 1 - C(5,1)/C(10,1) = 1 - 5/10 = 0.5
    expect(passAtK(10, 5, 1)).toBeCloseTo(0.5, 5);
  });

  it("computePassAtK computes mean pass@1 across instances", () => {
    const results = new Map<string, boolean[]>([
      ["inst-1", [true]],
      ["inst-2", [false]],
      ["inst-3", [true]],
      ["inst-4", [true]],
    ]);
    // Each instance has n=1; pass@1 = 1.0, 0.0, 1.0, 1.0 → mean = 0.75
    const score = computePassAtK(results, 1);
    expect(score).toBeCloseTo(0.75, 5);
  });

  it("passAtK when k >= n returns 1.0 if any correct", () => {
    // k=5, n=3, c=1 → k >= n so if c>0 return 1.0
    expect(passAtK(3, 1, 5)).toBe(1.0);
    // k=5, n=3, c=0 → k >= n but c=0 so return 0.0
    expect(passAtK(3, 0, 5)).toBe(0.0);
  });
});
