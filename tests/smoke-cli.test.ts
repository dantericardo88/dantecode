// ============================================================================
// tests/smoke-cli.test.ts
//
// External-validation smoke tests for the CLI binary.
// Spawns the compiled dist/index.js as a child process to prove behavior
// from outside the process boundary — not internal routing or mocking.
//
// Prerequisites: `npm run build` must run first.
// Turbo's `test → build` dependency chain guarantees this in CI.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, expect, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Resolve the CLI entry point relative to the repo root.
// process.cwd() is the repo root when vitest is invoked via `npx vitest run`.
// ---------------------------------------------------------------------------
const REPO_ROOT = resolve(process.cwd());
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "dist", "index.js");

// ---------------------------------------------------------------------------
// Helper: run `node <CLI_ENTRY> [args]` synchronously.
// spawnSync avoids all async/pipe timing issues on Windows.
// ---------------------------------------------------------------------------
function runCli(args: string[], cwd: string = REPO_ROOT) {
  return spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 15_000,
    env: {
      ...process.env,
      // Prevent interactive TTY prompts and suppress telemetry in CI
      CI: "1",
      NO_COLOR: "1",
    },
  });
}

// ---------------------------------------------------------------------------
// Temp dir management — hermetic stateful tests (init creates files).
// ---------------------------------------------------------------------------
let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI binary (external process validation)", () => {
  // -------------------------------------------------------------------------
  // 1. Build artifact exists — proves the build pipeline produced output
  // -------------------------------------------------------------------------
  it("dist/index.js exists and is non-empty", () => {
    expect(existsSync(CLI_ENTRY), `Expected ${CLI_ENTRY} to exist`).toBe(true);
    const content = readFileSync(CLI_ENTRY, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // 2. Shebang line — proves `npm link` / bin field will produce a runnable wrapper
  // -------------------------------------------------------------------------
  it("dist/index.js starts with #!/usr/bin/env node shebang", () => {
    const firstLine = readFileSync(CLI_ENTRY, "utf-8").split("\n")[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  // -------------------------------------------------------------------------
  // 3. --help exits with code 0 (binary launches and terminates cleanly)
  // -------------------------------------------------------------------------
  it("dantecode --help exits with code 0", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. --help output contains known stable strings
  //    Tolerant regex — won't break if banner text changes minor wording.
  // -------------------------------------------------------------------------
  it("dantecode --help output contains expected usage strings", () => {
    const result = runCli(["--help"]);
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    // USAGE and COMMANDS are structural section headers; init is a stable command name
    expect(output).toMatch(/usage/i);
    expect(output).toMatch(/commands/i);
    expect(output).toContain("init");
  });

  // -------------------------------------------------------------------------
  // 5. dantecode init creates .dantecode/STATE.yaml in cwd
  //    Stateful test — uses a fresh temp dir, cleaned up in afterEach.
  //    Proves the full initialization path runs without errors.
  // -------------------------------------------------------------------------
  it("dantecode init creates .dantecode/STATE.yaml in cwd", () => {
    tempDir = mkdtempSync(join(tmpdir(), "dantecode-smoke-"));

    const result = runCli(["init"], tempDir);

    // Command must succeed
    expect(result.status).toBe(0);

    // STATE.yaml must exist at the expected path
    const statePath = join(tempDir, ".dantecode", "STATE.yaml");
    expect(existsSync(statePath), `Expected ${statePath} to exist after init`).toBe(true);

    // File must contain the canonical projectRoot field
    const content = readFileSync(statePath, "utf-8");
    expect(content).toContain("projectRoot:");
  });
});
