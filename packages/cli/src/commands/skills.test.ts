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

// Proxy vi.fn() instances declared before the mock factory so tests can reset
// and configure them without needing a typed module import (skill-adapter has
// no compiled .d.ts in this workspace state).
const mockImportSkillBridgeBundle = vi.fn();
const mockListBridgeWarnings = vi.fn();
const mockValidateBridgeSkill = vi.fn();
const mockGetSkill = vi.fn().mockResolvedValue(null);
const mockGetSkillWithBridgeMeta = vi.fn().mockResolvedValue(null);
const mockInstallSkill = vi.fn().mockResolvedValue({
  success: true,
  name: "my-skill",
  installedPath: "/p/.dantecode/skills/my-skill",
  source: ".",
  format: "claude",
});
const mockBundleSkill = vi.fn().mockResolvedValue({
  success: true,
  skillName: "my-skill",
  outputPath: "/out/my-skill",
  filesWritten: [] as string[],
});
const mockDetectSkillSources = vi.fn().mockResolvedValue([]);
const mockParseUniversalSkill = vi.fn().mockResolvedValue({
  name: "my-skill",
  description: "A test skill",
  instructions: "Do the thing",
  source: "claude",
  sourcePath: "/some/path/SKILL.md",
});

// SkillChain mock: supports both `new SkillChain(...)` and `SkillChain.fromYAML(...)`.
const mockSkillChainFromYAML = vi.fn().mockReturnValue({
  name: "mock-chain",
  getSteps: vi.fn().mockReturnValue([{ skillName: "step-one", params: {} }]),
});

function makeMockChainInstance(name: string, description: string) {
  return {
    name,
    description,
    add: vi.fn().mockReturnThis(),
    addGate: vi.fn().mockReturnThis(),
    getSteps: vi.fn().mockReturnValue([]),
    toYAML: vi.fn().mockReturnValue(`name: ${name}\nsteps: []\n`),
    toDefinition: vi.fn().mockReturnValue({ name, description, steps: [] }),
  };
}

const mockSkillChainConstructor = vi.fn().mockImplementation(makeMockChainInstance);
(mockSkillChainConstructor as unknown as Record<string, unknown>).fromYAML = mockSkillChainFromYAML;

// SkillCatalog factory: tests create fresh instances per describe block.
const mockSkillCatalogConstructor = vi.fn().mockImplementation(() => ({
  load: vi.fn().mockResolvedValue(undefined),
  getAll: vi.fn().mockReturnValue([]),
  search: vi.fn().mockReturnValue([]),
  filterByTierMinimum: vi.fn().mockReturnValue([]),
  save: vi.fn().mockResolvedValue(undefined),
  upsert: vi.fn(),
}));

const mockParseSkillMd = vi.fn();
const mockValidateAgentSkill = vi.fn();
vi.mock("@dantecode/skills-import", () => ({
  parseSkillMd: (...args: unknown[]) => mockParseSkillMd(...args),
  validateAgentSkill: (...args: unknown[]) => mockValidateAgentSkill(...args),
}));

const mockRunSkillPolicyCheck = vi.fn();
vi.mock("@dantecode/skills-policy", () => ({
  runSkillPolicyCheck: (...args: unknown[]) => mockRunSkillPolicyCheck(...args),
}));

const mockRunSkill = vi.fn();
const mockMakeRunContext = vi.fn();
const mockMakeProvenance = vi.fn();
vi.mock("@dantecode/skills-runtime", () => ({
  runSkill: (...args: unknown[]) => mockRunSkill(...args),
  makeRunContext: (...args: unknown[]) => mockMakeRunContext(...args),
  makeProvenance: (...args: unknown[]) => mockMakeProvenance(...args),
}));

const mockExportAgentSkill = vi.fn();
vi.mock("@dantecode/skills-export", () => ({
  exportAgentSkill: (...args: unknown[]) => mockExportAgentSkill(...args),
}));

