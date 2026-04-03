// ============================================================================
// @dantecode/core — Custom Modes Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  checkPathAllowed,
  checkToolAllowed,
  validateModeSlug,
  validateCustomMode,
  getCustomModeToolExclusions,
  formatModeDisplay,
  type CustomMode,
} from "./custom-modes.js";

describe("Custom Modes", () => {
  describe("validateModeSlug", () => {
    it("accepts valid slugs", () => {
      expect(validateModeSlug("frontend")).toEqual({ valid: true });
      expect(validateModeSlug("backend-api")).toEqual({ valid: true });
      expect(validateModeSlug("test123")).toEqual({ valid: true });
    });

    it("rejects empty slug", () => {
      const result = validateModeSlug("");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("empty");
    });

    it("rejects slug with uppercase", () => {
      const result = validateModeSlug("Frontend");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("lowercase");
    });

    it("rejects slug with special characters", () => {
      const result = validateModeSlug("frontend_mode");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("lowercase");
    });

    it("rejects slug starting with hyphen", () => {
      const result = validateModeSlug("-frontend");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("hyphen");
    });

    it("rejects slug ending with hyphen", () => {
      const result = validateModeSlug("frontend-");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("hyphen");
    });

    it("rejects slug that is too long", () => {
      const result = validateModeSlug("a".repeat(33));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("32 characters");
    });

    it("rejects reserved slug", () => {
      expect(validateModeSlug("review").valid).toBe(false);
      expect(validateModeSlug("apply").valid).toBe(false);
      expect(validateModeSlug("autoforge").valid).toBe(false);
      expect(validateModeSlug("yolo").valid).toBe(false);
      expect(validateModeSlug("plan").valid).toBe(false);
    });
  });

  describe("validateCustomMode", () => {
    it("accepts valid mode", () => {
      const mode: CustomMode = {
        slug: "frontend",
        name: "Frontend Mode",
        description: "Only edit frontend files",
        allowedPaths: ["src/**/*.tsx", "src/**/*.css"],
      };
      expect(validateCustomMode(mode)).toEqual({ valid: true });
    });

    it("rejects mode with invalid slug", () => {
      const mode: CustomMode = {
        slug: "FRONTEND",
        name: "Frontend Mode",
      };
      const result = validateCustomMode(mode);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("lowercase");
    });

    it("rejects mode with empty name", () => {
      const mode: CustomMode = {
        slug: "frontend",
        name: "",
      };
      const result = validateCustomMode(mode);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("name");
    });

    it("rejects mode with name too long", () => {
      const mode: CustomMode = {
        slug: "frontend",
        name: "a".repeat(65),
      };
      const result = validateCustomMode(mode);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("64 characters");
    });

    it("rejects mode with path traversal in allowedPaths", () => {
      const mode: CustomMode = {
        slug: "frontend",
        name: "Frontend Mode",
        allowedPaths: ["../etc/passwd"],
      };
      const result = validateCustomMode(mode);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Path traversal");
    });

    it("rejects mode with path traversal in deniedPaths", () => {
      const mode: CustomMode = {
        slug: "frontend",
        name: "Frontend Mode",
        deniedPaths: ["../../secret"],
      };
      const result = validateCustomMode(mode);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("Path traversal");
    });
  });

  describe("checkPathAllowed", () => {
    const frontendMode: CustomMode = {
      slug: "frontend",
      name: "Frontend Mode",
      allowedPaths: ["src/**/*.tsx", "src/**/*.ts", "src/**/*.css"],
      deniedPaths: ["src/backend/**"],
    };

    it("allows path matching allowedPaths", () => {
      const result = checkPathAllowed(frontendMode, "src/components/Button.tsx");
      expect(result.allowed).toBe(true);
    });

    it("denies path not matching allowedPaths", () => {
      const result = checkPathAllowed(frontendMode, "server/api.ts");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("does not match");
    });

    it("denies path matching deniedPaths even if it matches allowedPaths", () => {
      const result = checkPathAllowed(frontendMode, "src/backend/database.ts");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("normalizes Windows paths", () => {
      const result = checkPathAllowed(frontendMode, "src\\components\\Button.tsx");
      expect(result.allowed).toBe(true);
    });

    it("allows all paths when no restrictions", () => {
      const mode: CustomMode = {
        slug: "unrestricted",
        name: "Unrestricted Mode",
      };
      expect(checkPathAllowed(mode, "anything.ts").allowed).toBe(true);
      expect(checkPathAllowed(mode, "foo/bar/baz.js").allowed).toBe(true);
    });

    it("handles dot files", () => {
      const mode: CustomMode = {
        slug: "config-only",
        name: "Config Only",
        allowedPaths: [".env*", "*.config.js"],
      };
      expect(checkPathAllowed(mode, ".env.local").allowed).toBe(true);
      expect(checkPathAllowed(mode, "vite.config.js").allowed).toBe(true);
      expect(checkPathAllowed(mode, "src/index.ts").allowed).toBe(false);
    });
  });

  describe("checkToolAllowed", () => {
    const readOnlyMode: CustomMode = {
      slug: "read-only",
      name: "Read Only Mode",
      allowedTools: ["Read", "Glob", "Grep", "Bash"],
      deniedTools: ["Write", "Edit", "GitCommit"],
    };

    it("allows tool in allowedTools", () => {
      const result = checkToolAllowed(readOnlyMode, "Read");
      expect(result.allowed).toBe(true);
    });

    it("denies tool not in allowedTools", () => {
      const result = checkToolAllowed(readOnlyMode, "Write");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("denies tool in deniedTools", () => {
      const result = checkToolAllowed(readOnlyMode, "GitCommit");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("denied");
    });

    it("allows all tools when no restrictions", () => {
      const mode: CustomMode = {
        slug: "unrestricted",
        name: "Unrestricted Mode",
      };
      expect(checkToolAllowed(mode, "Write").allowed).toBe(true);
      expect(checkToolAllowed(mode, "Bash").allowed).toBe(true);
      expect(checkToolAllowed(mode, "GitCommit").allowed).toBe(true);
    });

    it("deniedTools takes precedence over allowedTools", () => {
      const mode: CustomMode = {
        slug: "conflicting",
        name: "Conflicting Mode",
        allowedTools: ["Write", "Edit"],
        deniedTools: ["Write"],
      };
      // Write is in both lists, deniedTools wins
      expect(checkToolAllowed(mode, "Write").allowed).toBe(false);
      expect(checkToolAllowed(mode, "Edit").allowed).toBe(true);
    });
  });

  describe("getCustomModeToolExclusions", () => {
    it("returns deniedTools when only deniedTools is set", () => {
      const mode: CustomMode = {
        slug: "test",
        name: "Test Mode",
        deniedTools: ["Write", "Edit"],
      };
      expect(getCustomModeToolExclusions(mode)).toEqual(["Write", "Edit"]);
    });

    it("returns deniedTools when allowedTools is set (caller handles allowedTools)", () => {
      const mode: CustomMode = {
        slug: "test",
        name: "Test Mode",
        allowedTools: ["Read", "Grep"],
        deniedTools: ["Bash"],
      };
      expect(getCustomModeToolExclusions(mode)).toEqual(["Bash"]);
    });

    it("returns empty array when no restrictions", () => {
      const mode: CustomMode = {
        slug: "test",
        name: "Test Mode",
      };
      expect(getCustomModeToolExclusions(mode)).toEqual([]);
    });
  });

  describe("formatModeDisplay", () => {
    it("formats mode with all attributes", () => {
      const mode: CustomMode = {
        slug: "frontend",
        name: "Frontend Mode",
        icon: "🎨",
        model: "claude-sonnet-4-6",
        allowedPaths: ["src/**/*.tsx"],
        deniedTools: ["GitCommit"],
      };
      const display = formatModeDisplay(mode);
      expect(display).toContain("🎨");
      expect(display).toContain("Frontend Mode");
      expect(display).toContain("claude-sonnet-4-6");
      expect(display).toContain("paths: 1 allowed");
      expect(display).toContain("tools: 1 denied");
    });

    it("formats minimal mode", () => {
      const mode: CustomMode = {
        slug: "simple",
        name: "Simple Mode",
      };
      const display = formatModeDisplay(mode);
      expect(display).toBe("Simple Mode");
    });

    it("shows both path restrictions", () => {
      const mode: CustomMode = {
        slug: "mixed",
        name: "Mixed Mode",
        allowedPaths: ["src/**"],
        deniedPaths: ["src/backend/**"],
      };
      const display = formatModeDisplay(mode);
      expect(display).toContain("paths: 1 allowed");
      expect(display).toContain("paths: 1 denied");
    });
  });
});
