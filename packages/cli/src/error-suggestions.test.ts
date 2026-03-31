import { describe, it, expect } from "vitest";
import {
  suggestCommand,
  enhanceError,
  formatEnhancedError,
  getContextualHelp,
} from "./error-suggestions.js";

describe("suggestCommand", () => {
  const commands = ["help", "add", "commit", "files", "find", "magic", "model"];

  it("suggests closest matching command", () => {
    const suggestions = suggestCommand("hel", commands); // Partial match
    expect(suggestions).toContain("help");
  });

  it("handles multiple similar matches", () => {
    const suggestions = suggestCommand("fi", commands);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions).toEqual(expect.arrayContaining(["files", "find"]));
  });

  it("returns empty array for very poor matches", () => {
    const suggestions = suggestCommand("xyz", commands, 0.5);
    expect(suggestions.length).toBe(0);
  });

  it("returns at most 3 suggestions", () => {
    const suggestions = suggestCommand("a", commands);
    expect(suggestions.length).toBeLessThanOrEqual(3);
  });

  it("ranks by similarity score", () => {
    const suggestions = suggestCommand("com", commands);
    expect(suggestions[0]).toBe("commit"); // Exact match at start
  });
});

describe("enhanceError", () => {
  it("enhances file not found errors", () => {
    const enhanced = enhanceError("ENOENT: no such file or directory");
    expect(enhanced.error).toContain("ENOENT");
    expect(enhanced.suggestions.length).toBeGreaterThan(0);
    expect(enhanced.suggestions.some((s) => s.command === "/find")).toBe(true);
  });

  it("enhances permission errors", () => {
    const enhanced = enhanceError("EACCES: permission denied");
    expect(enhanced.suggestions.some((s) => s.message.includes("permissions"))).toBe(true);
  });

  it("enhances git repository errors", () => {
    const enhanced = enhanceError("fatal: not a git repository");
    expect(enhanced.suggestions.some((s) => s.command === "git init")).toBe(true);
  });

  it("enhances merge conflict errors", () => {
    const enhanced = enhanceError("merge conflict in file.ts");
    expect(enhanced.suggestions.some((s) => s.message.includes("Resolve conflicts"))).toBe(true);
    expect(enhanced.suggestions.some((s) => s.command === "/commit")).toBe(true);
  });

  it("enhances network errors", () => {
    const enhanced = enhanceError("ECONNREFUSED");
    expect(enhanced.suggestions.some((s) => s.message.includes("internet connection"))).toBe(true);
  });

  it("enhances rate limit errors", () => {
    const enhanced = enhanceError("rate limit exceeded (429)");
    expect(enhanced.suggestions.some((s) => s.message.includes("Wait"))).toBe(true);
  });

  it("enhances module not found errors", () => {
    const enhanced = enhanceError("Cannot find module 'express'");
    expect(enhanced.suggestions.some((s) => s.command === "npm install")).toBe(true);
    expect(enhanced.suggestions.some((s) => s.command === "npm install express")).toBe(true);
  });

  it("enhances syntax errors", () => {
    const enhanced = enhanceError("SyntaxError: Unexpected token }");
    expect(enhanced.suggestions.some((s) => s.message.includes("typos"))).toBe(true);
  });

  it("enhances memory errors", () => {
    const enhanced = enhanceError("JavaScript heap out of memory");
    expect(enhanced.suggestions.some((s) => s.message.includes("memory limit"))).toBe(true);
  });

  it("enhances TypeScript errors", () => {
    const enhanced = enhanceError("error TS2304: Cannot find name 'Foo'");
    expect(enhanced.suggestions.some((s) => s.command === "npm run typecheck")).toBe(true);
  });

  it("includes context when provided", () => {
    const enhanced = enhanceError("Something went wrong", { command: "/magic" });
    expect(enhanced.context).toContain("/magic");
  });

  it("handles Error objects", () => {
    const error = new Error("Test error message");
    const enhanced = enhanceError(error);
    expect(enhanced.error).toBe("Test error message");
  });

  it("provides generic suggestions for unknown errors", () => {
    const enhanced = enhanceError("Unknown error xyz");
    expect(enhanced.suggestions.length).toBeGreaterThan(0);
    expect(enhanced.suggestions.some((s) => s.command === "/help")).toBe(true);
  });
});

describe("formatEnhancedError", () => {
  it("formats error with suggestions", () => {
    const enhanced = enhanceError("ENOENT: no such file");
    const formatted = formatEnhancedError(enhanced, false);

    expect(formatted).toContain("Error:");
    expect(formatted).toContain("ENOENT");
    expect(formatted).toContain("Suggestions:");
    expect(formatted).toContain("/find");
  });

  it("includes context when present", () => {
    const enhanced = enhanceError("Test error", { command: "/test" });
    const formatted = formatEnhancedError(enhanced, false);

    expect(formatted).toContain("/test");
  });

  it("works with colors disabled", () => {
    const enhanced = enhanceError("Test error");
    const formatted = formatEnhancedError(enhanced, false);

    // Should not contain ANSI codes
    expect(formatted).not.toMatch(/\x1b\[\d+m/);
  });

  it("includes ANSI colors when enabled", () => {
    const enhanced = enhanceError("Test error");
    const formatted = formatEnhancedError(enhanced, true);

    // Should contain ANSI codes
    expect(formatted).toMatch(/\x1b\[\d+m/);
  });
});

describe("getContextualHelp", () => {
  it("suggests adding files when context is empty", () => {
    const hints = getContextualHelp({ filesInContext: 0 });
    expect(hints.some((h) => h.includes("Add files"))).toBe(true);
  });

  it("suggests dropping files when too many in context", () => {
    const hints = getContextualHelp({ filesInContext: 25 });
    expect(hints.some((h) => h.includes("/drop"))).toBe(true);
  });

  it("suggests tutorial after frequent help usage", () => {
    const hints = getContextualHelp({
      recentCommands: ["help", "help", "help"],
    });
    expect(hints.some((h) => h.includes("/tutorial"))).toBe(true);
  });

  it("suggests different approach for repeated errors", () => {
    const hints = getContextualHelp({
      recentErrors: ["same error", "same error", "same error"],
    });
    expect(hints.some((h) => h.includes("different approach"))).toBe(true);
  });

  it("returns empty array when no hints needed", () => {
    const hints = getContextualHelp({
      filesInContext: 5,
      recentCommands: [],
      recentErrors: [],
    });
    expect(hints.length).toBe(0);
  });

  it("handles undefined context fields", () => {
    const hints = getContextualHelp({});
    expect(hints).toBeDefined();
    expect(Array.isArray(hints)).toBe(true);
  });
});
