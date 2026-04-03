// ============================================================================
// @dantecode/cli — Score C/D Measurement Tests (OnRamp v1.3)
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { measureAllDimensions } from "./scoring.js";

function makeTempDir(): string {
  const dir = join(tmpdir(), `scoring-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("measureAllDimensions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a ScoreReport with correct structure", () => {
    const report = measureAllDimensions(tempDir);

    expect(report).toHaveProperty("scoreC");
    expect(report).toHaveProperty("scoreD");
    expect(report).toHaveProperty("dimensions");
    expect(report).toHaveProperty("measuredAt");
    expect(typeof report.scoreC).toBe("number");
    expect(typeof report.scoreD).toBe("number");
    expect(Array.isArray(report.dimensions)).toBe(true);
  });

  it("has 11 dimensions (6 C + 5 D)", () => {
    const report = measureAllDimensions(tempDir);

    expect(report.dimensions).toHaveLength(11);

    const cDims = report.dimensions.filter((d) => d.category === "C");
    const dDims = report.dimensions.filter((d) => d.category === "D");

    expect(cDims).toHaveLength(6);
    expect(dDims).toHaveLength(5);
  });

  it("all scores are between 0 and 10", () => {
    const report = measureAllDimensions(tempDir);

    for (const dim of report.dimensions) {
      expect(dim.score).toBeGreaterThanOrEqual(0);
      expect(dim.score).toBeLessThanOrEqual(10);
    }
  });

  it("all dimensions have non-empty evidence", () => {
    const report = measureAllDimensions(tempDir);

    for (const dim of report.dimensions) {
      expect(dim.evidence.length).toBeGreaterThan(0);
    }
  });

  it("scoreC is the average of C dimensions", () => {
    const report = measureAllDimensions(tempDir);
    const cDims = report.dimensions.filter((d) => d.category === "C");
    const expectedAvg = cDims.reduce((sum, d) => sum + d.score, 0) / cDims.length;

    expect(report.scoreC).toBeCloseTo(expectedAvg, 5);
  });

  it("scoreD is the average of D dimensions", () => {
    const report = measureAllDimensions(tempDir);
    const dDims = report.dimensions.filter((d) => d.category === "D");
    const expectedAvg = dDims.reduce((sum, d) => sum + d.score, 0) / dDims.length;

    expect(report.scoreD).toBeCloseTo(expectedAvg, 5);
  });

  it("C-1 scores higher when sessions exist", () => {
    // Empty project — no sessions
    const report1 = measureAllDimensions(tempDir);
    const c1Before = report1.dimensions.find((d) => d.id === "C-1")!;

    // Create a session
    const sessionsDir = join(tempDir, ".dantecode", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "test.json"), "{}");

    const report2 = measureAllDimensions(tempDir);
    const c1After = report2.dimensions.find((d) => d.id === "C-1")!;

    expect(c1After.score).toBeGreaterThan(c1Before.score);
  });

  it("C-2 detects STATE.yaml presence", () => {
    // Create STATE.yaml
    const dcDir = join(tempDir, ".dantecode");
    mkdirSync(dcDir, { recursive: true });
    writeFileSync(join(dcDir, "STATE.yaml"), "model:\n  default:\n    provider: anthropic");

    const report = measureAllDimensions(tempDir);
    const c2 = report.dimensions.find((d) => d.id === "C-2")!;

    expect(c2.evidence).toContain("STATE.yaml: yes");
  });

  it("D-3 counts skills in .dantecode/skills/", () => {
    const skillsDir = join(tempDir, ".dantecode", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "skill1.md"), "# Skill");
    writeFileSync(join(skillsDir, "skill2.yaml"), "name: skill2");

    const report = measureAllDimensions(tempDir);
    const d3 = report.dimensions.find((d) => d.id === "D-3")!;

    expect(d3.evidence).toContain("2 skill(s)");
  });

  it("D-4 detects GitHub Actions", () => {
    mkdirSync(join(tempDir, ".github", "workflows"), { recursive: true });

    const report = measureAllDimensions(tempDir);
    const d4 = report.dimensions.find((d) => d.id === "D-4")!;

    expect(d4.evidence).toContain("GitHub Actions");
    expect(d4.score).toBeGreaterThanOrEqual(6);
  });

  it("D-5 detects README.md", () => {
    writeFileSync(join(tempDir, "README.md"), "# Hello");

    const report = measureAllDimensions(tempDir);
    const d5 = report.dimensions.find((d) => d.id === "D-5")!;

    expect(d5.evidence).toContain("README: yes");
    expect(d5.score).toBeGreaterThanOrEqual(6);
  });

  it("has correct dimension IDs", () => {
    const report = measureAllDimensions(tempDir);
    const ids = report.dimensions.map((d) => d.id);

    expect(ids).toContain("C-1");
    expect(ids).toContain("C-2");
    expect(ids).toContain("C-3");
    expect(ids).toContain("C-4");
    expect(ids).toContain("C-5");
    expect(ids).toContain("C-6");
    expect(ids).toContain("D-1");
    expect(ids).toContain("D-2");
    expect(ids).toContain("D-3");
    expect(ids).toContain("D-4");
    expect(ids).toContain("D-5");
  });
});
