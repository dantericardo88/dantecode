// packages/cli/src/__tests__/sprint-dim40-config.test.ts
// Dim 40 — Configuration ergonomics
// Tests: validateDantecodeConfig, applyConfigDefaults, migrateConfig,
//        getConfigValue, setConfigValue, cmdConfig (validate subcommand)

import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateDantecodeConfig,
  applyConfigDefaults,
  migrateConfig,
  DEFAULT_DANTECODE_CONFIG,
  type DantecodeConfig,
} from "@dantecode/core";
import { getConfigValue, setConfigValue, cmdConfig, readProjectConfig, writeProjectConfig } from "../commands/config.js";

// ── validateDantecodeConfig ───────────────────────────────────────────────────

describe("validateDantecodeConfig", () => {
  const validConfig: DantecodeConfig = {
    version: "1.0.0",
    provider: { id: "anthropic", model: "claude-sonnet-4-6", apiKey: "sk-ant-test123" },
    features: { fim: true, browserPreview: false, autonomy: false },
    ui: { theme: "auto", statusBar: true },
  };

  it("passes for a fully valid config", () => {
    const result = validateDantecodeConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("errors when provider.id is invalid", () => {
    const bad = { ...validConfig, provider: { ...validConfig.provider, id: "cohere" as DantecodeConfig["provider"]["id"] } };
    const result = validateDantecodeConfig(bad);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.field === "provider.id");
    expect(err).toBeDefined();
    expect(err!.message).toContain("cohere");
  });

  it("errors when apiKey is missing for anthropic", () => {
    const bad = { ...validConfig, provider: { ...validConfig.provider, apiKey: "" } };
    const result = validateDantecodeConfig(bad);
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.field === "provider.apiKey");
    expect(err).toBeDefined();
  });

  it("fix string contains 'dantecode config set'", () => {
    const bad = { ...validConfig, provider: { ...validConfig.provider, apiKey: "" } };
    const result = validateDantecodeConfig(bad);
    const err = result.errors.find((e) => e.field === "provider.apiKey");
    expect(err!.fix).toContain("dantecode config set");
  });

  it("does NOT error when apiKey is missing for ollama", () => {
    const ollamaConfig: DantecodeConfig = {
      ...validConfig,
      provider: { id: "ollama", model: "llama3", apiKey: "" },
    };
    const result = validateDantecodeConfig(ollamaConfig);
    expect(result.errors.find((e) => e.field === "provider.apiKey")).toBeUndefined();
  });

  it("errors when version is missing", () => {
    const bad = { ...validConfig, version: "" };
    const result = validateDantecodeConfig(bad);
    expect(result.errors.find((e) => e.field === "version")).toBeDefined();
  });

  it("errors when provider.model is empty", () => {
    const bad = { ...validConfig, provider: { ...validConfig.provider, model: "" } };
    const result = validateDantecodeConfig(bad);
    expect(result.errors.find((e) => e.field === "provider.model")).toBeDefined();
  });

  it("errors when baseUrl is an invalid URL", () => {
    const bad = { ...validConfig, provider: { ...validConfig.provider, baseUrl: "not-a-url" } };
    const result = validateDantecodeConfig(bad);
    expect(result.errors.find((e) => e.field === "provider.baseUrl")).toBeDefined();
  });

  it("passes when baseUrl is a valid https URL", () => {
    const good = { ...validConfig, provider: { ...validConfig.provider, baseUrl: "https://api.example.com" } };
    const result = validateDantecodeConfig(good);
    expect(result.errors.find((e) => e.field === "provider.baseUrl")).toBeUndefined();
  });

  it("warns for unknown ui.theme but does not error", () => {
    const bad = { ...validConfig, ui: { theme: "neon" as NonNullable<DantecodeConfig["ui"]>["theme"], statusBar: true } };
    const result = validateDantecodeConfig(bad);
    expect(result.errors.find((e) => e.field === "ui.theme")).toBeUndefined();
    expect(result.warnings.find((w) => w.field === "ui.theme")).toBeDefined();
  });

  it("errors on non-object input", () => {
    const result = validateDantecodeConfig("string input");
    expect(result.valid).toBe(false);
    expect(result.errors[0]!.field).toBe("root");
  });
});

// ── applyConfigDefaults ───────────────────────────────────────────────────────

describe("applyConfigDefaults", () => {
  it("fills in all missing fields from empty object", () => {
    const config = applyConfigDefaults({});
    expect(config.version).toBe("1.0.0");
    expect(config.provider.id).toBe("anthropic");
    expect(config.provider.model).toBe("claude-sonnet-4-6");
    expect(config.features).toBeDefined();
    expect(config.ui).toBeDefined();
  });

  it("preserves provided provider.id if valid", () => {
    const config = applyConfigDefaults({ provider: { id: "openai", model: "gpt-4" } });
    expect(config.provider.id).toBe("openai");
    expect(config.provider.model).toBe("gpt-4");
  });

  it("defaults fim to true", () => {
    const config = applyConfigDefaults({});
    expect(config.features!.fim).toBe(true);
  });

  it("defaults browserPreview to false", () => {
    const config = applyConfigDefaults({});
    expect(config.features!.browserPreview).toBe(false);
  });

  it("defaults ui.theme to 'auto'", () => {
    const config = applyConfigDefaults({});
    expect(config.ui!.theme).toBe("auto");
  });

  it("defaults statusBar to true", () => {
    const config = applyConfigDefaults({});
    expect(config.ui!.statusBar).toBe(true);
  });
});

