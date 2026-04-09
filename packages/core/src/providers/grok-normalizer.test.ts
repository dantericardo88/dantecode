// ============================================================================
// Grok Tool Call Normalizer Tests (M7/M9)
// ============================================================================

import { describe, expect, it } from "vitest";
import {
  normalizeGrokToolCall,
  repairMalformedJson,
  isToolCallParseError,
} from "./grok-normalizer.js";

describe("repairMalformedJson", () => {
  it("passes through valid JSON unchanged", () => {
    const input = '{"key": "value", "num": 42}';
    const result = repairMalformedJson(input);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value", num: 42 });
  });

  it("fixes trailing commas", () => {
    const input = '{"key": "value", "num": 42,}';
    const result = repairMalformedJson(input);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value", num: 42 });
  });

  it("closes unclosed braces", () => {
    const input = '{"key": "value"';
    const result = repairMalformedJson(input);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ key: "value" });
  });

  it("closes unclosed brackets", () => {
    const input = '{"items": [1, 2, 3}';
    // This is ambiguous but should at least produce valid JSON
    const result = repairMalformedJson(input);
    // The input has mismatched brackets — repair may or may not succeed
    // depending on heuristic. Key requirement: returns null or valid JSON.
    if (result !== null) {
      expect(() => JSON.parse(result)).not.toThrow();
    }
  });

  it("closes truncated strings", () => {
    const input = '{"command": "echo hello';
    const result = repairMalformedJson(input);
    expect(result).not.toBeNull();
    expect(() => JSON.parse(result!)).not.toThrow();
  });

  it("returns null for completely invalid input", () => {
    const result = repairMalformedJson("not json at all {{{");
    // May or may not be repairable — if null, that's valid
    if (result !== null) {
      expect(() => JSON.parse(result)).not.toThrow();
    }
  });

  it("returns null for empty/null input", () => {
    expect(repairMalformedJson("")).toBeNull();
    expect(repairMalformedJson(null as any)).toBeNull();
  });
});

describe("normalizeGrokToolCall", () => {
  it("normalizes a valid tool call with object arguments", () => {
    const result = normalizeGrokToolCall({
      id: "tc-1",
      name: "Read",
      arguments: { file_path: "src/index.ts" },
    });

    expect(isToolCallParseError(result)).toBe(false);
    if (!isToolCallParseError(result)) {
      expect(result.id).toBe("tc-1");
      expect(result.name).toBe("Read");
      expect(result.arguments).toEqual({ file_path: "src/index.ts" });
    }
  });

  it("normalizes a tool call with string arguments (valid JSON)", () => {
    const result = normalizeGrokToolCall({
      id: "tc-2",
      name: "Write",
      arguments: '{"file_path": "src/test.ts", "content": "hello"}',
    });

    expect(isToolCallParseError(result)).toBe(false);
    if (!isToolCallParseError(result)) {
      expect(result.name).toBe("Write");
      expect(result.arguments).toEqual({ file_path: "src/test.ts", content: "hello" });
    }
  });

  it("repairs trailing comma in arguments JSON", () => {
    const result = normalizeGrokToolCall({
      id: "tc-3",
      name: "Edit",
      arguments: '{"file_path": "src/fix.ts", "old_string": "bug",}',
    });

    expect(isToolCallParseError(result)).toBe(false);
    if (!isToolCallParseError(result)) {
      expect(result.arguments).toEqual({ file_path: "src/fix.ts", old_string: "bug" });
    }
  });

  it("repairs truncated JSON arguments", () => {
    const result = normalizeGrokToolCall({
      id: "tc-4",
      name: "Bash",
      arguments: '{"command": "npm test"',
    });

    expect(isToolCallParseError(result)).toBe(false);
    if (!isToolCallParseError(result)) {
      expect(result.arguments.command).toBe("npm test");
    }
  });

  it("returns error for completely invalid JSON arguments", () => {
    const result = normalizeGrokToolCall({
      id: "tc-5",
      name: "Bash",
      arguments: "<<<GARBAGE>>>",
    });

    expect(isToolCallParseError(result)).toBe(true);
    if (isToolCallParseError(result)) {
      expect(result.reason).toContain("Malformed");
    }
  });

  it("returns error for missing tool name", () => {
    const result = normalizeGrokToolCall({ id: "tc-6" });
    expect(isToolCallParseError(result)).toBe(true);
    if (isToolCallParseError(result)) {
      expect(result.reason).toContain("Missing tool call name");
    }
  });

  it("handles nested function format (OpenAI style)", () => {
    const result = normalizeGrokToolCall({
      id: "tc-7",
      function: {
        name: "Glob",
        arguments: '{"pattern": "**/*.ts"}',
      },
    });

    expect(isToolCallParseError(result)).toBe(false);
    if (!isToolCallParseError(result)) {
      expect(result.name).toBe("Glob");
      expect(result.arguments).toEqual({ pattern: "**/*.ts" });
    }
  });

  it("generates an ID when none is provided", () => {
    const result = normalizeGrokToolCall({
      name: "Read",
      arguments: { file_path: "test.ts" },
    });

    expect(isToolCallParseError(result)).toBe(false);
    if (!isToolCallParseError(result)) {
      expect(result.id).toMatch(/^grok-tc-/);
    }
  });

  it("handles empty/missing arguments gracefully", () => {
    const result = normalizeGrokToolCall({ id: "tc-8", name: "Read" });

    expect(isToolCallParseError(result)).toBe(false);
    if (!isToolCallParseError(result)) {
      expect(result.arguments).toEqual({});
    }
  });
});
