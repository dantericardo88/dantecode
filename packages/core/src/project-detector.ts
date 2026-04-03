// ============================================================================
// @dantecode/core — Language-Aware Project Stack Detection
// Scans a project root for marker files and returns the detected language,
// framework, test runner, and package manager. Also provides language-aware
// GStack command defaults for the autoforge pipeline.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GStackCommand } from "@dantecode/config-types";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Supported project languages that can be auto-detected. */
export type ProjectLanguage = "typescript" | "javascript" | "python" | "rust" | "go" | "unknown";

/** Result of scanning a project root for language, framework, and tooling. */
export interface DetectedStack {
  language: ProjectLanguage;
  framework?: string;
  testRunner?: string;
  packageManager?: "npm" | "yarn" | "pnpm" | "bun";
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Detects the project language, framework, test runner, and package manager
 * by scanning marker files in the project root.
 *
 * Detection order: TypeScript > JavaScript > Python > Rust > Go > unknown.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns The detected stack information.
 */
export function detectProjectStack(projectRoot: string): DetectedStack {
  const exists = (f: string) => existsSync(join(projectRoot, f));

  // TypeScript
  if (exists("tsconfig.json")) {
    return {
      language: "typescript",
      framework: detectJsFramework(projectRoot),
      testRunner: detectJsTestRunner(projectRoot),
      packageManager: detectPackageManager(projectRoot),
    };
  }

  // JavaScript (no tsconfig but has package.json)
  if (exists("package.json")) {
    return {
      language: "javascript",
      framework: detectJsFramework(projectRoot),
      testRunner: detectJsTestRunner(projectRoot),
      packageManager: detectPackageManager(projectRoot),
    };
  }

  // Python
  if (exists("pyproject.toml") || exists("requirements.txt") || exists("setup.py")) {
    return { language: "python" };
  }

  // Rust
  if (exists("Cargo.toml")) {
    return { language: "rust" };
  }

  // Go
  if (exists("go.mod")) {
    return { language: "go" };
  }

  return { language: "unknown" };
}

// ─── JS/TS Helpers ───────────────────────────────────────────────────────────

/**
 * Detects the JS/TS framework from package.json dependencies.
 */
function detectJsFramework(projectRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["next"]) return "next";
    if (allDeps["nuxt"]) return "nuxt";
    if (allDeps["svelte"] || allDeps["@sveltejs/kit"]) return "svelte";
    if (allDeps["react"]) return "react";
    if (allDeps["vue"]) return "vue";
    if (allDeps["express"]) return "express";
  } catch {
    /* no package.json or invalid JSON */
  }
  return undefined;
}

/**
 * Detects the JS/TS test runner from package.json dependencies.
 */
function detectJsTestRunner(projectRoot: string): string | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf-8"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (allDeps["vitest"]) return "vitest";
    if (allDeps["jest"]) return "jest";
    if (allDeps["mocha"]) return "mocha";
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * Detects the package manager from lockfile presence.
 */
function detectPackageManager(projectRoot: string): "npm" | "yarn" | "pnpm" | "bun" {
  const exists = (f: string) => existsSync(join(projectRoot, f));
  if (exists("bun.lockb")) return "bun";
  if (exists("pnpm-lock.yaml")) return "pnpm";
  if (exists("yarn.lock")) return "yarn";
  return "npm";
}

// ─── GStack Defaults ─────────────────────────────────────────────────────────

/**
 * Returns language-aware default GStack commands for the autoforge pipeline.
 *
 * Each language gets appropriate typecheck, lint, and test commands.
 * Unknown languages receive no-op (`true`) commands as safe fallbacks.
 *
 * @param stack - The detected project stack.
 * @returns An array of GStackCommand objects for autoforge configuration.
 */
export function getGStackDefaults(stack: DetectedStack): GStackCommand[] {
  switch (stack.language) {
    case "typescript":
      return [
        {
          name: "typecheck",
          command: "npx tsc --noEmit",
          runInSandbox: true,
          timeoutMs: 60000,
          failureIsSoft: false,
        },
        {
          name: "lint",
          command: "npx eslint .",
          runInSandbox: true,
          timeoutMs: 60000,
          failureIsSoft: true,
        },
        {
          name: "test",
          command: getJsTestCommand(stack.testRunner),
          runInSandbox: true,
          timeoutMs: 120000,
          failureIsSoft: false,
        },
      ];
    case "javascript":
      return [
        {
          name: "typecheck",
          command: "true",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: true,
        },
        {
          name: "lint",
          command: "npx eslint .",
          runInSandbox: true,
          timeoutMs: 60000,
          failureIsSoft: true,
        },
        {
          name: "test",
          command: getJsTestCommand(stack.testRunner),
          runInSandbox: true,
          timeoutMs: 120000,
          failureIsSoft: false,
        },
      ];
    case "python":
      return [
        {
          name: "typecheck",
          command: "true",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: true,
        },
        {
          name: "lint",
          command: "true",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: true,
        },
        {
          name: "test",
          command: "pytest",
          runInSandbox: true,
          timeoutMs: 120000,
          failureIsSoft: false,
        },
      ];
    case "rust":
      return [
        {
          name: "typecheck",
          command: "cargo check",
          runInSandbox: true,
          timeoutMs: 120000,
          failureIsSoft: false,
        },
        {
          name: "lint",
          command: "cargo clippy -- -D warnings",
          runInSandbox: true,
          timeoutMs: 120000,
          failureIsSoft: true,
        },
        {
          name: "test",
          command: "cargo test",
          runInSandbox: true,
          timeoutMs: 180000,
          failureIsSoft: false,
        },
      ];
    case "go":
      return [
        {
          name: "typecheck",
          command: "go vet ./...",
          runInSandbox: true,
          timeoutMs: 60000,
          failureIsSoft: false,
        },
        {
          name: "lint",
          command: "golangci-lint run",
          runInSandbox: true,
          timeoutMs: 60000,
          failureIsSoft: true,
        },
        {
          name: "test",
          command: "go test ./...",
          runInSandbox: true,
          timeoutMs: 120000,
          failureIsSoft: false,
        },
      ];
    default:
      return [
        {
          name: "typecheck",
          command: "true",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: true,
        },
        {
          name: "lint",
          command: "true",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: true,
        },
        {
          name: "test",
          command: "true",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: true,
        },
      ];
  }
}

/**
 * Returns the appropriate test command for a JS/TS test runner.
 */
function getJsTestCommand(testRunner?: string): string {
  switch (testRunner) {
    case "vitest":
      return "npx vitest run";
    case "jest":
      return "npx jest";
    case "mocha":
      return "npx mocha";
    default:
      return "npx vitest run";
  }
}
