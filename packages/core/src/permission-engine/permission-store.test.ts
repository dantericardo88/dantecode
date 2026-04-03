import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  loadPermissionConfig,
  savePermissionConfig,
  normalizeConfigFile,
  mergePermissionRules,
  DEFAULT_PERMISSION_CONFIG,
} from "./permission-store.js";
import { parseRule } from "./rule-parser.js";

describe("permission-store", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `permission-store-test-${randomUUID()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("DEFAULT_PERMISSION_CONFIG", () => {
    it("has empty rules and ask default", () => {
      expect(DEFAULT_PERMISSION_CONFIG.rules).toEqual([]);
      expect(DEFAULT_PERMISSION_CONFIG.defaultDecision).toBe("ask");
    });
  });

  describe("loadPermissionConfig", () => {
    it("returns default config when no file exists", () => {
      const config = loadPermissionConfig(testDir);
      expect(config.rules).toEqual([]);
      expect(config.defaultDecision).toBe("ask");
    });

    it("loads config from .dantecode/permissions.json", () => {
      const configDir = join(testDir, ".dantecode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "permissions.json"),
        JSON.stringify({
          rules: ["allow Bash npm *", "deny Write /etc/*"],
          defaultDecision: "deny",
        }),
      );

      const config = loadPermissionConfig(testDir);
      expect(config.rules).toHaveLength(2);
      expect(config.rules[0]!.decision).toBe("allow");
      expect(config.rules[0]!.toolName).toBe("Bash");
      expect(config.rules[1]!.decision).toBe("deny");
      expect(config.rules[1]!.toolName).toBe("Write");
      expect(config.defaultDecision).toBe("deny");
    });

    it("loads config with only rules (defaultDecision defaults to ask)", () => {
      const configDir = join(testDir, ".dantecode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "permissions.json"),
        JSON.stringify({ rules: ["allow Bash *"] }),
      );

      const config = loadPermissionConfig(testDir);
      expect(config.rules).toHaveLength(1);
      expect(config.defaultDecision).toBe("ask");
    });

    it("loads empty config (no rules field)", () => {
      const configDir = join(testDir, ".dantecode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, "permissions.json"),
        JSON.stringify({ defaultDecision: "allow" }),
      );

      const config = loadPermissionConfig(testDir);
      expect(config.rules).toEqual([]);
      expect(config.defaultDecision).toBe("allow");
    });

    it("throws on invalid JSON", () => {
      const configDir = join(testDir, ".dantecode");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "permissions.json"), "not valid json{{{");

      expect(() => loadPermissionConfig(testDir)).toThrow();
    });
  });

  describe("savePermissionConfig", () => {
    it("saves config to .dantecode/permissions.json", () => {
      const config = {
        rules: [parseRule("allow Bash npm *"), parseRule("deny Write /etc/*")],
        defaultDecision: "deny" as const,
      };

      savePermissionConfig(testDir, config);

      const configPath = join(testDir, ".dantecode", "permissions.json");
      expect(existsSync(configPath)).toBe(true);

      const loaded = loadPermissionConfig(testDir);
      expect(loaded.rules).toHaveLength(2);
      expect(loaded.defaultDecision).toBe("deny");
    });

    it("creates .dantecode directory if it does not exist", () => {
      const config = { rules: [], defaultDecision: "allow" as const };
      savePermissionConfig(testDir, config);

      expect(existsSync(join(testDir, ".dantecode"))).toBe(true);
      expect(existsSync(join(testDir, ".dantecode", "permissions.json"))).toBe(true);
    });

    it("overwrites existing config", () => {
      const config1 = {
        rules: [parseRule("allow Bash *")],
        defaultDecision: "ask" as const,
      };
      savePermissionConfig(testDir, config1);

      const config2 = {
        rules: [parseRule("deny Bash rm *")],
        defaultDecision: "deny" as const,
      };
      savePermissionConfig(testDir, config2);

      const loaded = loadPermissionConfig(testDir);
      expect(loaded.rules).toHaveLength(1);
      expect(loaded.rules[0]!.decision).toBe("deny");
      expect(loaded.defaultDecision).toBe("deny");
    });
  });

  describe("normalizeConfigFile", () => {
    it("normalizes a complete config file", () => {
      const config = normalizeConfigFile({
        rules: ["allow Bash git *", "deny Write /etc/*"],
        defaultDecision: "deny",
      });
      expect(config.rules).toHaveLength(2);
      expect(config.defaultDecision).toBe("deny");
    });

    it("defaults missing fields", () => {
      const config = normalizeConfigFile({});
      expect(config.rules).toEqual([]);
      expect(config.defaultDecision).toBe("ask");
    });

    it("handles empty rules array", () => {
      const config = normalizeConfigFile({ rules: [] });
      expect(config.rules).toEqual([]);
    });
  });

  describe("mergePermissionRules", () => {
    it("appends new rules to existing config", () => {
      const existing = {
        rules: [parseRule("allow Bash *")],
        defaultDecision: "ask" as const,
      };
      const newRules = [parseRule("deny Write /etc/*"), parseRule("ask GitPush *")];

      const merged = mergePermissionRules(existing, newRules);
      expect(merged.rules).toHaveLength(3);
      expect(merged.rules[0]!.decision).toBe("allow");
      expect(merged.rules[1]!.decision).toBe("deny");
      expect(merged.rules[2]!.decision).toBe("ask");
      expect(merged.defaultDecision).toBe("ask");
    });

    it("preserves existing config when merging empty array", () => {
      const existing = {
        rules: [parseRule("allow Bash *")],
        defaultDecision: "deny" as const,
      };

      const merged = mergePermissionRules(existing, []);
      expect(merged.rules).toHaveLength(1);
      expect(merged.defaultDecision).toBe("deny");
    });

    it("does not mutate the original config", () => {
      const existing = {
        rules: [parseRule("allow Bash *")],
        defaultDecision: "ask" as const,
      };
      const originalLength = existing.rules.length;

      mergePermissionRules(existing, [parseRule("deny Write /etc/*")]);
      expect(existing.rules).toHaveLength(originalLength);
    });
  });
});
