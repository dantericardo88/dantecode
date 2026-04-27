import { describe, expect, it } from "vitest";
import { detectUnverifiedScoreClaims } from "../score-claim-validator.js";

const NO_OUTPUTS: string[] = [];
const SOME_OUTPUT = ["danteforge improve: done"];

describe("detectUnverifiedScoreClaims", () => {
  it("returns null when no improvement command ran this session", () => {
    const result = detectUnverifiedScoreClaims(
      "The score is 7.5/10 which is great!",
      NO_OUTPUTS,
      false,
      null,
    );
    expect(result).toBeNull();
  });

  it("returns null when response has no score patterns", () => {
    const result = detectUnverifiedScoreClaims(
      "The refactor is complete. All tests pass.",
      SOME_OUTPUT,
      true,
      null,
    );
    expect(result).toBeNull();
  });

  it("returns warning when score claim present but no verified score output", () => {
    const result = detectUnverifiedScoreClaims(
      "Score improved to 8.5/10 after the changes.",
      SOME_OUTPUT,
      true,
      null,
    );
    expect(result).not.toBeNull();
    expect(result).toContain("could not be verified");
  });

  it("returns null when claimed values appear in verified score output", () => {
    const verifiedOutput = "PDSE score: 8.5/10 — 3 dimensions improved";
    const result = detectUnverifiedScoreClaims(
      "The score is now 8.5/10.",
      SOME_OUTPUT,
      true,
      verifiedOutput,
    );
    expect(result).toBeNull();
  });

  it("detects 7.5/10 pattern", () => {
    const result = detectUnverifiedScoreClaims(
      "Quality went from 6 to 7.5/10.",
      SOME_OUTPUT,
      true,
      null,
    );
    expect(result).not.toBeNull();
  });

  it("detects PDSE: 75 pattern", () => {
    const result = detectUnverifiedScoreClaims(
      "PDSE: 75 — excellent progress made.",
      SOME_OUTPUT,
      true,
      null,
    );
    expect(result).not.toBeNull();
  });

  it("detects 'improved from 6' pattern", () => {
    const result = detectUnverifiedScoreClaims(
      "The dimension improved from 6 to a higher value.",
      SOME_OUTPUT,
      true,
      null,
    );
    expect(result).not.toBeNull();
  });

  it("detects '+1.2 dimensions' pattern", () => {
    const result = detectUnverifiedScoreClaims(
      "We gained +1.2 dimensions across the board.",
      SOME_OUTPUT,
      true,
      null,
    );
    expect(result).not.toBeNull();
  });
});