// ── migrateConfig ─────────────────────────────────────────────────────────────

describe("migrateConfig", () => {
  it("returns version '1.0.0' when migrating from '0.x'", () => {
    const config = migrateConfig({ apiProvider: "anthropic", apiModelId: "claude-3", apiKey: "sk-ant" }, "0.5.0");
    expect(config.version).toBe("1.0.0");
  });

  it("maps legacy apiProvider to provider.id", () => {
    const config = migrateConfig({ apiProvider: "openai", apiModelId: "gpt-4", apiKey: "sk-open" }, "0.3.0");
    expect(config.provider.id).toBe("openai");
  });

  it("maps legacy apiModelId to provider.model", () => {
    const config = migrateConfig({ apiProvider: "anthropic", apiModelId: "claude-opus", apiKey: "sk-ant" }, "0.2.0");
    expect(config.provider.model).toBe("claude-opus");
  });

  it("maps legacy apiKey to provider.apiKey", () => {
    const config = migrateConfig({ apiProvider: "anthropic", apiModelId: "claude-3", apiKey: "sk-ant-legacy" }, "0.1.0");
    expect(config.provider.apiKey).toBe("sk-ant-legacy");
  });

  it("preserves features through migration", () => {
    const config = migrateConfig({ apiProvider: "anthropic", apiModelId: "claude-3", apiKey: "sk-ant" }, "0.5.0");
    expect(config.features).toBeDefined();
    expect(typeof config.features!.fim).toBe("boolean");
  });

  it("returns full valid config structure after migration", () => {
    const config = migrateConfig({ apiProvider: "anthropic", apiModelId: "claude-3", apiKey: "sk" }, "0.x");
    const result = validateDantecodeConfig(config);
    expect(result.errors.filter((e) => e.field !== "provider.apiKey")).toHaveLength(0);
  });
});

// ── getConfigValue ────────────────────────────────────────────────────────────

describe("getConfigValue", () => {
  const config: DantecodeConfig = DEFAULT_DANTECODE_CONFIG;

  it("resolves dotted path 'provider.model'", () => {
    expect(getConfigValue(config, "provider.model")).toBe("claude-sonnet-4-6");
  });

  it("resolves 'provider.id'", () => {
    expect(getConfigValue(config, "provider.id")).toBe("anthropic");
  });

  it("returns undefined for missing path", () => {
    expect(getConfigValue(config, "provider.nonExistentKey")).toBeUndefined();
  });

  it("returns undefined for deeply missing path", () => {
    expect(getConfigValue(config, "a.b.c.d")).toBeUndefined();
  });

  it("resolves top-level 'version'", () => {
    expect(getConfigValue(config, "version")).toBe("1.0.0");
  });
});

// ── setConfigValue ────────────────────────────────────────────────────────────

describe("setConfigValue", () => {
  const config: DantecodeConfig = DEFAULT_DANTECODE_CONFIG;

  it("updates nested value and returns new config", () => {
    const updated = setConfigValue(config, "provider.model", "claude-opus-4-7");
    expect(updated.provider.model).toBe("claude-opus-4-7");
  });

  it("does not mutate the original config", () => {
    const original = JSON.stringify(config);
    setConfigValue(config, "provider.model", "new-model");
    expect(JSON.stringify(config)).toBe(original);
  });

  it("coerces 'true' string to boolean true", () => {
    const updated = setConfigValue(config, "features.fim", "true");
    expect(updated.features!.fim).toBe(true);
  });

  it("coerces 'false' string to boolean false", () => {
    const updated = setConfigValue(config, "features.browserPreview", "false");
    expect(updated.features!.browserPreview).toBe(false);
  });

  it("sets top-level version", () => {
    const updated = setConfigValue(config, "version", "2.0.0");
    expect(updated.version).toBe("2.0.0");
  });
});

// ── cmdConfig validate integration ───────────────────────────────────────────

describe("cmdConfig validate", () => {
  let tmpDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("prints no errors for a valid config", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim40-cfg-"));
    mkdirSync(join(tmpDir, ".dantecode"), { recursive: true });
    const validConfig: DantecodeConfig = {
      version: "1.0.0",
      provider: { id: "anthropic", model: "claude-sonnet-4-6", apiKey: "sk-ant-valid123" },
      features: { fim: true, browserPreview: false, autonomy: false },
      ui: { theme: "auto", statusBar: true },
    };
    writeFileSync(join(tmpDir, ".dantecode", "config.json"), JSON.stringify(validConfig));
    const consoleSpy = vi.spyOn(console, "log");
    await cmdConfig(["validate"], tmpDir);
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("valid");
    expect(output).not.toContain("error");
  });

  it("readProjectConfig returns defaults when config.json missing", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim40-cfg-"));
    const config = await readProjectConfig(tmpDir);
    expect(config.provider.id).toBe("anthropic");
    expect(config.version).toBe("1.0.0");
  });

  it("writeProjectConfig then readProjectConfig round-trips correctly", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim40-cfg-"));
    const original: DantecodeConfig = {
      version: "1.0.0",
      provider: { id: "openai", model: "gpt-4", apiKey: "sk-open-abc" },
      features: { fim: false, browserPreview: true, autonomy: false },
      ui: { theme: "dark", statusBar: false },
    };
    await writeProjectConfig(original, tmpDir);
    const loaded = await readProjectConfig(tmpDir);
    expect(loaded.provider.id).toBe("openai");
    expect(loaded.ui!.theme).toBe("dark");
    expect(loaded.features!.browserPreview).toBe(true);
  });
});
