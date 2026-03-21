// ============================================================================
// @dantecode/skill-adapter — SkillBridge Parser Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseSkillBridgeManifest,
  bundleHasDanteCodeTarget,
  getDanteCodeTargetPath,
} from "./skillbridge.js";

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const VALID_MANIFEST = {
  version: "1",
  source: {
    kind: "local-dir",
    url: "",
    repo: "",
    commit: "",
    path: "/tmp/web-scraper",
    license: "MIT",
  },
  normalizedSkill: {
    name: "web-scraper",
    slug: "web-scraper",
    description: "A web scraping skill",
    instructions: "You are a web scraping expert. Follow these instructions.",
    supportFiles: [],
    frontmatter: {},
    capabilities: {
      filesystem: false,
      network: true,
      shell: false,
      mcp: false,
      browser: false,
      llmRepairNeeded: false,
    },
    classification: "instruction-only",
  },
  emitters: {
    dantecode: { status: "success" },
    qwenSkill: { status: "success" },
    mcp: { status: "warning", warnings: ["manual binding required"] },
    cliWrapper: { status: "skipped" },
  },
  verification: {
    parsePassed: true,
    constitutionPassed: true,
    antiStubPassed: true,
    conversionScore: 0.93,
  },
  warnings: [],
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function createBundleDir(
  dir: string,
  manifest: unknown,
  hasDcTarget = false,
): Promise<void> {
  await writeFile(join(dir, "skillbridge.json"), JSON.stringify(manifest, null, 2), "utf-8");
  if (hasDcTarget) {
    const dcDir = join(dir, "targets", "dantecode");
    await mkdir(dcDir, { recursive: true });
    await writeFile(join(dcDir, "SKILL.dc.md"), "# Wrapped skill\n", "utf-8");
  }
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("parseSkillBridgeManifest", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sb-parser-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns ok:true for a valid manifest", async () => {
    await createBundleDir(tmpDir, VALID_MANIFEST);
    const result = await parseSkillBridgeManifest(tmpDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.normalizedSkill.name).toBe("web-scraper");
    expect(result.manifest.normalizedSkill.slug).toBe("web-scraper");
    expect(result.manifest.verification.conversionScore).toBe(0.93);
    expect(result.manifest.emitters.dantecode.status).toBe("success");
    expect(result.manifest.emitters.mcp.warnings).toEqual(["manual binding required"]);
  });

  it("returns ok:false when bundle directory does not exist", async () => {
    const result = await parseSkillBridgeManifest("/nonexistent/path/to/bundle");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it("returns ok:false when skillbridge.json is missing", async () => {
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/skillbridge\.json not found/i);
  });

  it("returns ok:false for invalid JSON", async () => {
    await writeFile(join(tmpDir, "skillbridge.json"), "{ not valid json }", "utf-8");
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/invalid JSON/i);
  });

  it("returns ok:false when version is missing", async () => {
    const bad = { ...VALID_MANIFEST, version: undefined };
    await createBundleDir(tmpDir, bad);
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when normalizedSkill is missing", async () => {
    const { normalizedSkill: _ns, ...bad } = VALID_MANIFEST;
    await createBundleDir(tmpDir, bad);
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when emitters is missing", async () => {
    const { emitters: _em, ...bad } = VALID_MANIFEST;
    await createBundleDir(tmpDir, bad);
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(false);
  });

  it("defaults missing optional emitter fields gracefully", async () => {
    const manifest = {
      ...VALID_MANIFEST,
      emitters: {
        dantecode: { status: "success" },
        qwenSkill: { status: "skipped" },
        mcp: { status: "blocked" },
        cliWrapper: {},
      },
    };
    await createBundleDir(tmpDir, manifest);
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.emitters.cliWrapper.status).toBe("skipped");
  });

  it("handles empty warnings array", async () => {
    await createBundleDir(tmpDir, { ...VALID_MANIFEST, warnings: [] });
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.warnings).toEqual([]);
  });

  it("handles populated warnings array", async () => {
    const manifest = { ...VALID_MANIFEST, warnings: ["check MCP config", "review instructions"] };
    await createBundleDir(tmpDir, manifest);
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.warnings).toHaveLength(2);
  });

  it("correctly maps all capability flags", async () => {
    const manifest = {
      ...VALID_MANIFEST,
      normalizedSkill: {
        ...VALID_MANIFEST.normalizedSkill,
        capabilities: {
          filesystem: true,
          network: true,
          shell: true,
          mcp: true,
          browser: true,
          llmRepairNeeded: true,
        },
      },
    };
    await createBundleDir(tmpDir, manifest);
    const result = await parseSkillBridgeManifest(tmpDir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const caps = result.manifest.normalizedSkill.capabilities;
    expect(caps.filesystem).toBe(true);
    expect(caps.shell).toBe(true);
    expect(caps.browser).toBe(true);
    expect(caps.mcp).toBe(true);
    expect(caps.llmRepairNeeded).toBe(true);
  });

  it("returns ok:false when bundle path is a file not a directory", async () => {
    const filePath = join(tmpDir, "not-a-dir.json");
    await writeFile(filePath, "{}", "utf-8");
    const result = await parseSkillBridgeManifest(filePath);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatch(/not a directory/i);
  });
});

describe("bundleHasDanteCodeTarget", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sb-dctarget-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true when targets/dantecode/SKILL.dc.md exists", async () => {
    await createBundleDir(tmpDir, VALID_MANIFEST, true);
    const result = await bundleHasDanteCodeTarget(tmpDir);
    expect(result).toBe(true);
  });

  it("returns false when targets/dantecode/SKILL.dc.md is absent", async () => {
    const result = await bundleHasDanteCodeTarget(tmpDir);
    expect(result).toBe(false);
  });

  it("returns false when only the directory exists without SKILL.dc.md", async () => {
    await mkdir(join(tmpDir, "targets", "dantecode"), { recursive: true });
    const result = await bundleHasDanteCodeTarget(tmpDir);
    expect(result).toBe(false);
  });
});

describe("getDanteCodeTargetPath", () => {
  it("returns the expected path", () => {
    const bundleDir = "/projects/my-bundle";
    const expected = join(bundleDir, "targets/dantecode", "SKILL.dc.md");
    expect(getDanteCodeTargetPath(bundleDir)).toBe(expected);
  });
});
