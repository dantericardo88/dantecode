import { describe, it, expect, vi } from "vitest";
import { PatchValidator } from "./patch-validator.js";

function createMockExec(responses: Record<string, string | Error> = {}) {
  return vi.fn().mockImplementation((cmd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) {
        if (response instanceof Error) throw response;
        return response;
      }
    }
    return "";
  });
}

describe("PatchValidator — getChangedFiles", () => {
  it("returns list of changed files from git diff", () => {
    const exec = createMockExec({
      "git diff --name-only": "src/app.ts\nsrc/utils.ts\n",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const files = validator.getChangedFiles();
    expect(files).toEqual(["src/app.ts", "src/utils.ts"]);
  });

  it("returns staged files when staged flag is true", () => {
    const exec = createMockExec({
      "git diff --name-only --staged": "src/staged.ts\n",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const files = validator.getChangedFiles(true);
    expect(files).toEqual(["src/staged.ts"]);
  });

  it("returns empty array when no changes", () => {
    const exec = createMockExec({
      "git diff --name-only": "",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const files = validator.getChangedFiles();
    expect(files).toEqual([]);
  });

  it("returns empty array on git error", () => {
    const exec = createMockExec({
      "git diff": new Error("not a git repo"),
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const files = validator.getChangedFiles();
    expect(files).toEqual([]);
  });

  it("filters empty lines", () => {
    const exec = createMockExec({
      "git diff --name-only": "file1.ts\n\n\nfile2.ts\n\n",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const files = validator.getChangedFiles();
    expect(files).toEqual(["file1.ts", "file2.ts"]);
  });
});

describe("PatchValidator — getDiffStats", () => {
  it("parses insertions and deletions from shortstat", () => {
    const exec = createMockExec({
      "git diff --shortstat": " 3 files changed, 42 insertions(+), 10 deletions(-)",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const stats = validator.getDiffStats();
    expect(stats.insertions).toBe(42);
    expect(stats.deletions).toBe(10);
  });

  it("handles insertions only", () => {
    const exec = createMockExec({
      "git diff --shortstat": " 1 file changed, 15 insertions(+)",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const stats = validator.getDiffStats();
    expect(stats.insertions).toBe(15);
    expect(stats.deletions).toBe(0);
  });

  it("returns zeros when no diff", () => {
    const exec = createMockExec({
      "git diff --shortstat": "",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const stats = validator.getDiffStats();
    expect(stats).toEqual({ insertions: 0, deletions: 0 });
  });
});

describe("PatchValidator — validateCurrentState", () => {
  it("validates clean working state", () => {
    const exec = createMockExec({
      "git diff --name-only": "",
      "git diff --shortstat": "",
      "diff --check": "",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const result = validator.validateCurrentState();
    expect(result.valid).toBe(true);
    expect(result.filesChanged).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("reports changed files", () => {
    const exec = createMockExec({
      "git diff --name-only": "src/app.ts\nsrc/lib.ts\n",
      "git diff --shortstat": " 2 files changed, 20 insertions(+), 5 deletions(-)",
      "diff --check": "",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const result = validator.validateCurrentState();
    expect(result.filesChanged).toHaveLength(2);
    expect(result.insertions).toBe(20);
    expect(result.deletions).toBe(5);
  });
});

describe("PatchValidator — validateGitDiff", () => {
  it("reports matching when expected files match actual", () => {
    const exec = createMockExec({
      "git diff --name-only": "src/app.ts\nsrc/utils.ts\n",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const result = validator.validateGitDiff(["src/app.ts", "src/utils.ts"]);
    expect(result.matches).toBe(true);
    expect(result.unexpected).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("identifies unexpected and missing files", () => {
    const exec = createMockExec({
      "git diff --name-only": "src/app.ts\nsrc/surprise.ts\n",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    const result = validator.validateGitDiff(["src/app.ts", "src/expected.ts"]);
    expect(result.matches).toBe(false);
    expect(result.unexpected).toContain("src/surprise.ts");
    expect(result.missing).toContain("src/expected.ts");
  });
});

describe("PatchValidator — isClean", () => {
  it("returns true when working tree is clean", () => {
    const exec = createMockExec({
      "git status --porcelain": "",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    expect(validator.isClean()).toBe(true);
  });

  it("returns false when there are changes", () => {
    const exec = createMockExec({
      "git status --porcelain": "M file.ts\n",
    });
    const validator = new PatchValidator("/project", { execSyncFn: exec });
    expect(validator.isClean()).toBe(false);
  });
});
