// ============================================================================
// @dantecode/core — Version Migration Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  v0_to_v1,
  detectConfigVersion,
  runMigrations,
  LATEST_CONFIG_VERSION,
} from "./version-migration.js";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock yaml
vi.mock("yaml", () => ({
  default: {
    parse: vi.fn(),
    stringify: vi.fn(),
  },
}));

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import YAML from "yaml";
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockRename = vi.mocked(rename);
const mockMkdir = vi.mocked(mkdir);
const mockYAMLParse = vi.mocked(YAML.parse);
const mockYAMLStringify = vi.mocked(YAML.stringify);

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockYAMLStringify.mockReturnValue("yaml-output");
});

// ----------------------------------------------------------------------------
// detectConfigVersion
// ----------------------------------------------------------------------------

describe("detectConfigVersion", () => {
  it("returns 0 when configVersion is missing", () => {
    expect(detectConfigVersion({ version: "1.0.0" })).toBe(0);
  });

  it("returns 0 when configVersion is not a number", () => {
    expect(detectConfigVersion({ configVersion: "1" })).toBe(0);
  });

  it("returns the configVersion when present", () => {
    expect(detectConfigVersion({ configVersion: 1 })).toBe(1);
    expect(detectConfigVersion({ configVersion: 2 })).toBe(2);
  });

  it("returns 0 for NaN or Infinity", () => {
    expect(detectConfigVersion({ configVersion: NaN })).toBe(0);
    expect(detectConfigVersion({ configVersion: Infinity })).toBe(0);
  });
});

// ----------------------------------------------------------------------------
// v0_to_v1 migration
// ----------------------------------------------------------------------------

