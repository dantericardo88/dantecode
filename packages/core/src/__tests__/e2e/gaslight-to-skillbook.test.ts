// ============================================================================
// E2E: Gaslight to Skillbook — Real module instances
// Uses actual AttackPatternLibrary, GaslightReport, and SkillVersionManager
// classes from their respective packages to test the full pipeline:
// patterns -> defense simulation -> report -> lesson extraction -> versioning.
// ============================================================================

import { describe, it, expect } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — cross-package test import (not a runtime dep to avoid circular deps)
import { AttackPatternLibrary, GaslightReport } from "@dantecode/dante-gaslight";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — cross-package test import
import { SkillVersionManager } from "@dantecode/dante-skillbook";

describe("E2E: Gaslight to Skillbook (real modules)", () => {
  it("AttackPatternLibrary returns real patterns and calculates coverage", () => {
    const library = new AttackPatternLibrary();

    // Library should have all 15 built-in patterns
    const allPatterns = library.getPatterns();
    expect(allPatterns.length).toBe(15);

    // All 5 categories should be present
    const categories = library.getCategories();
    expect(categories).toHaveLength(5);
    expect(categories).toContain("prompt-injection");
    expect(categories).toContain("hallucination");
    expect(categories).toContain("reasoning-trap");
    expect(categories).toContain("consistency");
    expect(categories).toContain("edge-case");

    // Each category should have 3 patterns
    for (const cat of categories) {
      const catPatterns = library.getPatterns(cat);
      expect(catPatterns).toHaveLength(3);
      // All patterns in this category should have required fields
      for (const p of catPatterns) {
        expect(p.name).toBeTruthy();
        expect(p.category).toBe(cat);
        expect(["low", "medium", "high", "critical"]).toContain(p.severity);
        expect(typeof p.prompt).toBe("string");
        expect(p.expectedFailureMode).toBeTruthy();
      }
    }

    // Coverage: testing all categories = 100%
    expect(library.calculateCoverage(categories)).toBe(100);

    // Coverage: testing only 3 of 5 categories = 60%
    expect(library.calculateCoverage(["prompt-injection", "hallucination", "edge-case"])).toBe(60);

    // Coverage: testing no categories = 0%
    expect(library.calculateCoverage([])).toBe(0);

    // Lookup by name
    const systemOverride = library.getPattern("system-override");
    expect(systemOverride).toBeDefined();
    expect(systemOverride!.category).toBe("prompt-injection");
    expect(systemOverride!.severity).toBe("critical");
  });

  it("GaslightReport with real attack results and resilience scoring", () => {
    const library = new AttackPatternLibrary();
    const report = new GaslightReport();

    // Simulate defense results: defend all prompt-injection and edge-cases,
    // fail on hallucination patterns
    const defenseMap: Record<string, boolean> = {
      "system-override": true,
      "role-switch": true,
      "instruction-ignore": true,
      "confident-fabrication": false,
      "citation-invention": false,
      "nonexistent-api": true,
      "circular-logic": true,
      "false-premise": false,
      "contradictory-requirements": true,
      "context-switch": true,
      "memory-gap": true,
      "scope-creep": true,
      "empty-input": true,
      "unicode-injection": true,
      "max-length-input": true,
    };

    const allPatterns = library.getPatterns();
    for (const pattern of allPatterns) {
      const defended = defenseMap[pattern.name] ?? true;
      report.addResult(
        pattern,
        defended,
        defended ? "Successfully defended" : `Failed: ${pattern.expectedFailureMode}`,
      );
    }

    // Resilience: 12 defended out of 15 = 80%
    expect(report.calculateResilience()).toBe(80);

    // Generate full report
    const fullReport = report.generateReport();
    expect(fullReport.totalAttacks).toBe(15);
    expect(fullReport.defended).toBe(12);
    expect(fullReport.failures).toHaveLength(3);
    expect(fullReport.resilienceScore).toBe(80);

    // Lessons should be extracted from failures
    expect(fullReport.lessonsExtracted).toHaveLength(3);
    // Each lesson should reference the category and pattern name
    for (const lesson of fullReport.lessonsExtracted) {
      expect(lesson).toMatch(/\[.*\/.*\]/);
    }

    // Category coverage should show hallucination as weak
    expect(fullReport.categoryCoverage["hallucination"]!.tested).toBe(3);
    expect(fullReport.categoryCoverage["hallucination"]!.defended).toBe(1);

    // Prompt injection fully defended
    expect(fullReport.categoryCoverage["prompt-injection"]!.tested).toBe(3);
    expect(fullReport.categoryCoverage["prompt-injection"]!.defended).toBe(3);
  });

  it("full pipeline: patterns -> defense -> report -> lessons", () => {
    const library = new AttackPatternLibrary();
    const report = new GaslightReport();

    // Step 1: Get all patterns
    const patterns = library.getPatterns();
    expect(patterns.length).toBeGreaterThan(0);

    // Step 2: Simulate defense (defend everything except edge-case "empty-input")
    for (const pattern of patterns) {
      const defended = pattern.name !== "empty-input";
      report.addResult(pattern, defended, defended ? "Blocked" : "Crashed on empty input");
    }

    // Step 3: Generate report
    const fullReport = report.generateReport();
    expect(fullReport.resilienceScore).toBe(
      Math.round(((patterns.length - 1) / patterns.length) * 100),
    );

    // Step 4: Extract lessons from failures
    expect(fullReport.lessonsExtracted).toHaveLength(1);
    expect(fullReport.lessonsExtracted[0]).toContain("empty-input");

    // Step 5: Trend tracking
    // Simulate improving resilience over time
    const trend = report.trackTrend([60, 65, 70, 75, 80, 85, 90]);
    expect(trend).toBe("improving");

    // Stable trend
    expect(report.trackTrend([80, 81, 79, 80, 81])).toBe("stable");

    // Degrading trend
    expect(report.trackTrend([90, 85, 80, 75, 70])).toBe("degrading");
  });

  it("SkillVersionManager bumps version after lesson extraction", () => {
    const manager = new SkillVersionManager();

    // Step 1: Initialize skill with version 1.0.0
    manager.addVersion("defense-skill", "1.0.0", {
      patterns: ["prompt-injection"],
      resilience: 60,
    });

    const initialVersion = manager.getLatestVersion("defense-skill");
    expect(initialVersion).toBe("1.0.0");

    // Step 2: After lesson extraction, bump minor version (new capability)
    const newVersion = manager.bumpVersion("1.0.0", "minor");
    expect(newVersion).toBe("1.1.0");

    manager.addVersion("defense-skill", newVersion, {
      patterns: ["prompt-injection", "hallucination"],
      resilience: 80,
    });

    // Step 3: Verify history
    const history = manager.getHistory("defense-skill");
    expect(history).toHaveLength(2);
    expect(history[0]!.version).toBe("1.0.0");
    expect(history[1]!.version).toBe("1.1.0");

    // Step 4: Add a patch version (bug fix to defense)
    const patchVersion = manager.bumpVersion("1.1.0", "patch");
    expect(patchVersion).toBe("1.1.1");

    manager.addVersion("defense-skill", patchVersion, {
      patterns: ["prompt-injection", "hallucination"],
      resilience: 85,
    });

    expect(manager.getLatestVersion("defense-skill")).toBe("1.1.1");
    expect(manager.getHistory("defense-skill")).toHaveLength(3);

    // Step 5: Breaking change detection
    const oldExports = ["defend", "analyze", "report"];
    const newExports = ["defend", "analyze"]; // removed "report"
    expect(manager.detectBreakingChange(oldExports, newExports)).toBe(true);

    // Non-breaking: only additions
    const addedExports = ["defend", "analyze", "report", "summarize"];
    expect(manager.detectBreakingChange(oldExports, addedExports)).toBe(false);

    // Step 6: Rollback
    const rolledBack = manager.rollback("defense-skill");
    expect(rolledBack).not.toBeNull();
    expect(rolledBack!.version).toBe("1.1.0");
    expect(manager.getLatestVersion("defense-skill")).toBe("1.1.0");

    // After rollback, history should have 2 entries
    expect(manager.getHistory("defense-skill")).toHaveLength(2);
  });
});
