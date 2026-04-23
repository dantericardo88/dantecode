// ============================================================================
// packages/cli/src/__tests__/auto-lint-gate.test.ts
//
// Unit tests for the auto-lint gate.
//
// Design rules:
//   - Zero live tsc calls — we mock node:child_process to control outcomes
//   - Every test exercises the real gate logic (routing, caching, formatting)
//   - Mocks are minimal: only execFile is intercepted
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLintRoundCache, runAutoLintGate } from "../auto-lint-gate.js";

// ---------------------------------------------------------------------------
// Mock node:child_process so we never invoke a real tsc binary
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
});

import { execFile } from "node:child_process";

type ExecFileCallback = (
  error: NodeJS.ErrnoException | null,
  stdout: string,
  stderr: string,
) => void;

/** Make execFile behave as if tsc succeeded (exit 0). */
function mockTscSuccess() {
  vi.mocked(execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      (cb as ExecFileCallback)(null, "", "");
      return { kill: vi.fn() } as unknown as ReturnType<typeof execFile>;
    },
  );
}

/** Make execFile behave as if tsc reported type errors (exit non-zero). */
function mockTscErrors(stderr: string, exitCode = 1) {
  vi.mocked(execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error(`tsc failed with exit code ${exitCode}`), {
        code: exitCode,
      });
      (cb as ExecFileCallback)(err as unknown as NodeJS.ErrnoException, "", stderr);
      return { kill: vi.fn() } as unknown as ReturnType<typeof execFile>;
    },
  );
}

/** Make execFile behave as if tsc is not installed (ENOENT). */
function mockTscNotFound() {
  vi.mocked(execFile).mockImplementation(
    (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const err = Object.assign(new Error("tsc not found"), { code: "ENOENT" });
      (cb as ExecFileCallback)(err as NodeJS.ErrnoException, "", "");
      return { kill: vi.fn() } as unknown as ReturnType<typeof execFile>;
    },
  );
}

// ---------------------------------------------------------------------------
// 1. File extension filtering
// ---------------------------------------------------------------------------

describe("auto-lint-gate — file extension filtering", () => {
  beforeEach(() => {
    mockTscSuccess();
  });

  it("returns skipped=true for a .js file", async () => {
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/foo.js", "/project", cache);
    expect(result.skipped).toBe(true);
    expect(result.hasErrors).toBe(false);
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
  });

  it("returns skipped=true for a .json file", async () => {
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/package.json", "/project", cache);
    expect(result.skipped).toBe(true);
  });

  it("returns skipped=false for a .ts file", async () => {
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/foo.ts", "/project", cache);
    expect(result.skipped).toBe(false);
  });

  it("returns skipped=false for a .tsx file", async () => {
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/Component.tsx", "/project", cache);
    expect(result.skipped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Round cache behavior
// ---------------------------------------------------------------------------

describe("auto-lint-gate — round cache", () => {
  beforeEach(() => {
    mockTscSuccess();
  });

  it("checks a file on the first call within a round", async () => {
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/app.ts", "/project", cache);
    expect(result.skipped).toBe(false);
    expect(vi.mocked(execFile)).toHaveBeenCalledOnce();
  });

  it("skips the same file on a second call within the same round", async () => {
    const cache = createLintRoundCache();
    await runAutoLintGate("/project/src/app.ts", "/project", cache);
    vi.mocked(execFile).mockClear();
    const result = await runAutoLintGate("/project/src/app.ts", "/project", cache);
    expect(result.skipped).toBe(true);
    expect(vi.mocked(execFile)).not.toHaveBeenCalled();
  });

  it("checks a different file even when one is cached", async () => {
    const cache = createLintRoundCache();
    await runAutoLintGate("/project/src/a.ts", "/project", cache);
    vi.mocked(execFile).mockClear();
    const result = await runAutoLintGate("/project/src/b.ts", "/project", cache);
    expect(result.skipped).toBe(false);
    expect(vi.mocked(execFile)).toHaveBeenCalledOnce();
  });

  it("createLintRoundCache returns a new empty Set each time", () => {
    const a = createLintRoundCache();
    const b = createLintRoundCache();
    expect(a).not.toBe(b);
    expect(a.size).toBe(0);
    expect(b.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Successful lint (no errors)
// ---------------------------------------------------------------------------

describe("auto-lint-gate — successful lint", () => {
  beforeEach(() => {
    mockTscSuccess();
  });

  it("returns hasErrors=false when tsc exits 0", async () => {
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/clean.ts", "/project", cache);
    expect(result.hasErrors).toBe(false);
    expect(result.formattedErrors).toBe("");
    expect(result.skipped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Type errors found
// ---------------------------------------------------------------------------

describe("auto-lint-gate — type errors", () => {
  it("returns hasErrors=true when tsc outputs errors", async () => {
    mockTscErrors("error TS2345: Argument of type 'string' is not assignable");
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/broken.ts", "/project", cache);
    expect(result.hasErrors).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it("formattedErrors starts with 'AUTO-LINT: '", async () => {
    mockTscErrors("error TS2345: something wrong");
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/broken.ts", "/project", cache);
    expect(result.formattedErrors.startsWith("AUTO-LINT: ")).toBe(true);
  });

  it("classifies TypeScript errors correctly", async () => {
    mockTscErrors("error TS2345: Argument of type 'number' is not assignable to type 'string'");
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/broken.ts", "/project", cache);
    expect(result.errorClass).toBe("TypescriptError");
  });

  it("truncates long error output to include '...(truncated)'", async () => {
    mockTscErrors("error TS2345: " + "x".repeat(3000));
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/broken.ts", "/project", cache);
    expect(result.formattedErrors).toContain("...(truncated)");
    // Should be significantly shorter than 3000 chars
    expect(result.formattedErrors.length).toBeLessThan(2200);
  });

  it("does not truncate error output under the limit", async () => {
    const shortError = "error TS2345: short problem";
    mockTscErrors(shortError);
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/broken.ts", "/project", cache);
    expect(result.formattedErrors).not.toContain("...(truncated)");
    expect(result.formattedErrors).toContain(shortError);
  });
});

// ---------------------------------------------------------------------------
// 5. tsc not installed / graceful degradation
// ---------------------------------------------------------------------------

describe("auto-lint-gate — graceful degradation", () => {
  it("returns skipped=true when tsc is not found in PATH", async () => {
    mockTscNotFound();
    const cache = createLintRoundCache();
    const result = await runAutoLintGate("/project/src/foo.ts", "/project", cache);
    expect(result.skipped).toBe(true);
    expect(result.hasErrors).toBe(false);
  });

  it("does not throw when tsc is not found", async () => {
    mockTscNotFound();
    const cache = createLintRoundCache();
    await expect(
      runAutoLintGate("/project/src/foo.ts", "/project", cache),
    ).resolves.not.toThrow();
  });
});
