// ============================================================================
// @dantecode/core - Doc-Code Drift Detection Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  detectDrift,
  extractDocSignatures,
  extractCodeParameters,
  symbolToCodeSymbol,
  compareSignatures,
  type DocSymbol,
  type CodeSymbol,
} from "./doc-code-drift.js";
import type { SymbolDefinition } from "../repo-map-ast.js";

describe("Doc-Code Drift Detection", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `drift-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("extractCodeParameters", () => {
    it("should extract simple parameters", () => {
      const params = extractCodeParameters("function test(a, b, c)");
      expect(params).toHaveLength(3);
      expect(params[0]!.name).toBe("a");
      expect(params[1]!.name).toBe("b");
      expect(params[2]!.name).toBe("c");
    });

    it("should extract typed parameters", () => {
      const params = extractCodeParameters("function test(name: string, age: number)");
      expect(params).toHaveLength(2);
      expect(params[0]!).toEqual({ name: "name", type: "string", optional: false });
      expect(params[1]!).toEqual({ name: "age", type: "number", optional: false });
    });

    it("should detect optional parameters", () => {
      const params = extractCodeParameters("function test(required: string, optional?: number)");
      expect(params).toHaveLength(2);
      expect(params[0]!.optional).toBe(false);
      expect(params[1]!.optional).toBe(true);
    });

    it("should detect parameters with default values", () => {
      const params = extractCodeParameters("function test(name: string, count = 10)");
      expect(params).toHaveLength(2);
      expect(params[0]!.optional).toBe(false);
      expect(params[1]!.optional).toBe(true);
    });

    it("should handle complex types", () => {
      const params = extractCodeParameters("function test(data: Record<string, number>)");
      expect(params).toHaveLength(1);
      expect(params[0]!.name).toBe("data");
      expect(params[0]!.type).toBe("Record<string, number>");
    });

    it("should handle nested generic types", () => {
      const params = extractCodeParameters("function test(items: Array<Map<string, Set<number>>>)");
      expect(params).toHaveLength(1);
      expect(params[0]!.type).toBe("Array<Map<string, Set<number>>>");
    });

    it("should handle object destructuring parameters", () => {
      const params = extractCodeParameters("function test({ name, age }: { name: string; age: number })");
      expect(params).toHaveLength(1);
      expect(params[0]!.name).toBe("{ name, age }");
    });

    it("should return empty array for no parameters", () => {
      const params = extractCodeParameters("function test()");
      expect(params).toHaveLength(0);
    });
  });

  describe("extractDocSignatures", () => {
    it("should extract JSDoc with parameters", () => {
      const source = `
/**
 * Test function
 * @param {string} name - The name
 * @param {number} age - The age
 * @returns {boolean} Success status
 */
function test(name, age) {
  return true;
}
`;
      const docSymbols = extractDocSignatures(source);
      expect(docSymbols).toHaveLength(1);
      expect(docSymbols[0]!.name).toBe("test");
      expect(docSymbols[0]!.params).toHaveLength(2);
      expect(docSymbols[0]!.params[0]).toEqual({ name: "name", type: "string", description: "The name" });
      expect(docSymbols[0]!.returnType).toBe("boolean");
    });

    it("should extract TSDoc with parameters", () => {
      const source = `
/**
 * Process data
 * @param data - Input data
 * @param options - Processing options
 * @returns Processed result
 */
export async function processData(data: string, options: Options) {
  return result;
}
`;
      const docSymbols = extractDocSignatures(source);
      expect(docSymbols).toHaveLength(1);
      expect(docSymbols[0]!.name).toBe("processData");
      expect(docSymbols[0]!.params[0]!.name).toBe("data");
      expect(docSymbols[0]!.params[1]!.name).toBe("options");
    });

    it("should extract class documentation", () => {
      const source = `
/**
 * A test class
 * @param name - Class name
 */
export class TestClass {
  constructor(name: string) {}
}
`;
      const docSymbols = extractDocSignatures(source);
      expect(docSymbols).toHaveLength(1);
      expect(docSymbols[0]!.type).toBe("class");
      expect(docSymbols[0]!.name).toBe("TestClass");
    });

    it("should extract interface documentation", () => {
      const source = `
/**
 * User interface
 * @param name - User name
 * @param email - User email
 */
export interface User {
  name: string;
  email: string;
}
`;
      const docSymbols = extractDocSignatures(source);
      expect(docSymbols).toHaveLength(1);
      expect(docSymbols[0]!.type).toBe("interface");
    });

    it("should extract multiple symbols", () => {
      const source = `
/**
 * First function
 * @param x - X value
 */
function first(x: number) {}

/**
 * Second function
 * @param y - Y value
 */
function second(y: string) {}
`;
      const docSymbols = extractDocSignatures(source);
      expect(docSymbols).toHaveLength(2);
      expect(docSymbols[0]!.name).toBe("first");
      expect(docSymbols[1]!.name).toBe("second");
    });

    it("should handle symbols without parameters", () => {
      const source = `
/**
 * Get current time
 * @returns {number} Timestamp
 */
function getCurrentTime() {
  return Date.now();
}
`;
      const docSymbols = extractDocSignatures(source);
      expect(docSymbols).toHaveLength(1);
      expect(docSymbols[0]!.params).toHaveLength(0);
    });

    it("should skip symbols without JSDoc", () => {
      const source = `
function undocumented() {}
`;
      const docSymbols = extractDocSignatures(source);
      expect(docSymbols).toHaveLength(0);
    });
  });

  describe("symbolToCodeSymbol", () => {
    it("should convert function symbol", () => {
      const symbol: SymbolDefinition = {
        name: "test",
        kind: "function",
        signature: "function test(a: string, b: number): boolean",
        filePath: "test.ts",
        line: 1,
      };

      const codeSymbol = symbolToCodeSymbol(symbol);
      expect(codeSymbol.name).toBe("test");
      expect(codeSymbol.type).toBe("function");
      expect(codeSymbol.params).toHaveLength(2);
      expect(codeSymbol.returnType).toBe("boolean");
    });

    it("should convert const arrow function", () => {
      const symbol: SymbolDefinition = {
        name: "handler",
        kind: "const",
        signature: "const handler = (event: Event): void =>",
        filePath: "test.ts",
        line: 1,
      };

      const codeSymbol = symbolToCodeSymbol(symbol);
      expect(codeSymbol.type).toBe("function");
    });

    it("should handle no return type", () => {
      const symbol: SymbolDefinition = {
        name: "test",
        kind: "function",
        signature: "function test(x: number)",
        filePath: "test.ts",
        line: 1,
      };

      const codeSymbol = symbolToCodeSymbol(symbol);
      expect(codeSymbol.returnType).toBeUndefined();
    });
  });

  describe("compareSignatures", () => {
    it("should detect no drift for matching signatures", () => {
      const code: CodeSymbol = {
        name: "test",
        type: "function",
        params: [
          { name: "a", type: "string", optional: false },
          { name: "b", type: "number", optional: false },
        ],
        returnType: "boolean",
        signature: "function test(a: string, b: number): boolean",
      };

      const doc: DocSymbol = {
        name: "test",
        type: "function",
        params: [
          { name: "a", type: "string" },
          { name: "b", type: "number" },
        ],
        returnType: "boolean",
        signature: "test(a, b): boolean",
      };

      const result = compareSignatures(code, doc);
      expect(result.detected).toBe(false);
    });

    it("should detect parameter count mismatch", () => {
      const code: CodeSymbol = {
        name: "test",
        type: "function",
        params: [
          { name: "a", type: "string" },
          { name: "b", type: "number" },
        ],
        signature: "function test(a: string, b: number)",
      };

      const doc: DocSymbol = {
        name: "test",
        type: "function",
        params: [{ name: "a", type: "string" }],
        signature: "test(a)",
      };

      const result = compareSignatures(code, doc);
      expect(result.detected).toBe(true);
      expect(result.reason).toContain("parameter count mismatch");
    });

    it("should detect parameter name mismatch", () => {
      const code: CodeSymbol = {
        name: "test",
        type: "function",
        params: [
          { name: "firstName", type: "string" },
          { name: "age", type: "number" },
        ],
        signature: "function test(firstName: string, age: number)",
      };

      const doc: DocSymbol = {
        name: "test",
        type: "function",
        params: [
          { name: "name", type: "string" },
          { name: "age", type: "number" },
        ],
        signature: "test(name, age)",
      };

      const result = compareSignatures(code, doc);
      expect(result.detected).toBe(true);
      expect(result.reason).toContain("parameter name mismatch");
      expect(result.reason).toContain("firstName");
      expect(result.reason).toContain("name");
    });

    it("should detect parameter type mismatch", () => {
      const code: CodeSymbol = {
        name: "test",
        type: "function",
        params: [{ name: "value", type: "number" }],
        signature: "function test(value: number)",
      };

      const doc: DocSymbol = {
        name: "test",
        type: "function",
        params: [{ name: "value", type: "string" }],
        signature: "test(value)",
      };

      const result = compareSignatures(code, doc);
      expect(result.detected).toBe(true);
      expect(result.reason).toContain("parameter type mismatch");
    });

    it("should detect return type mismatch", () => {
      const code: CodeSymbol = {
        name: "test",
        type: "function",
        params: [],
        returnType: "string",
        signature: "function test(): string",
      };

      const doc: DocSymbol = {
        name: "test",
        type: "function",
        params: [],
        returnType: "number",
        signature: "test()",
      };

      const result = compareSignatures(code, doc);
      expect(result.detected).toBe(true);
      expect(result.reason).toContain("return type mismatch");
    });

    it("should ignore type mismatch if one is undocumented", () => {
      const code: CodeSymbol = {
        name: "test",
        type: "function",
        params: [{ name: "a", type: "string" }],
        signature: "function test(a: string)",
      };

      const doc: DocSymbol = {
        name: "test",
        type: "function",
        params: [{ name: "a" }], // No type documented
        signature: "test(a)",
      };

      const result = compareSignatures(code, doc);
      expect(result.detected).toBe(false);
    });
  });

  describe("detectDrift - integration", () => {
    it("should detect drift in TypeScript file", async () => {
      const tsFile = join(testDir, "test.ts");
      await writeFile(
        tsFile,
        `
/**
 * Calculate sum
 * @param {number} a - First number
 * @param {number} b - Second number
 * @returns {number} Sum
 */
export function calculateSum(x: number, y: number): number {
  return x + y;
}
`,
      );

      const checks = await detectDrift([tsFile], testDir);
      expect(checks).toHaveLength(1);
      expect(checks[0]!.driftDetected).toBe(true);
      expect(checks[0]!.driftReason).toContain("parameter name mismatch");
      expect(checks[0]!.name).toBe("calculateSum");
    });

    it("should detect no drift for matching signatures", async () => {
      const tsFile = join(testDir, "correct.ts");
      await writeFile(
        tsFile,
        `
/**
 * Process data
 * @param {string} input - Input data
 * @param {object} options - Options
 * @returns {string} Result
 */
export function processData(input: string, options: object): string {
  return input;
}
`,
      );

      const checks = await detectDrift([tsFile], testDir);
      const drifted = checks.filter((c) => c.driftDetected);
      expect(drifted).toHaveLength(0);
    });

    it("should skip undocumented functions", async () => {
      const tsFile = join(testDir, "undocumented.ts");
      await writeFile(
        tsFile,
        `
export function undocumented(a: string, b: number) {
  return true;
}
`,
      );

      const checks = await detectDrift([tsFile], testDir);
      expect(checks).toHaveLength(0);
    });

    it("should handle multiple functions in one file", async () => {
      const tsFile = join(testDir, "multiple.ts");
      await writeFile(
        tsFile,
        `
/**
 * First function
 * @param {string} name - Name
 */
export function first(name: string) {}

/**
 * Second function
 * @param {number} wrong - Wrong param name
 */
export function second(correct: number) {}
`,
      );

      const checks = await detectDrift([tsFile], testDir);
      const drifted = checks.filter((c) => c.driftDetected);
      expect(drifted).toHaveLength(1);
      expect(drifted[0]!.name).toBe("second");
    });

    it("should handle JavaScript files", async () => {
      const jsFile = join(testDir, "test.js");
      await writeFile(
        jsFile,
        `
/**
 * Process items
 * @param {Array} items - Items to process
 * @param {Function} callback - Callback function
 */
function processItems(list, handler) {
  list.forEach(handler);
}
`,
      );

      const checks = await detectDrift([jsFile], testDir);
      expect(checks).toHaveLength(1);
      expect(checks[0]!.driftDetected).toBe(true);
    });

    it("should skip unsupported file types", async () => {
      const txtFile = join(testDir, "test.txt");
      await writeFile(txtFile, "Not a code file");

      const checks = await detectDrift([txtFile], testDir);
      expect(checks).toHaveLength(0);
    });

    it("should handle classes", async () => {
      const tsFile = join(testDir, "class.ts");
      await writeFile(
        tsFile,
        `
/**
 * User class
 * @param {string} name - User name
 * @param {number} age - User age
 */
export class User {
  constructor(username: string, age: number) {}
}
`,
      );

      const checks = await detectDrift([tsFile], testDir);
      expect(checks).toHaveLength(1);
      expect(checks[0]!.type).toBe("class");
      expect(checks[0]!.driftDetected).toBe(true);
    });

    it("should skip interfaces and types", async () => {
      const tsFile = join(testDir, "types.ts");
      await writeFile(
        tsFile,
        `
/**
 * User interface
 * @param name - Name
 */
export interface User {
  name: string;
}

/**
 * Config type
 * @param port - Port number
 */
export type Config = {
  port: number;
};
`,
      );

      const checks = await detectDrift([tsFile], testDir);
      // Interfaces and types shouldn't be checked for runtime drift
      const drifted = checks.filter((c) => c.driftDetected);
      expect(drifted).toHaveLength(0);
    });

    it("should handle files with parse errors gracefully", async () => {
      const badFile = join(testDir, "bad.ts");
      await writeFile(badFile, "This is not valid TypeScript { } [ ]");

      const checks = await detectDrift([badFile], testDir);
      // Should not throw, just skip the file
      expect(checks).toBeDefined();
    });

    it("should handle const arrow functions", async () => {
      const tsFile = join(testDir, "arrow.ts");
      await writeFile(
        tsFile,
        `
/**
 * Handle event
 * @param {Event} event - The event
 */
export const handleEvent = (evt: Event) => {
  console.log(evt);
};
`,
      );

      const checks = await detectDrift([tsFile], testDir);
      expect(checks).toHaveLength(1);
      expect(checks[0]!.driftDetected).toBe(true);
      expect(checks[0]!.driftReason).toContain("parameter name mismatch");
    });
  });
});
