// ============================================================================
// @dantecode/core — Provider Tool Call Normalization Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { normalizeToolCall } from "./provider-normalization.js";

describe("Provider Tool Call Normalization", () => {
  describe("Grok/xAI Tool Calls", () => {
    it("should normalize complete Grok tool call", () => {
      const raw = {
        id: "call-123",
        name: "Read",
        input: { file_path: "test.txt" },
      };

      const result = normalizeToolCall(raw, "grok");

      expect(result).toEqual({
        id: "call-123",
        name: "Read",
        input: { file_path: "test.txt" },
      });
    });

    it("should handle streaming fragments", () => {
      const fragments = [
        { partial: true, name: "Read" },
        { partial: true, input: { file_path: "test.txt" } },
        { id: "call-123" },
      ];

      const raw = { fragments };

      const result = normalizeToolCall(raw, "grok");

      expect(result).toEqual({
        id: "call-123",
        name: "Read",
        input: { file_path: "test.txt" },
      });
    });

    it("should return null for incomplete fragments", () => {
      const raw = { partial: true, name: "Read" };

      const result = normalizeToolCall(raw, "grok");

      expect(result).toBeNull();
    });
  });

  describe("Malformed Arguments", () => {
    it("should repair JSON string arguments", () => {
      const raw = {
        id: "call-123",
        name: "Write",
        input: {
          file_path: "test.txt",
          content: '{"key": "value"}', // JSON string that should be parsed
        },
      };

      const result = normalizeToolCall(raw, "grok");

      expect(result?.input.content).toEqual({ key: "value" });
    });

    it("should handle malformed JSON in OpenAI style", () => {
      const raw = {
        id: "call-123",
        function: {
          name: "Write",
          arguments: '{"file_path": "test.txt", "content": "hello"}', // Valid JSON
        },
      };

      const result = normalizeToolCall(raw, "openai");

      expect(result).toEqual({
        id: "call-123",
        name: "Write",
        input: { file_path: "test.txt", content: "hello" },
      });
    });

    it("should repair malformed JSON", () => {
      const raw = {
        id: "call-123",
        function: {
          name: "Write",
          arguments: '{"file_path": "test.txt", "content": "hello",}', // Trailing comma
        },
      };

      const result = normalizeToolCall(raw, "openai");

      expect(result?.input).toEqual({ file_path: "test.txt", content: "hello" });
    });
  });

  describe("Edge Cases", () => {
    it("should return null for empty assistant content with tool-call metadata", () => {
      const raw = {}; // Empty

      const result = normalizeToolCall(raw, "grok");

      expect(result).toBeNull();
    });

    it("should handle assistant completion claim with no tool call", () => {
      const raw = {
        completion: "Done",
        noToolCall: true,
      };

      const result = normalizeToolCall(raw, "grok");

      expect(result).toBeNull();
    });

    it("should generate ID if missing", () => {
      const raw = {
        name: "Read",
        input: { file_path: "test.txt" },
      };

      const result = normalizeToolCall(raw, "grok");

      expect(result?.id).toBeDefined();
      expect(result?.name).toBe("Read");
      expect(result?.input).toEqual({ file_path: "test.txt" });
    });
  });

  describe("Already Normalized", () => {
    it("should pass through already normalized calls", () => {
      const raw = {
        id: "call-123",
        name: "Read",
        input: { file_path: "test.txt" },
      };

      const result = normalizeToolCall(raw, "unknown");

      expect(result).toEqual(raw);
    });
  });
});
