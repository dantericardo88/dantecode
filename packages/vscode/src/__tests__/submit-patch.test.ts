// Tests for toolSubmitPatch — the SWE-agent ACI primitive that signals
// "this is my final patch." Asserts the contract via the public
// executeTool dispatcher (which is what the agent-loop calls).
//
// We don't unit-test toolSubmitPatch directly because it's not exported.
// Instead, set up a temp git repo, drive the public API, and inspect the
// returned ToolResult.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool } from "../agent-tools.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "submit-patch-"));
  // Initialize a git repo with one committed file so HEAD exists and
  // `git diff HEAD` is meaningful.
  execSync("git init -q", { cwd: repo });
  execSync('git config user.email "test@example.com"', { cwd: repo });
  execSync('git config user.name "Test"', { cwd: repo });
  writeFileSync(join(repo, "seed.txt"), "initial\n");
  execSync("git add . && git commit -q -m initial", { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("SubmitPatch tool", () => {
  it("rejects empty working tree with no_changes error", async () => {
    const result = await executeTool(
      "SubmitPatch",
      { validate_syntax: false },
      repo,
    );
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/no changes detected/i);
  });

  it("returns the diff when files were modified", async () => {
    writeFileSync(join(repo, "seed.txt"), "modified\n");
    const result = await executeTool(
      "SubmitPatch",
      { validate_syntax: false },
      repo,
    );
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/SubmitPatch:.*1 file/);
    expect(result.content).toContain("seed.txt");
    expect(result.content).toMatch(/-initial/);
    expect(result.content).toMatch(/\+modified/);
  });

  it("includes file count and line count in the summary line", async () => {
    writeFileSync(join(repo, "seed.txt"), "a\nb\nc\n");
    mkdirSync(join(repo, "sub"), { recursive: true });
    writeFileSync(join(repo, "sub/new.txt"), "new file\n");
    execSync("git add sub/new.txt", { cwd: repo });
    const result = await executeTool(
      "SubmitPatch",
      { validate_syntax: false },
      repo,
    );
    expect(result.isError).toBe(false);
    expect(result.content).toMatch(/SubmitPatch: 2 file\(s\) modified/);
  });

  it("validate_syntax: skipping syntax check still returns success", async () => {
    // Even with broken Python syntax, validate_syntax=false should pass.
    writeFileSync(join(repo, "broken.py"), "def f(:\n  return 1\n");
    execSync("git add broken.py", { cwd: repo });
    const result = await executeTool(
      "SubmitPatch",
      { validate_syntax: false },
      repo,
    );
    expect(result.isError).toBe(false);
    expect(result.content).toContain("broken.py");
  });

  it("is recognized by the executeTool dispatcher", async () => {
    // Negative case: a phantom name should NOT execute SubmitPatch.
    const fake = await executeTool(
      "submit_patch_typo" as unknown as "SubmitPatch",
      {},
      repo,
    );
    expect(fake.isError).toBe(true);
  });
});
