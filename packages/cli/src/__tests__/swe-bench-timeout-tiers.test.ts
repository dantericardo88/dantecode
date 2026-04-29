// Tests for selectInstanceTimeout — Pattern D mitigation. Per-repo agent
// timeout tiers prevent the single 600s default from wasting budget on
// small repos and starving large ones. Caller override always wins so
// the harness/tests can bypass the table.

import { describe, it, expect } from "vitest";
import { selectInstanceTimeout } from "../swe-bench-runner.js";

describe("selectInstanceTimeout", () => {
  it("returns the small-tier 240s for known small repos", () => {
    expect(selectInstanceTimeout("psf/requests")).toBe(240_000);
    expect(selectInstanceTimeout("pallets/flask")).toBe(240_000);
  });

  it("returns the large-tier 1200s for repos with C extensions", () => {
    expect(selectInstanceTimeout("astropy/astropy")).toBe(1_200_000);
    expect(selectInstanceTimeout("matplotlib/matplotlib")).toBe(1_200_000);
    expect(selectInstanceTimeout("scipy/scipy")).toBe(1_200_000);
    expect(selectInstanceTimeout("scikit-learn/scikit-learn")).toBe(1_200_000);
  });

  it("returns the default 600s for unknown repos", () => {
    expect(selectInstanceTimeout("django/django")).toBe(600_000);
    expect(selectInstanceTimeout("pytest-dev/pytest")).toBe(600_000);
    expect(selectInstanceTimeout("sympy/sympy")).toBe(600_000);
  });

  it("caller override wins over the tier table", () => {
    expect(selectInstanceTimeout("astropy/astropy", 30_000)).toBe(30_000);
    expect(selectInstanceTimeout("psf/requests", 999_000)).toBe(999_000);
  });

  it("ignores zero/negative overrides (tier table wins)", () => {
    // Zero is not a sane timeout — fall through to the tier rules so a
    // mis-passed `0` doesn't pin every instance at instant-fail.
    expect(selectInstanceTimeout("astropy/astropy", 0)).toBe(1_200_000);
    expect(selectInstanceTimeout("psf/requests", -1)).toBe(240_000);
  });

  it("returns the same number for the same repo on repeated calls", () => {
    const a = selectInstanceTimeout("astropy/astropy");
    const b = selectInstanceTimeout("astropy/astropy");
    expect(a).toBe(b);
  });
});
