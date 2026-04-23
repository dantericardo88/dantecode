// ============================================================================
// Sprint BD — Dim 16: Smart Per-Step Plan Context tests
// Tests:
//  1. detectStepFilePaths finds backtick-wrapped paths that exist in project
//  2. detectStepFilePaths finds .ext patterns that exist
//  3. detectStepFilePaths ignores paths not in projectPaths
//  4. detectStepFilePaths deduplicates results
//  5. buildStepContextBudget loads priority files first
//  6. buildStepContextBudget auto-detects files from step text
//  7. buildStepContextBudget truncates when budget exceeded, records dropped files
//  8. buildStepContextBudget uses default 8000 token max
//  9. formatStepContext produces markdown with filePaths and code blocks
// 10. recordStepContextUsage creates .danteforge/plan-smart-context-log.json
// 11. getContextEfficiency returns correct avgFilesPerStep and truncationRate
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  detectStepFilePaths,
  buildStepContextBudget,
  formatStepContext,
  recordStepContextUsage,
  loadStepContextLog,
  getContextEfficiency,
} from "@dantecode/core";
import type { PlanStepContextLog } from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-bd-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Test 1: detectStepFilePaths — backtick-wrapped paths ────────────────────
describe("detectStepFilePaths — backtick paths", () => {
  it("finds backtick-wrapped paths that exist in projectPaths", () => {
    const projectPaths = new Set(["src/auth.ts", "src/api.ts", "src/utils.ts"]);
    const stepText = "Update the `src/auth.ts` file to use the new token format from `src/api.ts`.";
    const result = detectStepFilePaths(stepText, projectPaths);
    expect(result).toContain("src/auth.ts");
    expect(result).toContain("src/api.ts");
  });

  it("does not include backtick tokens not in projectPaths", () => {
    const projectPaths = new Set(["src/auth.ts"]);
    const stepText = "Edit `src/auth.ts` and also look at `nonexistent/file.ts`.";
    const result = detectStepFilePaths(stepText, projectPaths);
    expect(result).toContain("src/auth.ts");
    expect(result).not.toContain("nonexistent/file.ts");
  });
});

// ─── Test 2: detectStepFilePaths — .ext patterns ─────────────────────────────
describe("detectStepFilePaths — .ext patterns", () => {
  it("finds word.ext patterns that exist in project", () => {
    const projectPaths = new Set(["auth.ts", "models/user.py", "config.json"]);
    const stepText = "Modify auth.ts to update the user model in models/user.py.";
    const result = detectStepFilePaths(stepText, projectPaths);
    expect(result).toContain("auth.ts");
    expect(result).toContain("models/user.py");
  });
});

// ─── Test 3: detectStepFilePaths — ignores paths not in projectPaths ──────────
describe("detectStepFilePaths — filtering", () => {
  it("ignores all paths not in projectPaths", () => {
    const projectPaths = new Set(["src/real.ts"]);
    const stepText = "Update `src/fake.ts` and also `src/another-fake.ts`.";
    const result = detectStepFilePaths(stepText, projectPaths);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when projectPaths is empty", () => {
    const projectPaths = new Set<string>();
    const stepText = "Update `src/auth.ts` to fix the bug.";
    const result = detectStepFilePaths(stepText, projectPaths);
    expect(result).toHaveLength(0);
  });
});

// ─── Test 4: detectStepFilePaths — deduplication ─────────────────────────────
describe("detectStepFilePaths — deduplication", () => {
  it("deduplicates results when path mentioned multiple times", () => {
    const projectPaths = new Set(["src/auth.ts"]);
    const stepText = "Edit `src/auth.ts` first, then re-check src/auth.ts for any missed changes.";
    const result = detectStepFilePaths(stepText, projectPaths);
    const authOccurrences = result.filter((p) => p === "src/auth.ts");
    expect(authOccurrences).toHaveLength(1);
  });

  it("returns sorted results", () => {
    const projectPaths = new Set(["z-file.ts", "a-file.ts", "m-file.ts"]);
    const stepText = "Update `z-file.ts`, `a-file.ts`, and `m-file.ts`.";
    const result = detectStepFilePaths(stepText, projectPaths);
    expect(result).toEqual([...result].sort());
  });
});

