import { describe, it, expect } from "vitest";
import {
  buildGaslighterPrompt,
  parseGaslighterOutput,
  buildFallbackCritique,
  GASLIGHTER_SYSTEM_PROMPT,
} from "./gaslighter-role.js";

describe("buildGaslighterPrompt", () => {
  it("includes iteration number and draft", () => {
    const prompt = buildGaslighterPrompt("This is a draft answer.", 2);
    expect(prompt).toContain("Iteration 2");
    expect(prompt).toContain("This is a draft answer.");
  });
});

describe("parseGaslighterOutput", () => {
  const valid = JSON.stringify({
    points: [
      { aspect: "shallow-reasoning", description: "Too shallow", severity: "high" },
      { aspect: "missing-evidence", description: "No sources", severity: "medium" },
    ],
    summary: "Needs significant work.",
    needsEvidenceEscalation: true,
  });

  it("parses valid output", () => {
    const critique = parseGaslighterOutput(`Some preamble\n${valid}`, 1);
    expect(critique).not.toBeNull();
    expect(critique?.points).toHaveLength(2);
    expect(critique?.summary).toBe("Needs significant work.");
    expect(critique?.needsEvidenceEscalation).toBe(true);
    expect(critique?.iteration).toBe(1);
  });

  it("returns null for non-JSON", () => {
    expect(parseGaslighterOutput("No JSON here", 1)).toBeNull();
  });

  it("filters invalid aspect values", () => {
    const badAspect = JSON.stringify({ points: [{ aspect: "invalid-aspect", description: "D", severity: "high" }], summary: "S", needsEvidenceEscalation: false });
    const critique = parseGaslighterOutput(badAspect, 1);
    expect(critique?.points).toHaveLength(0);
  });

  it("handles missing points gracefully", () => {
    const noPoints = JSON.stringify({ summary: "S", needsEvidenceEscalation: false });
    const critique = parseGaslighterOutput(noPoints, 1);
    expect(critique?.points).toHaveLength(0);
  });
});

describe("buildFallbackCritique", () => {
  it("short draft triggers shallow-reasoning point", () => {
    const critique = buildFallbackCritique("Short.", 1);
    expect(critique.points.some(p => p.aspect === "shallow-reasoning")).toBe(true);
  });

  it("long draft has no points", () => {
    const longDraft = "word ".repeat(60);
    const critique = buildFallbackCritique(longDraft, 1);
    expect(critique.points).toHaveLength(0);
  });
});

describe("GASLIGHTER_SYSTEM_PROMPT", () => {
  it("mentions JSON output format", () => {
    expect(GASLIGHTER_SYSTEM_PROMPT).toContain("JSON");
  });

  it("lists valid aspects", () => {
    expect(GASLIGHTER_SYSTEM_PROMPT).toContain("shallow-reasoning");
  });
});
