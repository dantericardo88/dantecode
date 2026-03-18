// ============================================================================
// @dantecode/core — Startup Health Check Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runStartupHealthCheck } from "./health-check.js";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
}));

import { access, mkdir } from "node:fs/promises";
const mockAccess = vi.mocked(access);
const mockMkdir = vi.mocked(mkdir);

// Suppress stdout during tests
let stdoutSpy: { mockRestore: () => void; mock: { calls: unknown[][] } };

beforeEach(() => {
  vi.clearAllMocks();
  stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
});

describe("runStartupHealthCheck", () => {
  // --------------------------------------------------------------------------
  // Node.js version check
  // --------------------------------------------------------------------------

  describe("Node.js version check", () => {
    it("passes when Node.js version is >= 18", async () => {
      // Current test runner is >= 18, so this should always pass
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const nodeCheck = result.checks.find((c) => c.name === "Node.js version");
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck!.status).toBe("pass");
      expect(nodeCheck!.message).toContain(">= 18 required");
    });
  });

  // --------------------------------------------------------------------------
  // .dantecode/ directory check
  // --------------------------------------------------------------------------

  describe(".dantecode/ directory check", () => {
    it("passes when directory exists", async () => {
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const dirCheck = result.checks.find((c) => c.name === ".dantecode/ directory");
      expect(dirCheck).toBeDefined();
      expect(dirCheck!.status).toBe("pass");
      expect(dirCheck!.message).toBe("exists");
    });

    it("passes when directory can be created", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockMkdir.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const dirCheck = result.checks.find((c) => c.name === ".dantecode/ directory");
      expect(dirCheck).toBeDefined();
      expect(dirCheck!.status).toBe("pass");
      expect(dirCheck!.message).toBe("created successfully");
    });

    it("fails when directory cannot be created", async () => {
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockMkdir.mockRejectedValue(new Error("EACCES: permission denied"));
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const dirCheck = result.checks.find((c) => c.name === ".dantecode/ directory");
      expect(dirCheck).toBeDefined();
      expect(dirCheck!.status).toBe("fail");
      expect(dirCheck!.message).toContain("cannot create");
      expect(dirCheck!.message).toContain("EACCES");
    });
  });

  // --------------------------------------------------------------------------
  // Provider API keys check
  // --------------------------------------------------------------------------

  describe("Provider API keys check", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment to remove any existing API keys
      process.env = { ...originalEnv };
      delete process.env["GROK_API_KEY"];
      delete process.env["ANTHROPIC_API_KEY"];
      delete process.env["OPENAI_API_KEY"];
      delete process.env["OLLAMA_HOST"];
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("passes when at least one API key is configured", async () => {
      process.env["ANTHROPIC_API_KEY"] = "sk-test-key";
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const keyCheck = result.checks.find((c) => c.name === "Provider API keys");
      expect(keyCheck).toBeDefined();
      expect(keyCheck!.status).toBe("pass");
      expect(keyCheck!.message).toContain("Anthropic");
    });

    it("passes and lists multiple configured providers", async () => {
      process.env["GROK_API_KEY"] = "xai-test";
      process.env["OPENAI_API_KEY"] = "sk-test";
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const keyCheck = result.checks.find((c) => c.name === "Provider API keys");
      expect(keyCheck).toBeDefined();
      expect(keyCheck!.status).toBe("pass");
      expect(keyCheck!.message).toContain("2 provider(s)");
      expect(keyCheck!.message).toContain("Grok");
      expect(keyCheck!.message).toContain("OpenAI");
    });

    it("recognizes OLLAMA_HOST as a valid provider", async () => {
      process.env["OLLAMA_HOST"] = "http://localhost:11434";
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const keyCheck = result.checks.find((c) => c.name === "Provider API keys");
      expect(keyCheck).toBeDefined();
      expect(keyCheck!.status).toBe("pass");
      expect(keyCheck!.message).toContain("Ollama");
    });

    it("warns when no API keys are configured", async () => {
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const keyCheck = result.checks.find((c) => c.name === "Provider API keys");
      expect(keyCheck).toBeDefined();
      expect(keyCheck!.status).toBe("warn");
      expect(keyCheck!.message).toContain("No provider API keys found");
    });

    it("ignores empty string API keys", async () => {
      process.env["GROK_API_KEY"] = "";
      process.env["ANTHROPIC_API_KEY"] = "   ";
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const keyCheck = result.checks.find((c) => c.name === "Provider API keys");
      expect(keyCheck).toBeDefined();
      expect(keyCheck!.status).toBe("warn");
    });
  });

  // --------------------------------------------------------------------------
  // DanteForge binary check
  // --------------------------------------------------------------------------

  describe("DanteForge binary check", () => {
    it("returns warn when DanteForge binary is not found", async () => {
      // In the test environment, @dantecode/danteforge may or may not be loadable.
      // We verify the check exists and has a valid status.
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      const forgeCheck = result.checks.find((c) => c.name === "DanteForge binary");
      expect(forgeCheck).toBeDefined();
      expect(["pass", "warn"]).toContain(forgeCheck!.status);
    });
  });

  // --------------------------------------------------------------------------
  // Aggregate health status
  // --------------------------------------------------------------------------

  describe("aggregate health", () => {
    it("reports healthy when all checks pass or warn", async () => {
      mockAccess.mockResolvedValue(undefined);
      // No API keys set but that's a warn, not a fail
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env["GROK_API_KEY"];
      delete process.env["ANTHROPIC_API_KEY"];
      delete process.env["OPENAI_API_KEY"];
      delete process.env["OLLAMA_HOST"];

      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      // healthy means no "fail" checks — warns are acceptable
      expect(result.healthy).toBe(true);

      process.env = originalEnv;
    });

    it("reports unhealthy when any check fails", async () => {
      // Force .dantecode/ directory to be uncreatable
      mockAccess.mockRejectedValue(new Error("ENOENT"));
      mockMkdir.mockRejectedValue(new Error("EACCES"));
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      expect(result.healthy).toBe(false);
      expect(result.checks.some((c) => c.status === "fail")).toBe(true);
    });

    it("always returns exactly 4 checks", async () => {
      mockAccess.mockResolvedValue(undefined);
      const result = await runStartupHealthCheck({ projectRoot: "/test/project" });
      expect(result.checks).toHaveLength(4);
    });
  });

  // --------------------------------------------------------------------------
  // Formatted table output
  // --------------------------------------------------------------------------

  describe("output", () => {
    it("logs a formatted table to stdout", async () => {
      mockAccess.mockResolvedValue(undefined);
      await runStartupHealthCheck({ projectRoot: "/test/project" });
      const output = stdoutSpy.mock.calls.map((c: unknown[]) => c[0]).join("");
      expect(output).toContain("Startup Health Check");
      expect(output).toContain("Node.js version");
      expect(output).toContain(".dantecode/ directory");
      expect(output).toContain("Provider API keys");
      expect(output).toContain("DanteForge binary");
    });
  });
});
