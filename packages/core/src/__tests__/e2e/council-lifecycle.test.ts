import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MergeConfidenceScorer, type MergeCandidatePatch } from "../../council/merge-confidence.js";
import { OverlapDetector, classifyOverlapLevel } from "../../council/overlap-detector.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function gitInit(dir: string): string {
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  // Return the default branch name (master or main depending on git config)
  return execSync("git branch --show-current", { cwd: dir, encoding: "utf-8" }).trim();
}

/** Returns the default branch name after the first commit. */
function gitDefaultBranch(dir: string): string {
  return execSync("git branch --show-current", { cwd: dir, encoding: "utf-8" }).trim();
}

function gitCommit(dir: string, msg: string): void {
  execSync(`git add -A`, { cwd: dir, stdio: "pipe" });
  execSync(`git commit --allow-empty -m "${msg}"`, {
    cwd: dir,
    stdio: "pipe",
  });
}

function gitDiff(dir: string, base: string): string {
  try {
    return execSync(`git diff ${base}`, { cwd: dir, encoding: "utf-8" });
  } catch {
    return "";
  }
}

function gitBranch(dir: string, name: string): void {
  execSync(`git checkout -b ${name}`, { cwd: dir, stdio: "pipe" });
}

function gitCheckout(dir: string, name: string): void {
  execSync(`git checkout ${name}`, { cwd: dir, stdio: "pipe" });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Council lifecycle — real git e2e", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "council-e2e-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tmpDirs.length = 0;
  });

  it("scores high confidence for non-overlapping patches from real branches", () => {
    const repoDir = makeTmpDir();
    gitInit(repoDir);

    // Create initial state on the default branch
    writeFileSync(join(repoDir, "fileA.ts"), "export const a = 1;\n");
    writeFileSync(join(repoDir, "fileB.ts"), "export const b = 2;\n");
    gitCommit(repoDir, "initial");
    const baseBranch = gitDefaultBranch(repoDir);

    // Branch A: modify fileA only
    gitBranch(repoDir, "lane-a");
    writeFileSync(join(repoDir, "fileA.ts"), "export const a = 42;\nexport const aa = 100;\n");
    gitCommit(repoDir, "lane-a changes");
    const diffA = gitDiff(repoDir, baseBranch);

    // Branch B: modify fileB only
    gitCheckout(repoDir, baseBranch);
    gitBranch(repoDir, "lane-b");
    writeFileSync(join(repoDir, "fileB.ts"), "export const b = 99;\nexport const bb = 200;\n");
    gitCommit(repoDir, "lane-b changes");
    const diffB = gitDiff(repoDir, baseBranch);

    const candidates: MergeCandidatePatch[] = [
      {
        laneId: "lane-a",
        unifiedDiff: diffA,
        changedFiles: ["fileA.ts"],
        passedTests: ["test1", "test2"],
        failedTests: [],
      },
      {
        laneId: "lane-b",
        unifiedDiff: diffB,
        changedFiles: ["fileB.ts"],
        passedTests: ["test3"],
        failedTests: [],
      },
    ];

    const scorer = new MergeConfidenceScorer();
    const result = scorer.score(candidates);

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.bucket).toBe("high");
    expect(result.decision).toBe("auto-merge");
    expect(result.factors.structuralSafety).toBe(1.0);
    expect(result.factors.intentCompatibility).toBe(1.0);
  });

  it("scores lower confidence for overlapping patches from real branches", () => {
    const repoDir = makeTmpDir();
    gitInit(repoDir);

    // Create shared file
    writeFileSync(join(repoDir, "shared.ts"), "export function greet() { return 'hello'; }\n");
    gitCommit(repoDir, "initial");
    const baseBranch = gitDefaultBranch(repoDir);

    // Branch A: modify shared.ts
    gitBranch(repoDir, "lane-a");
    writeFileSync(join(repoDir, "shared.ts"), "export function greet() { return 'hi'; }\n");
    gitCommit(repoDir, "lane-a modifies shared");
    const diffA = gitDiff(repoDir, baseBranch);

    // Branch B: also modify shared.ts
    gitCheckout(repoDir, baseBranch);
    gitBranch(repoDir, "lane-b");
    writeFileSync(join(repoDir, "shared.ts"), "export function greet() { return 'hey'; }\n");
    gitCommit(repoDir, "lane-b modifies shared");
    const diffB = gitDiff(repoDir, baseBranch);

    const candidates: MergeCandidatePatch[] = [
      {
        laneId: "lane-a",
        unifiedDiff: diffA,
        changedFiles: ["shared.ts"],
        passedTests: [],
        failedTests: ["test-fail"],
      },
      {
        laneId: "lane-b",
        unifiedDiff: diffB,
        changedFiles: ["shared.ts"],
        passedTests: [],
        failedTests: ["test-fail-2"],
      },
    ];

    const scorer = new MergeConfidenceScorer();
    const result = scorer.score(candidates);

    // Overlapping file + both have failing tests = lower confidence
    expect(result.factors.intentCompatibility).toBeLessThan(1.0);
    expect(result.factors.testCoverage).toBe(0);
    expect(result.score).toBeLessThan(75);
  });

  it("classifies overlap levels correctly from real file sets", () => {
    // L0: completely disjoint files in different directories
    expect(classifyOverlapLevel(["src/a.ts"], ["lib/b.ts"])).toBe(0);

    // L2: same directory, different files
    expect(classifyOverlapLevel(["src/a.ts"], ["src/b.ts"])).toBe(2);

    // L3: same files in both sets
    expect(classifyOverlapLevel(["src/a.ts", "src/b.ts"], ["src/a.ts"])).toBe(3);
  });

  it("OverlapDetector freezes lanes on L3+ overlap", () => {
    const detector = new OverlapDetector();
    const now = new Date().toISOString();
    const result = detector.detect(
      [
        {
          laneId: "lane-a",
          agentKind: "dantecode" as const,
          worktreePath: "/tmp/a",
          branch: "lane-a-branch",
          headCommit: "abc1234",
          modifiedFiles: ["src/shared.ts", "src/a.ts"],
          capturedAt: now,
        },
        {
          laneId: "lane-b",
          agentKind: "dantecode" as const,
          worktreePath: "/tmp/b",
          branch: "lane-b-branch",
          headCommit: "def5678",
          modifiedFiles: ["src/shared.ts", "src/b.ts"],
          capturedAt: now,
        },
      ],
      [],
    );

    expect(result.overlaps.length).toBeGreaterThanOrEqual(1);
    expect(result.overlaps[0]!.level).toBe(3);
    expect(result.lanesToFreeze).toContain("lane-a");
    expect(result.lanesToFreeze).toContain("lane-b");
  });

  it("produces real merge conflict markers when branches conflict", () => {
    const repoDir = makeTmpDir();
    gitInit(repoDir);

    // Create initial state
    writeFileSync(join(repoDir, "conflict.ts"), "line1\nline2\nline3\n");
    gitCommit(repoDir, "initial");
    const baseBranch = gitDefaultBranch(repoDir);

    // Branch A
    gitBranch(repoDir, "branch-a");
    writeFileSync(join(repoDir, "conflict.ts"), "line1\nchanged-by-A\nline3\n");
    gitCommit(repoDir, "branch-a changes");

    // Branch B (from base branch)
    gitCheckout(repoDir, baseBranch);
    gitBranch(repoDir, "branch-b");
    writeFileSync(join(repoDir, "conflict.ts"), "line1\nchanged-by-B\nline3\n");
    gitCommit(repoDir, "branch-b changes");

    // Try to merge — should produce conflict
    try {
      execSync("git merge branch-a --no-commit", {
        cwd: repoDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Expected: merge fails with conflict
    }

    // Read the conflicted file — it should have conflict markers
    const content = readFileSync(join(repoDir, "conflict.ts"), "utf-8");

    expect(content).toContain("<<<<<<<");
    expect(content).toContain("=======");
    expect(content).toContain(">>>>>>>");
  });

  it("single-candidate scoring produces high confidence with all tests passing", () => {
    const repoDir = makeTmpDir();
    gitInit(repoDir);

    writeFileSync(join(repoDir, "feature.ts"), "export const x = 1;\n");
    gitCommit(repoDir, "initial");
    const baseBranch = gitDefaultBranch(repoDir);

    gitBranch(repoDir, "feature");
    writeFileSync(join(repoDir, "feature.ts"), "export const x = 2;\nexport const y = 3;\n");
    writeFileSync(join(repoDir, "feature.test.ts"), "test('x', () => {});\n");
    gitCommit(repoDir, "add feature");
    const diff = gitDiff(repoDir, baseBranch);

    const scorer = new MergeConfidenceScorer();
    const result = scorer.score([
      {
        laneId: "feature",
        unifiedDiff: diff,
        changedFiles: ["feature.ts", "feature.test.ts"],
        passedTests: ["test-a", "test-b", "test-c"],
        failedTests: [],
      },
    ]);

    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.bucket).toBe("high");
    expect(result.factors.structuralSafety).toBe(1.0);
    expect(result.factors.testCoverage).toBe(1.0);
  });
});