// ─── Test 5: buildStepContextBudget — priority files loaded first ─────────────
describe("buildStepContextBudget — priority files", () => {
  it("loads priorityFiles first before auto-detection", () => {
    const priorityFiles = ["src/priority.ts"];
    const projectFileMap = new Map([
      ["src/priority.ts", "const x = 1;"],
      ["src/auto.ts", "const y = 2;"],
    ]);
    const stepText = "Update `src/auto.ts` alongside the priority file.";

    const budget = buildStepContextBudget(stepText, priorityFiles, projectFileMap, 8000);
    // Priority file should be first entry
    expect(budget.entries[0]?.filePath).toBe("src/priority.ts");
    expect(budget.entries[0]?.autoDetected).toBe(false);
  });

  it("marks auto-detected files with autoDetected=true", () => {
    const priorityFiles: string[] = [];
    const projectFileMap = new Map([["src/detected.ts", "export const x = 1;"]]);
    const stepText = "Edit `src/detected.ts` to add a new export.";

    const budget = buildStepContextBudget(stepText, priorityFiles, projectFileMap, 8000);
    const detected = budget.entries.find((e) => e.filePath === "src/detected.ts");
    expect(detected).toBeDefined();
    expect(detected!.autoDetected).toBe(true);
  });
});

// ─── Test 6: buildStepContextBudget — auto-detects files from step text ───────
describe("buildStepContextBudget — auto-detection", () => {
  it("auto-detects files mentioned in backticks", () => {
    const projectFileMap = new Map([
      ["src/service.ts", "// service code"],
      ["src/types.ts", "// types"],
    ]);
    const stepText = "Refactor `src/service.ts` to use the types from `src/types.ts`.";

    const budget = buildStepContextBudget(stepText, [], projectFileMap, 8000);
    const filePaths = budget.entries.map((e) => e.filePath);
    expect(filePaths).toContain("src/service.ts");
    expect(filePaths).toContain("src/types.ts");
  });
});

// ─── Test 7: buildStepContextBudget — truncation ─────────────────────────────
describe("buildStepContextBudget — truncation", () => {
  it("truncates when budget exceeded and records dropped files", () => {
    // Create content that fills most of the budget
    const largeContent = "x".repeat(3800 * 4); // ~3800 tokens each
    const projectFileMap = new Map([
      ["src/a.ts", largeContent],
      ["src/b.ts", largeContent],
      ["src/c.ts", largeContent],
    ]);
    const stepText = "Update `src/a.ts`, `src/b.ts`, and `src/c.ts`.";

    // Budget of 8000 tokens should only fit ~2 files (each ~3800 tokens)
    const budget = buildStepContextBudget(stepText, [], projectFileMap, 8000);
    expect(budget.truncated).toBe(true);
    expect(budget.droppedFiles.length).toBeGreaterThan(0);
    expect(budget.totalTokens).toBeLessThanOrEqual(budget.maxTokens);
  });

  it("does not truncate when all files fit", () => {
    const projectFileMap = new Map([
      ["src/small.ts", "const x = 1;"], // tiny content
    ]);
    const stepText = "Edit `src/small.ts`.";

    const budget = buildStepContextBudget(stepText, [], projectFileMap, 8000);
    expect(budget.truncated).toBe(false);
    expect(budget.droppedFiles).toHaveLength(0);
  });
});

// ─── Test 8: buildStepContextBudget — default 8000 token max ─────────────────
describe("buildStepContextBudget — default maxTokens", () => {
  it("uses 8000 as default maxTokens when not specified", () => {
    const projectFileMap = new Map([["src/foo.ts", "const a = 1;"]]);
    const stepText = "Edit `src/foo.ts`.";

    const budget = buildStepContextBudget(stepText, [], projectFileMap);
    expect(budget.maxTokens).toBe(8000);
  });
});

