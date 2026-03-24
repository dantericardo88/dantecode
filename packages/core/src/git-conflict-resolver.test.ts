import { describe, it, expect } from "vitest";
import { GitConflictResolver } from "./git-conflict-resolver.js";

const resolver = new GitConflictResolver();

describe("GitConflictResolver", () => {
  it("detects conflict regions from standard git markers", () => {
    const content = [
      "line1",
      "<<<<<<< HEAD",
      "our change",
      "=======",
      "their change",
      ">>>>>>> feature-branch",
      "line after",
    ].join("\n");

    const conflicts = resolver.detectConflicts(content);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.startLine).toBe(2);
    expect(conflicts[0]!.endLine).toBe(6);
    expect(conflicts[0]!.ours).toBe("our change");
    expect(conflicts[0]!.theirs).toBe("their change");
  });

  it("detects multiple conflicts in the same file", () => {
    const content = [
      "<<<<<<< HEAD",
      "a",
      "=======",
      "b",
      ">>>>>>> branch",
      "middle",
      "<<<<<<< HEAD",
      "c",
      "=======",
      "d",
      ">>>>>>> branch",
    ].join("\n");

    const conflicts = resolver.detectConflicts(content);
    expect(conflicts.length).toBe(2);
    expect(conflicts[0]!.ours).toBe("a");
    expect(conflicts[1]!.theirs).toBe("d");
  });

  it("classifies whitespace-only differences as textual", () => {
    const conflict = {
      startLine: 1,
      endLine: 5,
      ours: "const x = 1;",
      theirs: "  const   x  =  1;  ",
    };
    expect(resolver.classifyConflict(conflict)).toBe("textual");
  });

  it("classifies divergent logic changes as semantic", () => {
    const conflict = {
      startLine: 1,
      endLine: 5,
      ours: "return calculateSum(a, b);",
      theirs: "throw new Error('not supported');",
    };
    expect(resolver.classifyConflict(conflict)).toBe("semantic");
  });

  it("auto-resolves textual conflicts and returns null for semantic", () => {
    const textual = {
      startLine: 1,
      endLine: 5,
      ours: "const x = 1;",
      theirs: "  const x = 1;  ",
    };
    const resolution = resolver.autoResolve(textual);
    expect(resolution).not.toBeNull();
    expect(resolution!.strategy).toBe("ours");
    expect(resolution!.confidence).toBeGreaterThan(0.5);

    const semantic = {
      startLine: 1,
      endLine: 5,
      ours: "return calculateSum(a, b);",
      theirs: "throw new Error('not supported');",
    };
    expect(resolver.autoResolve(semantic)).toBeNull();
  });

  it("auto-resolves deletion conflicts by picking non-empty side", () => {
    const conflict = {
      startLine: 1,
      endLine: 5,
      ours: "",
      theirs: "const newFeature = true;",
    };
    const resolution = resolver.autoResolve(conflict);
    expect(resolution).not.toBeNull();
    expect(resolution!.strategy).toBe("theirs");
    expect(resolution!.resolved).toBe("const newFeature = true;");
  });

  it("generates a comprehensive report", () => {
    const content = [
      "<<<<<<< HEAD",
      "same text here",
      "=======",
      "  same  text  here  ",
      ">>>>>>> branch",
      "",
      "<<<<<<< HEAD",
      "return foo(x);",
      "=======",
      "return bar(y, z);",
      ">>>>>>> branch",
    ].join("\n");

    const conflicts = resolver.detectConflicts(content);
    const report = resolver.generateReport(conflicts);

    expect(report.totalConflicts).toBe(2);
    expect(report.textualCount).toBe(1);
    expect(report.semanticCount).toBe(1);
    expect(report.autoResolvableCount).toBe(1);
    expect(report.conflicts.length).toBe(2);
  });

  it("handles diff3 ancestor format", () => {
    const content = [
      "<<<<<<< HEAD",
      "our version",
      "||||||| base",
      "original version",
      "=======",
      "their version",
      ">>>>>>> branch",
    ].join("\n");

    const conflicts = resolver.detectConflicts(content);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0]!.ours).toBe("our version");
    expect(conflicts[0]!.theirs).toBe("their version");
    expect(conflicts[0]!.ancestor).toBe("original version");
  });
});