vi.mock("@dantecode/skill-adapter", () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
  getSkillWithBridgeMeta: (...args: unknown[]) => mockGetSkillWithBridgeMeta(...args),
  removeSkill: vi.fn().mockResolvedValue(false),
  validateSkill: vi.fn().mockResolvedValue(null),
  importSkills: vi.fn().mockResolvedValue({ imported: [], skipped: [], errors: [] }),
  wrapSkillWithAdapter: vi.fn().mockReturnValue("wrapped"),
  importSkillBridgeBundle: (...args: unknown[]) => mockImportSkillBridgeBundle(...args),
  listBridgeWarnings: (...args: unknown[]) => mockListBridgeWarnings(...args),
  validateBridgeSkill: (...args: unknown[]) => mockValidateBridgeSkill(...args),
  installSkill: (...args: unknown[]) => mockInstallSkill(...args),
  // SkillCatalog: skills.ts uses `new SkillCatalog(projectRoot)` so the mock
  // must be a constructor. We use a class that delegates to module-level fns.
  SkillCatalog: class MockSkillCatalogInFactory {
    constructor(...args: unknown[]) {
      return mockSkillCatalogConstructor(...args);
    }
  },
  bundleSkill: (...args: unknown[]) => mockBundleSkill(...args),
  detectSkillSources: (...args: unknown[]) => mockDetectSkillSources(...args),
  parseUniversalSkill: (...args: unknown[]) => mockParseUniversalSkill(...args),
  universalToWrappable: vi.fn().mockReturnValue({}),
  // SkillChain needs both `new SkillChain(...)` and `SkillChain.fromYAML(...)`.
  SkillChain: Object.assign(
    class MockSkillChainInFactory {
      constructor(...args: unknown[]) {
        return mockSkillChainConstructor(...args);
      }
    },
    { fromYAML: (...args: unknown[]) => mockSkillChainFromYAML(...args) },
  ),
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
      const cb = args[args.length - 1] as (
        err: null,
        res: { stdout: string; stderr: string },
      ) => void;
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
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => {
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
    await writeFile(join(bundleDir, "skillbridge.json"), JSON.stringify({ version: "1" }), "utf-8");
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

// ---------------------------------------------------------------------------
// install subcommand
// ---------------------------------------------------------------------------

describe("skills install", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-install-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockInstallSkill.mockReset();
    mockInstallSkill.mockResolvedValue({
      success: true,
      name: "my-skill",
      installedPath: "/p/.dantecode/skills/my-skill",
      source: ".",
      format: "claude",
    });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("calls installSkill with the correct source and default tier", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["install", "."], projectRoot);

    expect(mockInstallSkill).toHaveBeenCalledTimes(1);
    const [opts] = mockInstallSkill.mock.calls[0] as [
      { source: string; tier: string; verify: boolean; force: boolean; symlink: boolean },
    ];
    expect(opts.source).toBe(".");
    expect(opts.tier).toBe("guardian");
    expect(opts.verify).toBe(true);
    expect(opts.force).toBe(false);
    expect(opts.symlink).toBe(false);

    stdoutSpy.mockRestore();
  });

  it("--tier sentinel: passes sentinel tier to installSkill", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["install", ".", "--tier", "sentinel"], projectRoot);

    const [opts] = mockInstallSkill.mock.calls[0] as [{ tier: string }];
    expect(opts.tier).toBe("sentinel");

    stdoutSpy.mockRestore();
  });

  it("--no-verify: passes verify: false to installSkill", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["install", ".", "--no-verify"], projectRoot);

    const [opts] = mockInstallSkill.mock.calls[0] as [{ verify: boolean }];
    expect(opts.verify).toBe(false);

    stdoutSpy.mockRestore();
  });

  it("failed install: outputs error message", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    mockInstallSkill.mockResolvedValue({
      success: false,
      name: "",
      installedPath: "",
      source: ".",
      format: "unknown",
      error: "Skill not found at path",
    });

    await runSkillsCommand(["install", "."], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Install failed");
    expect(output).toContain("Skill not found at path");

    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// search subcommand
// ---------------------------------------------------------------------------

describe("skills search", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-search-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockSkillCatalogConstructor.mockReset();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("no query: constructs SkillCatalog with projectRoot and calls getAll()", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const mockLoad = vi.fn().mockResolvedValue(undefined);
    const mockGetAll = vi.fn().mockReturnValue([]);
    const mockSearch = vi.fn().mockReturnValue([]);
    mockSkillCatalogConstructor.mockImplementation(() => ({
      load: mockLoad,
      getAll: mockGetAll,
      search: mockSearch,
      filterByTierMinimum: vi.fn().mockReturnValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn(),
    }));

    await runSkillsCommand(["search"], projectRoot);

    expect(mockSkillCatalogConstructor).toHaveBeenCalledWith(projectRoot);
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(mockSearch).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });

  it("with query: calls catalog.search(query) instead of getAll()", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const mockGetAll = vi.fn().mockReturnValue([]);
    const mockSearch = vi.fn().mockReturnValue([]);
    mockSkillCatalogConstructor.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      getAll: mockGetAll,
      search: mockSearch,
      filterByTierMinimum: vi.fn().mockReturnValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn(),
    }));

    await runSkillsCommand(["search", "refactor"], projectRoot);

    expect(mockSearch).toHaveBeenCalledWith("refactor");
    expect(mockGetAll).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });

  it("results found: prints entry names to stdout", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const fakeEntry = {
      name: "my-refactor-skill",
      description: "Refactors code",
      source: "claude",
      tags: [],
      verificationScore: 85,
      verificationTier: "guardian",
      version: "1.0.0",
      sourcePath: "/some/path",
      installedPath: "/install/path",
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockSkillCatalogConstructor.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockReturnValue([fakeEntry]),
      search: vi.fn().mockReturnValue([fakeEntry]),
      filterByTierMinimum: vi.fn().mockReturnValue([fakeEntry]),
      save: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn(),
    }));

    await runSkillsCommand(["search", "refactor"], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("my-refactor-skill");

    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// scan subcommand
// ---------------------------------------------------------------------------

describe("skills scan", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-scan-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockDetectSkillSources.mockReset();
    mockDetectSkillSources.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("no path arg: scans projectRoot", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["scan"], projectRoot);

    expect(mockDetectSkillSources).toHaveBeenCalledTimes(1);
    const [calledPath] = mockDetectSkillSources.mock.calls[0] as [string];
    expect(calledPath).toBe(projectRoot);

    stdoutSpy.mockRestore();
  });

  it("with path arg: scans the path resolved against projectRoot", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const subDir = join(projectRoot, "skills-src");
    await mkdir(subDir, { recursive: true });

    await runSkillsCommand(["scan", "skills-src"], projectRoot);

    expect(mockDetectSkillSources).toHaveBeenCalledTimes(1);
    const [calledPath] = mockDetectSkillSources.mock.calls[0] as [string];
    expect(calledPath).toBe(subDir);

    stdoutSpy.mockRestore();
  });

  it("detections found: prints format and confidence to stdout", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    mockDetectSkillSources.mockResolvedValue([
      { format: "claude", confidence: 0.9, paths: ["/project/skills-src/SKILL.md"] },
    ]);

    await runSkillsCommand(["scan"], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("claude");
    expect(output).toContain("90%");

    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// export subcommand
// ---------------------------------------------------------------------------

describe("skills export", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-export-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockGetSkill.mockReset();
    mockGetSkill.mockResolvedValue(null);
    mockBundleSkill.mockReset();
    mockBundleSkill.mockResolvedValue({
      success: true,
      skillName: "my-skill",
      outputPath: "/out/my-skill",
      filesWritten: [] as string[],
    });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("calls getSkill then bundleSkill with correct skillName and options", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    mockGetSkill.mockResolvedValue({
      name: "my-skill",
      frontmatter: { name: "my-skill", description: "A skill" },
      instructions: "Do things",
      sourcePath: "/some/path/SKILL.md",
      wrappedPath: "/some/path/SKILL.dc.md",
      importSource: "claude",
      adapterVersion: "1.0",
    });

    mockBundleSkill.mockResolvedValue({
      success: true,
      skillName: "my-skill",
      outputPath: join(projectRoot, "exported-skills", "my-skill"),
      filesWritten: ["/out/SKILL.md"],
    });

    await runSkillsCommand(["export", "my-skill"], projectRoot);

    expect(mockGetSkill).toHaveBeenCalledWith("my-skill", projectRoot);
    expect(mockBundleSkill).toHaveBeenCalledTimes(1);
    const [opts] = mockBundleSkill.mock.calls[0] as [
      { skillName: string; includeVerification: boolean; includeScripts: boolean },
    ];
    expect(opts.skillName).toBe("my-skill");
    expect(opts.includeVerification).toBe(true);
    expect(opts.includeScripts).toBe(true);

    stdoutSpy.mockRestore();
  });

  it("skill not found: prints error and does not call bundleSkill", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // mockGetSkill already returns null from beforeEach
    await runSkillsCommand(["export", "missing-skill"], projectRoot);

    expect(mockBundleSkill).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("custom outputPath: passes resolved outputPath to bundleSkill", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const customOut = join(projectRoot, "custom-out");

    mockGetSkill.mockResolvedValue({
      name: "my-skill",
      frontmatter: { name: "my-skill", description: "" },
      instructions: "",
      sourcePath: "/some/path",
      wrappedPath: null,
      importSource: "claude",
      adapterVersion: "1.0",
    });

    mockBundleSkill.mockResolvedValue({
      success: true,
      skillName: "my-skill",
      outputPath: customOut,
      filesWritten: [] as string[],
    });

    await runSkillsCommand(["export", "my-skill", customOut], projectRoot);

    const [opts] = mockBundleSkill.mock.calls[0] as [{ outputPath: string }];
    expect(opts.outputPath).toContain("custom-out");

    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// import-all subcommand
// ---------------------------------------------------------------------------

describe("skills import-all", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-importall-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockDetectSkillSources.mockReset();
    mockParseUniversalSkill.mockReset();
    mockInstallSkill.mockReset();
    mockDetectSkillSources.mockResolvedValue([]);
    mockParseUniversalSkill.mockResolvedValue({
      name: "parsed-skill",
      description: "parsed",
      instructions: "do",
      source: "claude",
      sourcePath: "/path/SKILL.md",
    });
    mockInstallSkill.mockResolvedValue({
      success: true,
      name: "parsed-skill",
      installedPath: "/install/path",
      source: "/path/SKILL.md",
      format: "claude",
    });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("no path arg: prints usage error and skips detectSkillSources", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["import-all"], projectRoot);

    expect(mockDetectSkillSources).not.toHaveBeenCalled();
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Usage");

    stdoutSpy.mockRestore();
  });

  it("path with no detections: prints warning message", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const scanDir = join(projectRoot, "empty-skills");
    await mkdir(scanDir, { recursive: true });

    await runSkillsCommand(["import-all", scanDir], projectRoot);

    expect(mockDetectSkillSources).toHaveBeenCalledWith(scanDir);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("No skill sources detected");

    stdoutSpy.mockRestore();
  });

  it("detections found: calls parseUniversalSkill and installSkill for each detected path", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const scanDir = join(projectRoot, "skills-src");
    await mkdir(scanDir, { recursive: true });

    mockDetectSkillSources.mockResolvedValue([
      { format: "claude", confidence: 0.9, paths: ["/path/SKILL.md", "/path2/SKILL.md"] },
    ]);

    await runSkillsCommand(["import-all", scanDir], projectRoot);

    expect(mockParseUniversalSkill).toHaveBeenCalledTimes(2);
    expect(mockInstallSkill).toHaveBeenCalledTimes(2);

    stdoutSpy.mockRestore();
  });

  it("--force flag: passes force: true to installSkill", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const scanDir = join(projectRoot, "skills-src");
    await mkdir(scanDir, { recursive: true });

    mockDetectSkillSources.mockResolvedValue([
      { format: "claude", confidence: 0.9, paths: ["/path/SKILL.md"] },
    ]);

    await runSkillsCommand(["import-all", scanDir, "--force"], projectRoot);

    const [opts] = mockInstallSkill.mock.calls[0] as [{ force: boolean }];
    expect(opts.force).toBe(true);

    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// compose subcommand
// ---------------------------------------------------------------------------

describe("skills compose", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-compose-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockSkillChainConstructor.mockReset();
    mockSkillChainConstructor.mockImplementation(makeMockChainInstance);
    mockSkillChainFromYAML.mockReset();
    mockSkillChainFromYAML.mockReturnValue({
      name: "mock-chain",
      getSteps: vi.fn().mockReturnValue([{ skillName: "step-one", params: {} }]),
    });
    (mockSkillChainConstructor as unknown as Record<string, unknown>).fromYAML =
      mockSkillChainFromYAML;
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("no chain name: prints usage error", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["compose"], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Usage");

    stdoutSpy.mockRestore();
  });

  it("chain file does not exist: prints 'not found' and shows template via new SkillChain()", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["compose", "my-chain"], projectRoot);

    expect(mockSkillChainConstructor).toHaveBeenCalledWith("my-chain", expect.any(String));
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("my-chain");
    expect(output).toContain("not found");

    stdoutSpy.mockRestore();
  });

  it("chain file exists: calls SkillChain.fromYAML with file content and displays steps", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const chainDir = join(projectRoot, ".dantecode", "skill-chains");
    await mkdir(chainDir, { recursive: true });
    const chainFile = join(chainDir, "my-chain.yaml");
    await writeFile(
      chainFile,
      "name: my-chain\ndescription: test chain\nsteps:\n  - skillName: step-one\n    params: {}\n",
      "utf-8",
    );

    await runSkillsCommand(["compose", "my-chain"], projectRoot);

    expect(mockSkillChainFromYAML).toHaveBeenCalledTimes(1);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("my-chain");

    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// info subcommand (alias for show — both call getSkill)
// ---------------------------------------------------------------------------

describe("skills info", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-info-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockGetSkillWithBridgeMeta.mockReset();
    mockGetSkillWithBridgeMeta.mockResolvedValue(null);
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("info <name>: delegates to getSkillWithBridgeMeta with the given name and projectRoot", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    mockGetSkillWithBridgeMeta.mockResolvedValue({
      name: "my-skill",
      frontmatter: { name: "my-skill", description: "A skill" },
      instructions: "Do the thing",
      sourcePath: "/some/SKILL.md",
      wrappedPath: "/some/SKILL.dc.md",
      importSource: "claude",
      adapterVersion: "1.0",
      constitutionCheckPassed: true,
      antiStubScanPassed: true,
    });

    await runSkillsCommand(["info", "my-skill"], projectRoot);

    expect(mockGetSkillWithBridgeMeta).toHaveBeenCalledWith("my-skill", projectRoot);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("my-skill");

    stdoutSpy.mockRestore();
  });

  it("info on unknown skill: prints 'Skill not found'", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    // mockGetSkillWithBridgeMeta already returns null from beforeEach
    await runSkillsCommand(["info", "nonexistent"], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Skill not found");

    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// install --tier validation
// ---------------------------------------------------------------------------

describe("skills install --tier validation", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "tier-install-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("--tier with invalid value: calls process.exit(1) with helpful error message", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => {
        throw new Error("process.exit called");
      });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      runSkillsCommand(["install", "/some/skill", "--tier", "legendary"], projectRoot),
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    const errOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(errOutput).toContain("invalid --tier value");
    expect(errOutput).toContain("legendary");

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("--tier with valid value 'sentinel': does NOT call process.exit", async () => {
    mockInstallSkill.mockResolvedValue({
      success: true,
      name: "ok-skill",
      installedPath: "/p/skills/ok-skill",
      source: "/some/skill",
      format: "claude",
    });
    const exitSpy = vi.spyOn(process, "exit");

    await runSkillsCommand(["install", "/some/skill", "--tier", "sentinel"], projectRoot);

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// import-all --tier validation
// ---------------------------------------------------------------------------

describe("skills import-all --tier validation", () => {
  let tmpRoot: string;
  let projectRoot: string;
  let batchDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "tier-ia-test-"));
    projectRoot = join(tmpRoot, "project");
    batchDir = join(tmpRoot, "batch");
    await mkdir(projectRoot, { recursive: true });
    await mkdir(batchDir, { recursive: true });
    mockDetectSkillSources.mockReset();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("import-all --tier with invalid value: calls process.exit(1)", async () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((_code?: number | string | null) => {
        throw new Error("process.exit called");
      });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      runSkillsCommand(["import-all", batchDir, "--tier", "elite"], projectRoot),
    ).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// agent-skills-import: parseSkillMd integration
// ---------------------------------------------------------------------------

describe("agent-skills-import: parseSkillMd integration", () => {
  let tmpRoot: string;
  let projectRoot: string;
  let agentSkillsDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "agent-skills-import-test-"));
    projectRoot = join(tmpRoot, "project");
    agentSkillsDir = join(projectRoot, ".agents", "skills", "my-skill");
    await mkdir(agentSkillsDir, { recursive: true });
    await writeFile(
      join(agentSkillsDir, "SKILL.md"),
      "---\nname: my-skill\ndescription: A test skill\n---\n\nDo something useful.",
    );
    mockParseSkillMd.mockReset();
    mockValidateAgentSkill.mockReset();
    mockRunSkillPolicyCheck.mockReset();
    // Default happy-path stubs
    mockParseSkillMd.mockReturnValue({
      ok: true,
      skill: {
        name: "my-skill",
        description: "A test skill",
        instructions: "Do something useful.",
        sourcePath: join(agentSkillsDir, "SKILL.md"),
      },
    });
    mockValidateAgentSkill.mockReturnValue({ valid: true, errors: [], warnings: [] });
    mockRunSkillPolicyCheck.mockReturnValue({ passed: true, errors: [], warnings: [] });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("calls parseSkillMd with file content and resolved path", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSkillsCommand(["agent-skills-import"], projectRoot);
    expect(mockParseSkillMd).toHaveBeenCalledTimes(1);
    const callArgs = mockParseSkillMd.mock.calls[0];
    expect(typeof callArgs?.[0]).toBe("string"); // content
    expect(String(callArgs?.[1])).toContain("SKILL.md"); // resolved path
  });

  it("increments failed count when parseSkillMd returns ok:false", async () => {
    mockParseSkillMd.mockReturnValue({
      ok: false,
      errors: [{ code: "SKILL-001", message: "Missing name field" }],
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSkillsCommand(["agent-skills-import"], projectRoot);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Failed: 1");
    stdoutSpy.mockRestore();
  });

  it("calls validateAgentSkill after successful parseSkillMd", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSkillsCommand(["agent-skills-import"], projectRoot);
    expect(mockValidateAgentSkill).toHaveBeenCalledTimes(1);
    const callArg = mockValidateAgentSkill.mock.calls[0]?.[0];
    expect(callArg).toMatchObject({ name: "my-skill" });
  });

  it("SKILL-004 blocking policy error increments failed count", async () => {
    mockRunSkillPolicyCheck.mockReturnValue({
      passed: false,
      errors: [{ code: "SKILL-004", message: "Unsupported tool: Bash" }],
      warnings: [],
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSkillsCommand(["agent-skills-import"], projectRoot);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("Failed: 1");
    stdoutSpy.mockRestore();
  });

  it("SKILL-005 advisory warning prints but still imports", async () => {
    mockRunSkillPolicyCheck.mockReturnValue({
      passed: true,
      errors: [],
      warnings: [{ code: "SKILL-005", message: "Unknown compat agent: codex" }],
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runSkillsCommand(["agent-skills-import"], projectRoot);
    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("SKILL-005");
    expect(output).not.toContain("Failed: 1");
    stdoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// skills run subcommand
// ---------------------------------------------------------------------------

describe("skills run", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "skills-run-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockGetSkill.mockReset();
    mockRunSkillPolicyCheck.mockReset();
    mockRunSkill.mockReset();
    mockMakeRunContext.mockReset();
    mockMakeProvenance.mockReset();
    // Default stubs
    mockRunSkillPolicyCheck.mockReturnValue({ passed: true, errors: [], warnings: [] });
    mockRunSkill.mockResolvedValue({
      state: "applied",
      plainLanguageSummary: "Done.",
      runId: "r1",
    });
    mockMakeRunContext.mockReturnValue({});
    mockMakeProvenance.mockReturnValue({
      sourceType: "native",
      sourceRef: "",
      license: "MIT",
      importedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("finds skill, runs it, and prints APPLIED state", async () => {
    mockGetSkill.mockResolvedValue({
      frontmatter: { name: "my-skill", description: "A test skill", tools: ["Read"] },
      instructions: "Do something useful.",
      sourcePath: "/p/SKILL.md",
      wrappedPath: "/p/SKILL.dc.md",
      importSource: "claude",
    });
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["run", "my-skill"], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("APPLIED");
    expect(output).toContain("Done.");
    expect(mockRunSkill).toHaveBeenCalledTimes(1);

    stdoutSpy.mockRestore();
  });

  it("prints not-found message when skill is absent", async () => {
    mockGetSkill.mockResolvedValue(null);
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["run", "nonexistent-skill"], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("not found");
    expect(mockRunSkill).not.toHaveBeenCalled();

    stdoutSpy.mockRestore();
  });
});

describe("skills export — uses exportAgentSkill() (Lane B)", () => {
  let tmpRoot: string;
  let projectRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "dantecode-export-test-"));
    projectRoot = join(tmpRoot, "project");
    await mkdir(projectRoot, { recursive: true });
    mockGetSkill.mockReset();
    mockExportAgentSkill.mockReset();

    mockGetSkill.mockResolvedValue({
      frontmatter: { name: "my-skill", description: "Does something", tools: ["Read", "Write"] },
      instructions: "Step 1: do the thing.",
      sourcePath: "/skills/my-skill.md",
      importSource: "native",
    });
    mockExportAgentSkill.mockResolvedValue({
      ok: true,
      outputPath: "/out/my-skill/SKILL.md",
      warnings: [],
    });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it("calls exportAgentSkill with correct ExportableSkill shape", async () => {
    const outDir = join(tmpRoot, "out");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["export", "my-skill", "--out", outDir], projectRoot);

    expect(mockExportAgentSkill).toHaveBeenCalledOnce();
    const [exportable, passedDir] = mockExportAgentSkill.mock.calls[0] as [
      { name: string; slug: string; instructions: string; allowedTools: string[] },
      string,
    ];
    expect(exportable.name).toBe("my-skill");
    expect(exportable.slug).toBe("my-skill");
    expect(exportable.instructions).toBe("Step 1: do the thing.");
    expect(exportable.allowedTools).toEqual(["Read", "Write"]);
    expect(passedDir).toBe(outDir);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toMatch(/exported skill/i);

    stdoutSpy.mockRestore();
  });

  it("warns on SKILL-008 advisory warnings from exportAgentSkill", async () => {
    mockExportAgentSkill.mockResolvedValue({
      ok: true,
      outputPath: "/out/my-skill/SKILL.md",
      warnings: [
        {
          code: "SKILL-008",
          message: "Skill has provenance fields that cannot be represented",
          field: "provenance",
        },
      ],
    });

    const outDir = join(tmpRoot, "out");
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await runSkillsCommand(["export", "my-skill", "--out", outDir], projectRoot);

    const output = stdoutSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("SKILL-008");

    stdoutSpy.mockRestore();
  });
});
