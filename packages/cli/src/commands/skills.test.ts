// ============================================================================
// @dantecode/cli — Skills Command Tests
// Tests for the --bundle-dir override and --dry-run CLI options.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock skill-adapter to avoid real filesystem/DanteForge dependency
// ---------------------------------------------------------------------------

const mockImportSkillBridgeBundle = vi.fn();
const mockListBridgeWarnings = vi.fn();
const mockValidateBridgeSkill = vi.fn();

vi.mock("@dantecode/skill-adapter", () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  getSkill: vi.fn().mockResolvedValue(null),
  removeSkill: vi.fn().mockResolvedValue(false),
  validateSkill: vi.fn().mockResolvedValue(null),
  importSkills: vi.fn().mockResolvedValue({ imported: [], skipped: [], errors: [] }),
  wrapSkillWithAdapter: vi.fn().mockReturnValue("wrapped"),
  importSkillBridgeBundle: (...args: unknown[]) => mockImportSkillBridgeBundle(...args),
  listBridgeWarnings: (...args: unknown[]) => mockListBridgeWarnings(...args),
  validateBridgeSkill: (...args: unknown[]) => mockValidateBridgeSkill(...args),
}));

// Mock execFile (child_process) to avoid spawning danteforge binary
const mockExecFile = vi.fn();
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: (...args: unknown[]) => {
      // The promisified version calls execFile with a callback as last arg.
      // We simulate immediate success resolution.
      const cb = args[args.length - 1] as (err: null, res: { stdout: string; stderr: string }) => void;
      mockExecFile(...args);
      if (typeof cb === "function") {
        cb(null, { stdout: "", stderr: "" });
      }
    },
  };
});

import { runSkillsCommand } from "./skills.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GREEN_RESULT = {
  success: true,
  slug: "my-skill",
  skillDir: "/project/.dantecode/skills/my-skill",
  bucket: "green" as const,
  runtimeWarnings: [],
  conversionWarnings: [],
  conversionScore: 0.95,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("skills convert --bundle-dir", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-cmd-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockImportSkillBridgeBundle.mockReset();
    mockExecFile.mockReset();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("--bundle-dir flag: passes the specified path to importSkillBridgeBundle instead of the derived default", async () => {
    // Create a custom bundle dir so the stat() check passes
    const customBundleDir = join(tmpRoot, "custom-bundle");
    await mkdir(customBundleDir, { recursive: true });

    mockImportSkillBridgeBundle.mockResolvedValue(GREEN_RESULT);

    await runSkillsCommand(
      ["convert", "my-source-skill", "--to", "dantecode", "--bundle-dir", customBundleDir],
      projectRoot,
    );

    expect(mockImportSkillBridgeBundle).toHaveBeenCalledTimes(1);
    const callArgs = mockImportSkillBridgeBundle.mock.calls[0]![0] as { bundleDir: string };
    // The resolved bundleDir should be the custom path (not the default .danteforge/converted/... path)
    expect(callArgs.bundleDir).toBe(customBundleDir);
    expect(callArgs.bundleDir).not.toContain(".danteforge");
  });

  it("--bundle-dir with relative path: resolves relative to projectRoot", async () => {
    const customBundleDir = join(projectRoot, "custom-bundle");
    await mkdir(customBundleDir, { recursive: true });

    mockImportSkillBridgeBundle.mockResolvedValue(GREEN_RESULT);

    await runSkillsCommand(
      ["convert", "my-source-skill", "--to", "dantecode", "--bundle-dir", "custom-bundle"],
      projectRoot,
    );

    expect(mockImportSkillBridgeBundle).toHaveBeenCalledTimes(1);
    const callArgs = mockImportSkillBridgeBundle.mock.calls[0]![0] as { bundleDir: string };
    expect(callArgs.bundleDir).toBe(customBundleDir);
  });

  it("--bundle-dir with non-existent directory: calls process.exit(1) with helpful error", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string | null) => {
      throw new Error("process.exit called");
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const nonExistentDir = join(tmpRoot, "does-not-exist");

    await expect(
      runSkillsCommand(
        ["convert", "some-skill", "--to", "dantecode", "--bundle-dir", nonExistentDir],
        projectRoot,
      ),
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);

    // Error message should be helpful
    const errorOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(errorOutput).toContain("Bundle directory not found");
    expect(errorOutput).toContain("--bundle-dir");

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe("skills import-bridge --dry-run", () => {
  let tmpRoot: string;
  let projectRoot: string;
  let bundleDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-dry-test-"));
    projectRoot = join(tmpRoot, "project");
    bundleDir = join(tmpRoot, "bundle");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(bundleDir, { recursive: true });
    // Write a minimal skillbridge.json so the path resolution works
    await writeFile(
      join(bundleDir, "skillbridge.json"),
      JSON.stringify({ version: "1" }),
      "utf-8",
    );
    mockImportSkillBridgeBundle.mockReset();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("--dry-run flag: passes dryRun: true to importSkillBridgeBundle", async () => {
    mockImportSkillBridgeBundle.mockResolvedValue({
      ...GREEN_RESULT,
      dryRun: true as const,
    });

    await runSkillsCommand(["import-bridge", bundleDir, "--dry-run"], projectRoot);

    expect(mockImportSkillBridgeBundle).toHaveBeenCalledTimes(1);
    const callArgs = mockImportSkillBridgeBundle.mock.calls[0]![0] as { dryRun: boolean };
    expect(callArgs.dryRun).toBe(true);
  });

  it("--dry-run flag: output includes [DRY RUN] and 'No files were written'", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    mockImportSkillBridgeBundle.mockResolvedValue({
      ...GREEN_RESULT,
      dryRun: true as const,
    });

    await runSkillsCommand(["import-bridge", bundleDir, "--dry-run"], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("[DRY RUN]");
    expect(output).toContain("No files were written");

    stdoutSpy.mockRestore();
  });
});
