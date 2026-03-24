import { describe, it, expect } from "vitest";
import {
  isJsonFile,
  attemptJsonRepair,
  validateJsonContent,
} from "./json-write-guard.js";

describe("json-write-guard", () => {
  describe("isJsonFile", () => {
    it("returns true for .json extension", () => {
      expect(isJsonFile("package.json")).toBe(true);
      expect(isJsonFile("/path/to/tsconfig.json")).toBe(true);
      expect(isJsonFile("C:\\Projects\\file.JSON")).toBe(true);
    });

    it("returns false for non-JSON extensions", () => {
      expect(isJsonFile("file.ts")).toBe(false);
      expect(isJsonFile("file.js")).toBe(false);
      expect(isJsonFile("file.md")).toBe(false);
      expect(isJsonFile("file.jsonl")).toBe(false);
    });
  });

  describe("attemptJsonRepair", () => {
    it("returns valid JSON unchanged", () => {
      const valid = '{"name": "test", "version": "1.0.0"}';
      expect(attemptJsonRepair(valid)).toBe(valid);
    });

    it("repairs double-escaped quotes", () => {
      const broken = '{\\"name\\": \\"test\\", \\"version\\": \\"1.0.0\\"}';
      const result = attemptJsonRepair(broken);
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
      expect(JSON.parse(result!)).toEqual({
        name: "test",
        version: "1.0.0",
      });
    });

    it("repairs trailing commas", () => {
      const broken = '{"name": "test", "version": "1.0.0",}';
      const result = attemptJsonRepair(broken);
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });

    it("repairs trailing commas in arrays", () => {
      const broken = '{"items": ["a", "b",]}';
      const result = attemptJsonRepair(broken);
      expect(result).not.toBeNull();
      expect(JSON.parse(result!)).toEqual({ items: ["a", "b"] });
    });

    it("repairs combined issues (escaped quotes + trailing commas)", () => {
      const broken = '{\\"name\\": \\"test\\",}';
      const result = attemptJsonRepair(broken);
      expect(result).not.toBeNull();
      expect(() => JSON.parse(result!)).not.toThrow();
    });

    it("returns null for completely unparseable content", () => {
      expect(attemptJsonRepair("this is not json at all")).toBeNull();
      expect(attemptJsonRepair("{{{broken")).toBeNull();
      expect(attemptJsonRepair("")).toBeNull();
    });
  });

  describe("validateJsonContent", () => {
    it("passes non-JSON files through unchanged", () => {
      const result = validateJsonContent("not json", "file.ts");
      expect(result.valid).toBe(true);
      expect(result.repaired).toBe(false);
      expect(result.content).toBe("not json");
    });

    it("validates valid JSON without repair", () => {
      const json = '{"name": "test"}';
      const result = validateJsonContent(json, "package.json");
      expect(result.valid).toBe(true);
      expect(result.repaired).toBe(false);
      expect(result.content).toBe(json);
    });

    it("auto-repairs and flags repaired JSON", () => {
      const broken = '{\\"name\\": \\"test\\"}';
      const result = validateJsonContent(broken, "package.json");
      expect(result.valid).toBe(true);
      expect(result.repaired).toBe(true);
      expect(() => JSON.parse(result.content)).not.toThrow();
    });

    it("rejects unrepairable JSON with error message", () => {
      const garbage = "{{{not-json";
      const result = validateJsonContent(garbage, "tsconfig.json");
      expect(result.valid).toBe(false);
      expect(result.repaired).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeGreaterThan(0);
    });

    it("handles deeply nested valid JSON", () => {
      const nested = JSON.stringify({
        a: { b: { c: { d: [1, 2, 3] } } },
      });
      const result = validateJsonContent(nested, "config.json");
      expect(result.valid).toBe(true);
      expect(result.repaired).toBe(false);
    });
  });
});