// ─── Test 9: formatStepContext — markdown output ──────────────────────────────
describe("formatStepContext", () => {
  it("produces markdown with filePaths and code blocks", () => {
    const budget = buildStepContextBudget(
      "Edit `src/foo.ts`.",
      [],
      new Map([["src/foo.ts", "export const answer = 42;"]]),
      8000,
    );
    const output = formatStepContext(budget);
    expect(output).toContain("### Step Context");
    expect(output).toContain("src/foo.ts");
    expect(output).toContain("```");
    expect(output).toContain("export const answer = 42;");
  });

  it("includes truncation note when files were dropped", () => {
    const largeContent = "y".repeat(4100 * 4);
    const budget = buildStepContextBudget(
      "Edit `src/a.ts` and `src/b.ts`.",
      [],
      new Map([
        ["src/a.ts", largeContent],
        ["src/b.ts", largeContent],
      ]),
      8000,
    );
    const output = formatStepContext(budget);
    if (budget.truncated) {
      expect(output).toContain("omitted due to context budget");
    }
  });

  it("handles empty budget gracefully", () => {
    const budget = buildStepContextBudget("No files mentioned here.", [], new Map(), 8000);
    const output = formatStepContext(budget);
    expect(output).toContain("### Step Context");
  });
});

// ─── Test 10: recordStepContextUsage creates log file ────────────────────────
describe("recordStepContextUsage", () => {
  it("creates .danteforge/plan-smart-context-log.json", () => {
    const dir = makeDir();
    const entry: Omit<PlanStepContextLog, "timestamp"> = {
      planId: "plan-001",
      stepId: "step-001",
      stepDescription: "Implement auth module",
      filesLoaded: ["src/auth.ts"],
      fileCount: 1,
      totalTokens: 250,
      truncated: false,
    };

    recordStepContextUsage(entry, dir);

    const logPath = join(dir, ".danteforge", "plan-smart-context-log.json");
    expect(existsSync(logPath)).toBe(true);

    const raw = readFileSync(logPath, "utf-8").trim();
    const parsed = JSON.parse(raw) as PlanStepContextLog;
    expect(parsed.planId).toBe("plan-001");
    expect(parsed.stepId).toBe("step-001");
    expect(parsed.fileCount).toBe(1);
    expect(parsed.timestamp).toBeTruthy();
  });

  it("loadStepContextLog reads multiple entries", () => {
    const dir = makeDir();
    const base: Omit<PlanStepContextLog, "timestamp"> = {
      planId: "p1",
      stepId: "s1",
      stepDescription: "Step one",
      filesLoaded: [],
      fileCount: 0,
      totalTokens: 100,
      truncated: false,
    };

    recordStepContextUsage({ ...base, stepId: "s1" }, dir);
    recordStepContextUsage({ ...base, stepId: "s2", totalTokens: 200 }, dir);

    const loaded = loadStepContextLog(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.stepId).toBe("s1");
    expect(loaded[1]?.stepId).toBe("s2");
    expect(loaded[1]?.totalTokens).toBe(200);
  });
});

// ─── Test 11: getContextEfficiency ───────────────────────────────────────────
describe("getContextEfficiency", () => {
  it("returns correct avgFilesPerStep", () => {
    const entries: PlanStepContextLog[] = [
      { planId: "p1", stepId: "s1", stepDescription: "", filesLoaded: ["a.ts", "b.ts"], fileCount: 2, totalTokens: 400, truncated: false, timestamp: new Date().toISOString() },
      { planId: "p1", stepId: "s2", stepDescription: "", filesLoaded: ["c.ts"], fileCount: 1, totalTokens: 200, truncated: true, timestamp: new Date().toISOString() },
    ];
    const result = getContextEfficiency(entries);
    expect(result.avgFilesPerStep).toBeCloseTo(1.5);
    expect(result.avgTokensPerStep).toBeCloseTo(300);
  });

  it("returns correct truncationRate", () => {
    const entries: PlanStepContextLog[] = [
      { planId: "p1", stepId: "s1", stepDescription: "", filesLoaded: [], fileCount: 0, totalTokens: 0, truncated: true, timestamp: new Date().toISOString() },
      { planId: "p1", stepId: "s2", stepDescription: "", filesLoaded: [], fileCount: 0, totalTokens: 0, truncated: false, timestamp: new Date().toISOString() },
      { planId: "p1", stepId: "s3", stepDescription: "", filesLoaded: [], fileCount: 0, totalTokens: 0, truncated: true, timestamp: new Date().toISOString() },
    ];
    const result = getContextEfficiency(entries);
    expect(result.truncationRate).toBeCloseTo(2 / 3);
  });

  it("returns zeroes for empty entries", () => {
    const result = getContextEfficiency([]);
    expect(result.avgFilesPerStep).toBe(0);
    expect(result.avgTokensPerStep).toBe(0);
    expect(result.truncationRate).toBe(0);
  });
});
