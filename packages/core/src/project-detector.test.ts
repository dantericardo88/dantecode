// ============================================================================
// @dantecode/core — Project Detector Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectProjectStack, getGStackDefaults } from "./project-detector.js";
import type { DetectedStack } from "./project-detector.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let testDir: string;

function touch(relativePath: string, content = ""): void {
  const fullPath = join(testDir, relativePath);
  const dir = fullPath.replace(/[\\/][^\\/]+$/, "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function writePkg(deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): void {
  const pkg = {
    name: "test-project",
    dependencies: deps,
    devDependencies: devDeps,
  };
  touch("package.json", JSON.stringify(pkg, null, 2));
}

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "dantecode-detector-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ─── detectProjectStack ──────────────────────────────────────────────────────

describe("detectProjectStack", () => {
  // --------------------------------------------------------------------------
  // Language detection
  // --------------------------------------------------------------------------

  describe("language detection", () => {
    it("detects TypeScript when tsconfig.json is present", () => {
      touch("tsconfig.json", "{}");
      writePkg();
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("typescript");
    });

    it("detects JavaScript when only package.json is present (no tsconfig)", () => {
      writePkg();
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("javascript");
    });

    it("detects Python when requirements.txt is present", () => {
      touch("requirements.txt", "flask==2.0\n");
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("python");
    });

    it("detects Python when pyproject.toml is present", () => {
      touch("pyproject.toml", "[project]\nname = 'test'\n");
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("python");
    });

    it("detects Python when setup.py is present", () => {
      touch("setup.py", "from setuptools import setup\nsetup()\n");
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("python");
    });

    it("detects Rust when Cargo.toml is present", () => {
      touch("Cargo.toml", '[package]\nname = "test"\n');
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("rust");
    });

    it("detects Go when go.mod is present", () => {
      touch("go.mod", "module example.com/test\ngo 1.21\n");
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("go");
    });

    it("returns unknown for empty directory", () => {
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("unknown");
    });

    it("prioritizes TypeScript over JavaScript when both tsconfig and package.json exist", () => {
      touch("tsconfig.json", "{}");
      writePkg();
      const result = detectProjectStack(testDir);
      expect(result.language).toBe("typescript");
    });
  });

  // --------------------------------------------------------------------------
  // Framework detection
  // --------------------------------------------------------------------------

  describe("framework detection", () => {
    it("detects Next.js from dependencies", () => {
      touch("tsconfig.json", "{}");
      writePkg({ next: "14.0.0", react: "18.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBe("next");
    });

    it("detects Nuxt from dependencies", () => {
      touch("tsconfig.json", "{}");
      writePkg({ nuxt: "3.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBe("nuxt");
    });

    it("detects Svelte from dependencies", () => {
      writePkg({ svelte: "4.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBe("svelte");
    });

    it("detects SvelteKit from @sveltejs/kit", () => {
      writePkg({}, { "@sveltejs/kit": "2.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBe("svelte");
    });

    it("detects React from dependencies", () => {
      writePkg({ react: "18.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBe("react");
    });

    it("detects Vue from dependencies", () => {
      writePkg({ vue: "3.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBe("vue");
    });

    it("detects Express from dependencies", () => {
      writePkg({ express: "4.18.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBe("express");
    });

    it("returns undefined framework when no known framework found", () => {
      writePkg({ lodash: "4.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.framework).toBeUndefined();
    });

    it("does not detect framework for non-JS languages", () => {
      touch("Cargo.toml", '[package]\nname = "test"\n');
      const result = detectProjectStack(testDir);
      expect(result.framework).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Test runner detection
  // --------------------------------------------------------------------------

  describe("test runner detection", () => {
    it("detects vitest from devDependencies", () => {
      touch("tsconfig.json", "{}");
      writePkg({}, { vitest: "3.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.testRunner).toBe("vitest");
    });

    it("detects jest from devDependencies", () => {
      writePkg({}, { jest: "29.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.testRunner).toBe("jest");
    });

    it("detects mocha from devDependencies", () => {
      writePkg({}, { mocha: "10.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.testRunner).toBe("mocha");
    });

    it("returns undefined test runner when no known runner found", () => {
      writePkg({}, { typescript: "5.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.testRunner).toBeUndefined();
    });

    it("detects vitest from dependencies (not just devDependencies)", () => {
      writePkg({ vitest: "3.0.0" });
      const result = detectProjectStack(testDir);
      expect(result.testRunner).toBe("vitest");
    });
  });

  // --------------------------------------------------------------------------
  // Package manager detection
  // --------------------------------------------------------------------------

  describe("package manager detection", () => {
    it("detects bun from bun.lockb", () => {
      writePkg();
      touch("bun.lockb", "");
      const result = detectProjectStack(testDir);
      expect(result.packageManager).toBe("bun");
    });

    it("detects pnpm from pnpm-lock.yaml", () => {
      writePkg();
      touch("pnpm-lock.yaml", "lockfileVersion: 9\n");
      const result = detectProjectStack(testDir);
      expect(result.packageManager).toBe("pnpm");
    });

    it("detects yarn from yarn.lock", () => {
      writePkg();
      touch("yarn.lock", "# yarn lockfile v1\n");
      const result = detectProjectStack(testDir);
      expect(result.packageManager).toBe("yarn");
    });

    it("defaults to npm when no lockfile found", () => {
      writePkg();
      const result = detectProjectStack(testDir);
      expect(result.packageManager).toBe("npm");
    });

    it("prioritizes bun over pnpm when both lockfiles exist", () => {
      writePkg();
      touch("bun.lockb", "");
      touch("pnpm-lock.yaml", "lockfileVersion: 9\n");
      const result = detectProjectStack(testDir);
      expect(result.packageManager).toBe("bun");
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles malformed package.json gracefully", () => {
      touch("package.json", "not valid json {{{");
      const result = detectProjectStack(testDir);
      // Still detects JS from package.json presence
      expect(result.language).toBe("javascript");
      // Framework/runner should be undefined due to parse failure
      expect(result.framework).toBeUndefined();
      expect(result.testRunner).toBeUndefined();
    });
  });
});

// ─── getGStackDefaults ───────────────────────────────────────────────────────

describe("getGStackDefaults", () => {
  it("returns TypeScript GStack with tsc --noEmit for typecheck", () => {
    const stack: DetectedStack = { language: "typescript", packageManager: "npm" };
    const commands = getGStackDefaults(stack);
    expect(commands).toHaveLength(3);
    expect(commands[0]!.name).toBe("typecheck");
    expect(commands[0]!.command).toBe("npx tsc --noEmit");
    expect(commands[0]!.failureIsSoft).toBe(false);
  });

  it("returns JavaScript GStack with no-op typecheck", () => {
    const stack: DetectedStack = { language: "javascript", packageManager: "npm" };
    const commands = getGStackDefaults(stack);
    expect(commands[0]!.command).toBe("true");
    expect(commands[0]!.failureIsSoft).toBe(true);
  });

  it("returns Python GStack with pytest", () => {
    const stack: DetectedStack = { language: "python" };
    const commands = getGStackDefaults(stack);
    const testCmd = commands.find((c) => c.name === "test");
    expect(testCmd).toBeDefined();
    expect(testCmd!.command).toBe("pytest");
  });

  it("returns Rust GStack with cargo check and cargo test", () => {
    const stack: DetectedStack = { language: "rust" };
    const commands = getGStackDefaults(stack);
    expect(commands[0]!.command).toBe("cargo check");
    expect(commands[2]!.command).toBe("cargo test");
  });

  it("returns Go GStack with go vet and go test", () => {
    const stack: DetectedStack = { language: "go" };
    const commands = getGStackDefaults(stack);
    expect(commands[0]!.command).toBe("go vet ./...");
    expect(commands[2]!.command).toBe("go test ./...");
  });

  it("returns no-op GStack for unknown language", () => {
    const stack: DetectedStack = { language: "unknown" };
    const commands = getGStackDefaults(stack);
    expect(commands).toHaveLength(3);
    for (const cmd of commands) {
      expect(cmd.command).toBe("true");
      expect(cmd.failureIsSoft).toBe(true);
    }
  });

  it("uses vitest when testRunner is vitest", () => {
    const stack: DetectedStack = {
      language: "typescript",
      testRunner: "vitest",
      packageManager: "npm",
    };
    const commands = getGStackDefaults(stack);
    const testCmd = commands.find((c) => c.name === "test");
    expect(testCmd!.command).toBe("npx vitest run");
  });

  it("uses jest when testRunner is jest", () => {
    const stack: DetectedStack = {
      language: "typescript",
      testRunner: "jest",
      packageManager: "npm",
    };
    const commands = getGStackDefaults(stack);
    const testCmd = commands.find((c) => c.name === "test");
    expect(testCmd!.command).toBe("npx jest");
  });

  it("uses mocha when testRunner is mocha", () => {
    const stack: DetectedStack = {
      language: "javascript",
      testRunner: "mocha",
      packageManager: "npm",
    };
    const commands = getGStackDefaults(stack);
    const testCmd = commands.find((c) => c.name === "test");
    expect(testCmd!.command).toBe("npx mocha");
  });

  it("defaults test command to vitest when testRunner is undefined", () => {
    const stack: DetectedStack = { language: "typescript", packageManager: "npm" };
    const commands = getGStackDefaults(stack);
    const testCmd = commands.find((c) => c.name === "test");
    expect(testCmd!.command).toBe("npx vitest run");
  });

  it("sets appropriate sandbox flags for TypeScript commands", () => {
    const stack: DetectedStack = { language: "typescript", packageManager: "npm" };
    const commands = getGStackDefaults(stack);
    // typecheck and test should run in sandbox
    expect(commands[0]!.runInSandbox).toBe(true);
    expect(commands[2]!.runInSandbox).toBe(true);
  });

  it("sets lint as soft failure", () => {
    const stack: DetectedStack = { language: "typescript", packageManager: "npm" };
    const commands = getGStackDefaults(stack);
    const lintCmd = commands.find((c) => c.name === "lint");
    expect(lintCmd!.failureIsSoft).toBe(true);
  });

  it("sets appropriate timeouts for Rust commands", () => {
    const stack: DetectedStack = { language: "rust" };
    const commands = getGStackDefaults(stack);
    // Rust builds take longer
    expect(commands[0]!.timeoutMs).toBe(120000);
    expect(commands[2]!.timeoutMs).toBe(180000);
  });
});
