// ============================================================================
// @dantecode/cli — Banner Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { isFirstRun, getFirstRunBanner, getCompactBanner, getBanner } from "./banner.js";
import type { ModelConfig } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  const dir = join(tmpdir(), `banner-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    provider: "anthropic" as ModelConfig["provider"],
    modelId: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    temperature: 0.7,
    contextWindow: 131072,
    supportsVision: true,
    supportsToolCalls: true,
    ...overrides,
  };
}

// Strip ANSI escape codes for content assertions
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// isFirstRun
// ---------------------------------------------------------------------------

describe("isFirstRun", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns true when sessions dir does not exist", () => {
    expect(isFirstRun(tempDir)).toBe(true);
  });

  it("returns true when sessions dir exists but is empty", () => {
    mkdirSync(join(tempDir, ".dantecode", "sessions"), { recursive: true });
    expect(isFirstRun(tempDir)).toBe(true);
  });

  it("returns true when sessions dir has only non-json files", () => {
    const sessionsDir = join(tempDir, ".dantecode", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "readme.txt"), "not a session");
    expect(isFirstRun(tempDir)).toBe(true);
  });

  it("returns false when sessions dir has .json files", () => {
    const sessionsDir = join(tempDir, ".dantecode", "sessions");
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, "abc-123.json"), "{}");
    expect(isFirstRun(tempDir)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getFirstRunBanner
// ---------------------------------------------------------------------------

describe("getFirstRunBanner", () => {
  it("contains 'DanteCode'", () => {
    const banner = getFirstRunBanner();
    expect(stripAnsi(banner)).toContain("DanteCode");
  });

  it("contains /magic examples for non-technical users", () => {
    const banner = getFirstRunBanner();
    const plain = stripAnsi(banner);
    expect(plain).toContain("/magic");
    expect(plain).toContain("Build a todo app");
  });

  it("does not contain engineering jargon", () => {
    const banner = getFirstRunBanner();
    const plain = stripAnsi(banner);
    expect(plain).not.toContain("Portable Skill Runtime");
    expect(plain).not.toContain("PDSE");
    expect(plain).not.toContain("Autoforge IAL");
    expect(plain).not.toContain("DanteForge");
  });

  it("contains /help", () => {
    const banner = getFirstRunBanner();
    expect(stripAnsi(banner)).toContain("/help");
  });

  it("includes the version string", () => {
    const banner = getFirstRunBanner("3.5.0");
    expect(stripAnsi(banner)).toContain("v3.5.0");
  });

  it("has at most 12 lines", () => {
    const banner = getFirstRunBanner();
    const lines = banner.split("\n");
    expect(lines.length).toBeLessThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// getCompactBanner
// ---------------------------------------------------------------------------

describe("getCompactBanner", () => {
  it("is a single line (no newlines)", () => {
    const model = makeModel();
    const banner = getCompactBanner(model);
    expect(banner).not.toContain("\n");
  });

  it("contains provider/model info", () => {
    const model = makeModel({
      provider: "anthropic" as ModelConfig["provider"],
      modelId: "claude-sonnet-4-20250514",
    });
    const banner = getCompactBanner(model);
    const plain = stripAnsi(banner);
    expect(plain).toContain("anthropic/claude-sonnet-4-20250514");
  });

  it("contains /help", () => {
    const model = makeModel();
    const banner = getCompactBanner(model);
    expect(stripAnsi(banner)).toContain("/help");
  });

  it("includes the version string", () => {
    const model = makeModel();
    const banner = getCompactBanner(model, "2.1.0");
    expect(stripAnsi(banner)).toContain("v2.1.0");
  });
});

// ---------------------------------------------------------------------------
// getBanner — OnRamp v1.3: no engineering jargon
// ---------------------------------------------------------------------------

describe("getBanner", () => {
  it("contains DanteCode and version", () => {
    const model = makeModel();
    const banner = getBanner(model, "/tmp/project", "1.3.0");
    const plain = stripAnsi(banner);
    expect(plain).toContain("DanteCode");
    expect(plain).toContain("v1.3.0");
  });

  it("does not contain engineering jargon", () => {
    const model = makeModel();
    const banner = getBanner(model, "/tmp/project");
    const plain = stripAnsi(banner);
    expect(plain).not.toContain("Portable Skill Runtime");
    expect(plain).not.toContain("PDSE");
    expect(plain).not.toContain("Autoforge IAL");
    expect(plain).not.toContain("DanteForge");
    expect(plain).not.toContain("Context:");
  });

  it("suggests /magic as primary action", () => {
    const model = makeModel();
    const banner = getBanner(model, "/tmp/project");
    const plain = stripAnsi(banner);
    expect(plain).toContain("/magic");
  });

  it("shows model and project info", () => {
    const model = makeModel({
      provider: "anthropic" as ModelConfig["provider"],
      modelId: "claude-sonnet-4-20250514",
    });
    const banner = getBanner(model, "/home/user/myproject");
    const plain = stripAnsi(banner);
    expect(plain).toContain("anthropic/claude-sonnet-4-20250514");
    expect(plain).toContain("/home/user/myproject");
  });
});
