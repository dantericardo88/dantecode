import { describe, it, expect } from "vitest";
import { deriveWaveExpectations } from "./skill-wave-orchestrator.js";

describe("deriveWaveExpectations", () => {
  it("extracts file paths from create/write instructions", () => {
    const wave = {
      number: 1,
      title: "Setup",
      instructions: "Create packages/core/src/helper.ts and write packages/cli/src/main.ts",
    };
    const result = deriveWaveExpectations(wave);
    expect(result.expectedFiles).toContain("packages/core/src/helper.ts");
    expect(result.expectedFiles).toContain("packages/cli/src/main.ts");
  });

  it("extracts backtick-quoted paths", () => {
    const wave = {
      number: 2,
      title: "Implementation",
      instructions: "Modify `src/utils/parser.ts` and update `src/index.ts`",
    };
    const result = deriveWaveExpectations(wave);
    expect(result.expectedFiles).toContain("src/utils/parser.ts");
    expect(result.expectedFiles).toContain("src/index.ts");
  });

  it("deduplicates paths", () => {
    const wave = {
      number: 1,
      title: "Setup",
      instructions: "Create `src/a.ts`. Then write src/a.ts again.",
    };
    const result = deriveWaveExpectations(wave);
    const count = result.expectedFiles!.filter((f) => f === "src/a.ts").length;
    expect(count).toBe(1);
  });

  it("returns undefined expectedFiles for research-only waves", () => {
    const wave = {
      number: 1,
      title: "Research",
      instructions: "Read the existing codebase and understand the architecture",
    };
    const result = deriveWaveExpectations(wave);
    expect(result.expectedFiles).toBeUndefined();
  });

  it("sets intentDescription from wave title", () => {
    const wave = { number: 1, title: "Setup Foundation", instructions: "Do stuff" };
    const result = deriveWaveExpectations(wave);
    expect(result.intentDescription).toBe("Setup Foundation");
  });

  it("handles generate and implement keywords", () => {
    const wave = {
      number: 1,
      title: "Generate",
      instructions: "Generate src/types.ts and implement src/engine.ts",
    };
    const result = deriveWaveExpectations(wave);
    expect(result.expectedFiles).toContain("src/types.ts");
    expect(result.expectedFiles).toContain("src/engine.ts");
  });

  it("filters out URLs from backtick paths", () => {
    const wave = {
      number: 1,
      title: "Docs",
      instructions: "See `https://example.com/docs.html` and create `src/real.ts`",
    };
    const result = deriveWaveExpectations(wave);
    expect(result.expectedFiles).toEqual(["src/real.ts"]);
  });
});
