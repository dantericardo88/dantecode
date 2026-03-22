// ============================================================================
// @dantecode/cli — Init Command Tests
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockExecFileSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  };
});

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<object>("../../../core/src/index.ts");
  return actual;
});

import {
  runInitCommand,
  scanForApiKeys,
  isOllamaAvailable,
  PROVIDER_ENV_MAP,
  PROVIDER_DEFAULTS,
} from "./init.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function touch(root: string, relativePath: string, content = ""): void {
  const fullPath = join(root, relativePath);
  const dir = fullPath.replace(/[\\/][^\\/]+$/, "");
  mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

function writePkg(root: string, deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): void {
  const pkg = { name: "test-project", dependencies: deps, devDependencies: devDeps };
  touch(root, "package.json", JSON.stringify(pkg, null, 2));
}

// ─── Setup / Teardown ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stdoutSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let stderrSpy: any;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  mockExecFileSync.mockReset();
  stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  originalEnv = { ...process.env };
  // Clear all provider env vars to start clean
  for (const envVars of Object.values(PROVIDER_ENV_MAP)) {
    for (const envVar of envVars) {
      delete process.env[envVar];
    }
  }
  process.exitCode = undefined;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  process.env = originalEnv;
  process.exitCode = undefined;
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── scanForApiKeys ──────────────────────────────────────────────────────────

describe("scanForApiKeys", () => {
  it("returns empty array when no API keys are set", () => {
    const keys = scanForApiKeys();
    expect(keys).toHaveLength(0);
  });

  it("detects a single API key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    const keys = scanForApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]![0]).toBe("anthropic");
    expect(keys[0]![1]).toBe("ANTHROPIC_API_KEY");
  });

  it("detects multiple API keys", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    process.env.OPENAI_API_KEY = "sk-openai-456";
    const keys = scanForApiKeys();
    expect(keys.length).toBeGreaterThanOrEqual(2);
    const providers = keys.map(([p]) => p);
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
  });

  it("detects grok via XAI_API_KEY", () => {
    process.env.XAI_API_KEY = "xai-test";
    const keys = scanForApiKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]![0]).toBe("grok");
  });

  it("counts each provider only once even with multiple env vars", () => {
    process.env.XAI_API_KEY = "xai-test";
    process.env.GROK_API_KEY = "grok-test";
    const keys = scanForApiKeys();
    const grokEntries = keys.filter(([p]) => p === "grok");
    expect(grokEntries).toHaveLength(1);
  });
});

// ─── isOllamaAvailable ──────────────────────────────────────────────────────

describe("isOllamaAvailable", () => {
  it("returns true when ollama is found on PATH", () => {
    mockExecFileSync.mockReturnValue(Buffer.from("/usr/local/bin/ollama\n"));
    expect(isOllamaAvailable()).toBe(true);
  });

  it("returns false when ollama is not found", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(isOllamaAvailable()).toBe(false);
  });
});

// ─── runInitCommand ──────────────────────────────────────────────────────────

