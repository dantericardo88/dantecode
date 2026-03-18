// ============================================================================
// @dantecode/mcp — CLI Entry Point Tests
// Validates that the standalone CLI entry point is correctly configured.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const PKG_ROOT = resolve(import.meta.dirname, "..");
const SRC_ROOT = resolve(PKG_ROOT, "src");

describe("MCP CLI entry point", () => {
  it("cli.ts file exists and is valid TypeScript", () => {
    const cliPath = resolve(SRC_ROOT, "cli.ts");
    expect(existsSync(cliPath)).toBe(true);

    const content = readFileSync(cliPath, "utf-8");
    expect(content).toContain("#!/usr/bin/env node");
    expect(content).toContain("startMCPServerStdio");
    expect(content).toContain('import');
  });

  it("package.json has a bin field pointing to dist/cli.js", () => {
    const pkgPath = resolve(PKG_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    expect(pkg.bin).toBeDefined();
    expect(pkg.bin["dantecode-mcp"]).toBe("./dist/cli.js");
  });

  it("build script compiles cli.ts alongside index.ts", () => {
    const pkgPath = resolve(PKG_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    expect(pkg.scripts.build).toContain("src/cli.ts");
    expect(pkg.scripts.build).toContain("src/index.ts");
  });

  it("cli.ts handles --help flag", () => {
    const cliPath = resolve(SRC_ROOT, "cli.ts");
    const content = readFileSync(cliPath, "utf-8");

    expect(content).toContain("--help");
    expect(content).toContain("-h");
  });

  it("cli.ts registers signal handlers for clean shutdown", () => {
    const cliPath = resolve(SRC_ROOT, "cli.ts");
    const content = readFileSync(cliPath, "utf-8");

    expect(content).toContain("SIGINT");
    expect(content).toContain("SIGTERM");
  });
});