describe("v0_to_v1", () => {
  it("adds configVersion: 1", () => {
    const input = { version: "1.0.0", projectRoot: "/test" };
    const result = v0_to_v1(input);
    expect(result["configVersion"]).toBe(1);
  });

  it("is idempotent — running twice produces the same result", () => {
    const input = { version: "1.0.0", projectRoot: "/test" };
    const first = v0_to_v1(input);
    const second = v0_to_v1(first);
    expect(second).toEqual(first);
  });

  it("normalizes known legacy model names in default model", () => {
    const input = {
      version: "1.0.0",
      model: {
        default: { provider: "anthropic", modelId: "claude-3.5-sonnet", maxTokens: 8192 },
        fallback: [],
        taskOverrides: {},
      },
    };
    const result = v0_to_v1(input);
    const model = result["model"] as Record<string, unknown>;
    const defaultModel = model["default"] as Record<string, unknown>;
    expect(defaultModel["modelId"]).toBe("claude-sonnet-4-20250514");
  });

  it("normalizes legacy model names in fallback models", () => {
    const input = {
      version: "1.0.0",
      model: {
        default: { provider: "grok", modelId: "grok-3", maxTokens: 8192 },
        fallback: [
          { provider: "openai", modelId: "gpt-4o", maxTokens: 8192 },
          { provider: "anthropic", modelId: "claude-3-opus", maxTokens: 8192 },
        ],
        taskOverrides: {},
      },
    };
    const result = v0_to_v1(input);
    const model = result["model"] as Record<string, unknown>;
    const fallback = model["fallback"] as Array<Record<string, unknown>>;
    expect(fallback[0]!["modelId"]).toBe("gpt-4o-2024-08-06");
    expect(fallback[1]!["modelId"]).toBe("claude-opus-4-20250514");
  });

  it("normalizes legacy model names in task overrides", () => {
    const input = {
      version: "1.0.0",
      model: {
        default: { provider: "grok", modelId: "grok-3", maxTokens: 8192 },
        fallback: [],
        taskOverrides: {
          architect: { provider: "openai", modelId: "gpt4", maxTokens: 8192 },
        },
      },
    };
    const result = v0_to_v1(input);
    const model = result["model"] as Record<string, unknown>;
    const overrides = model["taskOverrides"] as Record<string, Record<string, unknown>>;
    expect(overrides["architect"]!["modelId"]).toBe("gpt-4-turbo-2024-04-09");
  });

  it("preserves model names that do not need normalization", () => {
    const input = {
      version: "1.0.0",
      model: {
        default: { provider: "grok", modelId: "grok-3", maxTokens: 8192 },
        fallback: [],
        taskOverrides: {},
      },
    };
    const result = v0_to_v1(input);
    const model = result["model"] as Record<string, unknown>;
    const defaultModel = model["default"] as Record<string, unknown>;
    expect(defaultModel["modelId"]).toBe("grok-3");
  });

  it("handles missing model section gracefully", () => {
    const input = { version: "1.0.0" };
    const result = v0_to_v1(input);
    expect(result["configVersion"]).toBe(1);
    expect(result["model"]).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// runMigrations
// ----------------------------------------------------------------------------

describe("runMigrations", () => {
  it("returns early when STATE.yaml does not exist", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const result = await runMigrations("/test/project");
    expect(result.migrated).toBe(false);
    expect(result.results).toHaveLength(0);
    expect(result.finalVersion).toBe(0);
  });

  it("returns early when STATE.yaml contains invalid YAML", async () => {
    mockReadFile.mockResolvedValue("yaml-content" as never);
    mockYAMLParse.mockImplementation(() => {
      throw new Error("Invalid YAML");
    });
    const result = await runMigrations("/test/project");
    expect(result.migrated).toBe(false);
    expect(result.results[0]!.applied).toBe(false);
    expect(result.results[0]!.message).toContain("invalid YAML");
  });

  it("returns early when STATE.yaml root is not an object", async () => {
    mockReadFile.mockResolvedValue("yaml-content" as never);
    mockYAMLParse.mockReturnValue(null);
    const result = await runMigrations("/test/project");
    expect(result.migrated).toBe(false);
    expect(result.results[0]!.message).toContain("not an object");
  });

  it("skips migration when already at latest version", async () => {
    mockReadFile.mockResolvedValue("yaml-content" as never);
    mockYAMLParse.mockReturnValue({ configVersion: LATEST_CONFIG_VERSION, version: "1.0.0" });
    const result = await runMigrations("/test/project");
    expect(result.migrated).toBe(false);
    expect(result.finalVersion).toBe(LATEST_CONFIG_VERSION);
    expect(result.results).toHaveLength(0);
  });

  it("applies v0->v1 migration when configVersion is missing", async () => {
    mockReadFile.mockResolvedValue("yaml-content" as never);
    mockYAMLParse.mockReturnValue({
      version: "1.0.0",
      model: {
        default: { provider: "grok", modelId: "grok3", maxTokens: 8192 },
        fallback: [],
        taskOverrides: {},
      },
    });

    const result = await runMigrations("/test/project");
    expect(result.migrated).toBe(true);
    expect(result.finalVersion).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.applied).toBe(true);
    expect(result.results[0]!.fromVersion).toBe(0);
    expect(result.results[0]!.toVersion).toBe(1);
  });

  it("writes the migrated YAML atomically (tmp + rename)", async () => {
    mockReadFile.mockResolvedValue("yaml-content" as never);
    mockYAMLParse.mockReturnValue({ version: "1.0.0" });

    await runMigrations("/test/project");

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("STATE.yaml.tmp"),
      "yaml-output",
      "utf-8",
    );
    expect(mockRename).toHaveBeenCalledWith(
      expect.stringContaining("STATE.yaml.tmp"),
      expect.stringContaining("STATE.yaml"),
    );
  });

  it("creates .dantecode directory if needed before writing", async () => {
    mockReadFile.mockResolvedValue("yaml-content" as never);
    mockYAMLParse.mockReturnValue({ version: "1.0.0" });

    await runMigrations("/test/project");

    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining(".dantecode"), {
      recursive: true,
    });
  });
});