describe("runInitCommand", () => {
  it("exits with code 1 and prints setup instructions when no API keys found and no ollama", async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
    const root = makeTempRoot("dantecode-init-nokey-");

    await runInitCommand(root, false);

    expect(process.exitCode).toBe(1);
    const stderrOutput = stderrSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stderrOutput).toContain("No API keys found");
    expect(stderrOutput).toContain("ANTHROPIC_API_KEY");
  });

  it("auto-selects single detected API key provider", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    const root = makeTempRoot("dantecode-init-single-");

    await runInitCommand(root, false);

    const stdoutOutput = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stdoutOutput).toContain("Found anthropic API key");
    expect(stdoutOutput).toContain("claude-sonnet-4-20250514");
    // STATE.yaml should be created
    expect(existsSync(join(root, ".dantecode", "STATE.yaml"))).toBe(true);
  });

  it("force mode uses first detected provider when multiple keys present", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-123";
    process.env.OPENAI_API_KEY = "sk-openai-456";
    const root = makeTempRoot("dantecode-init-force-");

    await runInitCommand(root, true);

    const stdoutOutput = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stdoutOutput).toContain("Force mode");
    expect(existsSync(join(root, ".dantecode", "STATE.yaml"))).toBe(true);
  });

  it("uses ollama when no API keys but ollama is available", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from("/usr/local/bin/ollama\n"));
    const root = makeTempRoot("dantecode-init-ollama-");

    await runInitCommand(root, false);

    const stdoutOutput = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stdoutOutput).toContain("ollama detected on PATH");
    expect(stdoutOutput).toContain("llama3.2");
    expect(existsSync(join(root, ".dantecode", "STATE.yaml"))).toBe(true);
  });

  it("detects TypeScript project and reports it", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const root = makeTempRoot("dantecode-init-ts-");
    touch(root, "tsconfig.json", "{}");
    writePkg(root, {}, { vitest: "3.0.0" });

    await runInitCommand(root, false);

    const stdoutOutput = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stdoutOutput).toContain("typescript");
    expect(stdoutOutput).toContain("Detected project language");
  });

  it("detects Python project and applies Python GStack", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const root = makeTempRoot("dantecode-init-py-");
    touch(root, "requirements.txt", "flask==2.0\n");

    await runInitCommand(root, false);

    expect(existsSync(join(root, ".dantecode", "STATE.yaml"))).toBe(true);
    const yaml = readFileSync(join(root, ".dantecode", "STATE.yaml"), "utf-8");
    expect(yaml).toContain("pytest");
  });

  it("writes STATE.yaml with correct provider settings", async () => {
    process.env.OPENAI_API_KEY = "sk-openai-test";
    const root = makeTempRoot("dantecode-init-provider-");

    await runInitCommand(root, false);

    const yaml = readFileSync(join(root, ".dantecode", "STATE.yaml"), "utf-8");
    expect(yaml).toContain("openai");
    expect(yaml).toContain("gpt-4o");
  });

  it("creates directory structure (skills, agents, AGENTS.dc.md, .gitignore)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const root = makeTempRoot("dantecode-init-dirs-");

    await runInitCommand(root, false);

    expect(existsSync(join(root, ".dantecode", "skills"))).toBe(true);
    expect(existsSync(join(root, ".dantecode", "agents"))).toBe(true);
    expect(existsSync(join(root, ".dantecode", "AGENTS.dc.md"))).toBe(true);
    expect(existsSync(join(root, ".dantecode", ".gitignore"))).toBe(true);
  });

  it("skips STATE.yaml when already exists and force is false", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const root = makeTempRoot("dantecode-init-skip-");

    // First init
    await runInitCommand(root, false);
    // Modify the YAML to verify it's not overwritten
    const yamlPath = join(root, ".dantecode", "STATE.yaml");
    const original = readFileSync(yamlPath, "utf-8");

    // Reset spies
    stdoutSpy.mockClear();

    // Second init without force
    await runInitCommand(root, false);

    const stdoutOutput = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stdoutOutput).toContain("already exists");
    // STATE.yaml should not change
    const after = readFileSync(yamlPath, "utf-8");
    expect(after).toBe(original);
  });

  it("overwrites STATE.yaml when force is true", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const root = makeTempRoot("dantecode-init-overwrite-");
    touch(root, "tsconfig.json", "{}");
    writePkg(root, {}, { vitest: "3.0.0" });

    // First init
    await runInitCommand(root, false);

    // Switch provider
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai";

    // Second init with force
    await runInitCommand(root, true);

    const yaml = readFileSync(join(root, ".dantecode", "STATE.yaml"), "utf-8");
    expect(yaml).toContain("openai");
    expect(yaml).toContain("gpt-4o");
  });

  it("prints success message on completion", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const root = makeTempRoot("dantecode-init-success-");

    await runInitCommand(root, false);

    const stdoutOutput = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
    expect(stdoutOutput).toContain("DanteCode initialized");
    expect(stdoutOutput).toContain("dantecode");
  });
});

// ─── PROVIDER_DEFAULTS ───────────────────────────────────────────────────────

describe("PROVIDER_DEFAULTS", () => {
  it("has entries for all expected providers", () => {
    expect(PROVIDER_DEFAULTS).toHaveProperty("anthropic");
    expect(PROVIDER_DEFAULTS).toHaveProperty("grok");
    expect(PROVIDER_DEFAULTS).toHaveProperty("openai");
    expect(PROVIDER_DEFAULTS).toHaveProperty("google");
    expect(PROVIDER_DEFAULTS).toHaveProperty("groq");
    expect(PROVIDER_DEFAULTS).toHaveProperty("ollama");
  });

  it("each provider has modelId and contextWindow", () => {
    for (const [, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
      expect(defaults.modelId).toBeTruthy();
      expect(defaults.contextWindow).toBeGreaterThan(0);
    }
  });
});
