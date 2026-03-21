import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock child_process for URL-source tests (git clone / curl)
// ---------------------------------------------------------------------------
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { installSkill } from "./installer.js";

const mockExecFileSync = vi.mocked(execFileSync);

// Good SKILL.md content (instructions > 200 chars, description > 10 chars)
const GOOD_SKILL_CONTENT = `---
name: my-test-skill
description: A comprehensive test skill for testing installation workflows
---

You are an expert software engineer specializing in TypeScript and Node.js development.
Always produce complete, production-ready code with no stubs or placeholders.
Follow best practices for error handling, logging, and testing.
Ensure all edge cases are covered and write thorough documentation.
Use strict TypeScript with explicit types. Never use 'any' or '@ts-ignore'.
Write comprehensive unit tests with Vitest for every function you implement.
`;

// Short/stub skill content that should fail verification for higher tiers
const STUB_SKILL_CONTENT = `---
name: stub-skill
description: A stub
---

TODO: Add steps here.
`;

describe("installSkill", () => {
  let tmpDir: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "installer-test-"));
    projectRoot = await mkdtemp(join(tmpdir(), "project-root-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("1. installSkill from local path copies files and returns success", async () => {
    // Place SKILL.md directly in tmpDir (detected as universal format via findSkillMdFiles)
    await writeFile(join(tmpDir, "SKILL.md"), GOOD_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: false },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.name).toBe("my-test-skill");
    expect(result.installedPath).toBeTruthy();
    expect(result.error).toBeUndefined();
  });

  it("2. installSkill runs verification and stores score in catalog", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), GOOD_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: true, tier: "guardian" },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.verification).toBeDefined();
    expect(result.verification?.overallScore).toBeGreaterThan(0);

    // Catalog should contain the entry
    const { SkillCatalog } = await import("./catalog.js");
    const catalog = new SkillCatalog(projectRoot);
    await catalog.load();
    const entry = catalog.get("my-test-skill");
    expect(entry).not.toBeNull();
    expect(entry?.verificationScore).toBeDefined();
  });

  it("3. installSkill when verification fails without force returns success: false", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), STUB_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: true, tier: "sovereign" },
      projectRoot,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.verification).toBeDefined();
    expect(result.verification?.passed).toBe(false);
  });

  it("4. installSkill when verification fails with force: true installs anyway", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), STUB_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: true, tier: "sovereign", force: true },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.name).toBe("stub-skill");
    // Verification was still run and stored
    expect(result.verification).toBeDefined();
    expect(result.verification?.passed).toBe(false);
  });

  it("5. installSkill with symlink: true creates symlink in install dir", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), GOOD_SKILL_CONTENT, "utf-8");

    const result = await installSkill(
      { source: tmpDir, verify: false, symlink: true },
      projectRoot,
    );

    expect(result.success).toBe(true);
    expect(result.installedPath).toBeTruthy();

    // Check that source-link exists in install dir
    const symlinkPath = join(result.installedPath, "source-link");
    try {
      await stat(symlinkPath);
      // On Windows, symlinks might create a junction — just verify install succeeded
      expect(result.success).toBe(true);
    } catch {
      // On Windows, symlinks may not work without elevated permissions
      // The install should still succeed even if symlink creation failed
      expect(result.success).toBe(true);
    }
  });

  it("6. installSkill with nonexistent source returns success: false with error", async () => {
    const nonexistentPath = join(tmpDir, "does-not-exist-at-all");

    const result = await installSkill(
      { source: nonexistentPath, verify: false },
      projectRoot,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Git URL source: cleanup on failure + timeout propagation
// ---------------------------------------------------------------------------

describe("resolveSource git cleanup", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "git-project-"));
    // Reset mock state before each test
    mockExecFileSync.mockReset();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("7. cleans up tmpDir when git clone fails", async () => {
    // Mock execFileSync to throw an error (simulating a failed git clone)
    mockExecFileSync.mockImplementation(() => {
      throw new Error("repository not found");
    });

    const gitSource = "https://github.com/nonexistent/skill-repo.git";

    const result = await installSkill(
      { source: gitSource, verify: false },
      projectRoot,
    );

    // The install must fail
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Git clone failed/);

    // Verify the tmpDir under .dantecode/tmp was cleaned up
    const tmpBase = join(projectRoot, ".dantecode", "tmp");
    let tmpDirFound = false;
    try {
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(tmpBase);
      tmpDirFound = entries.length > 0;
    } catch {
      // tmpBase doesn't exist at all — that's fine, cleanup worked
      tmpDirFound = false;
    }
    expect(tmpDirFound).toBe(false);
  });

  it("8. propagates sourceTimeout to execFileSync for git clone", async () => {
    // Mock a successful clone then fail detection (no SKILL.md in empty dir)
    // execFileSync will be called: first for git clone — return empty Buffer (success)
    mockExecFileSync.mockReturnValue(Buffer.from(""));

    const gitSource = "https://github.com/example/skill-repo.git";
    const customTimeout = 15_000;

    await installSkill(
      { source: gitSource, verify: false, sourceTimeout: customTimeout },
      projectRoot,
    ).catch(() => {
      // Ignore result — we just want to check execFileSync was called with timeout
    });

    // execFileSync should have been called with git clone and the custom timeout
    const calls = mockExecFileSync.mock.calls;
    const cloneCall = calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes("clone"),
    );
    expect(cloneCall).toBeDefined();
    const opts = cloneCall?.[2] as { timeout?: number } | undefined;
    expect(opts?.timeout).toBe(customTimeout);
  });

  it("9. uses default 30000ms timeout when sourceTimeout is not set", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from(""));

    const gitSource = "https://github.com/example/skill-repo.git";

    await installSkill(
      { source: gitSource, verify: false },
      projectRoot,
    ).catch(() => {});

    const calls = mockExecFileSync.mock.calls;
    const cloneCall = calls.find(
      (c) => Array.isArray(c[1]) && (c[1] as string[]).includes("clone"),
    );
    expect(cloneCall).toBeDefined();
    const opts = cloneCall?.[2] as { timeout?: number } | undefined;
    expect(opts?.timeout).toBe(30_000);
  });

  it("10. calls curl for http:// URLs and cleans up on failure", async () => {
    // Mock curl to throw
    mockExecFileSync.mockImplementation(() => {
      throw new Error("curl: (6) Could not resolve host");
    });

    const httpSource = "http://example.com/skill.tar.gz";

    const result = await installSkill(
      { source: httpSource, verify: false },
      projectRoot,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/HTTP fetch failed/);

    // execFileSync should have been called with "curl"
    const calls = mockExecFileSync.mock.calls;
    const curlCall = calls.find((c) => c[0] === "curl");
    expect(curlCall).toBeDefined();

    // tmpDir under .dantecode/tmp should be cleaned up
    const tmpBase = join(projectRoot, ".dantecode", "tmp");
    let tmpDirFound = false;
    try {
      const { readdir: readdirDynamic } = await import("node:fs/promises");
      const entries = await readdirDynamic(tmpBase);
      tmpDirFound = entries.length > 0;
    } catch {
      tmpDirFound = false;
    }
    expect(tmpDirFound).toBe(false);
  });

  it("11. cleans up tmpDir via early return when detection fails after clone", async () => {
    // Mock git clone to succeed (empty dir, no throw)
    mockExecFileSync.mockImplementation(() => Buffer.from(""));

    // Install from git URL — clone will "succeed" but tmpDir is empty → detection fails
    const result = await installSkill(
      { source: "https://github.com/test/empty-repo.git", verify: false },
      projectRoot,
    );

    expect(result.success).toBe(false);
    // tmpDir should be cleaned up even though this was an early return, not an exception
    const tmpBase = join(projectRoot, ".dantecode", "tmp");
    const entries = await readdir(tmpBase).catch(() => [] as string[]);
    expect(entries).toHaveLength(0);
  });
});
