import { describe, expect, it, vi } from "vitest";

// Mock vscode module (inline-edit.ts imports it)
vi.mock("vscode", () => ({
  Uri: { parse: (s: string) => ({ toString: () => s }), file: (s: string) => ({ fsPath: s }) },
  window: {
    showInputBox: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(),
    activeTextEditor: undefined,
  },
  workspace: { workspaceFolders: [] },
  ProgressLocation: { Notification: 15 },
  Range: class { constructor(public sl: number, public sc: number, public el: number, public ec: number) {} },
  Selection: class { constructor(public start: unknown, public end: unknown) {} },
  commands: { executeCommand: vi.fn() },
}));

// Mock @dantecode/core (ModelRouterImpl)
vi.mock("@dantecode/core", () => ({
  ModelRouterImpl: vi.fn(),
}));

// Mock diff-viewer (DiffContentCache)
vi.mock("./ui-enhancements/diff-viewer.js", () => ({
  DiffContentCache: { set: vi.fn(), get: vi.fn(), clear: vi.fn(), clearAll: vi.fn() },
}));

import {
  stripMarkdownFences,
  parseModelString,
  buildEditSystemPrompt,
  buildEditUserPrompt,
} from "./inline-edit.js";

describe("inline-edit helpers", () => {
  describe("stripMarkdownFences", () => {
    it("strips opening and closing fences", () => {
      expect(stripMarkdownFences("```typescript\nconst x = 1;\n```")).toBe("const x = 1;");
    });

    it("strips fences without language tag", () => {
      expect(stripMarkdownFences("```\ncode\n```")).toBe("code");
    });

    it("returns text unchanged if no fences", () => {
      expect(stripMarkdownFences("const x = 1;")).toBe("const x = 1;");
    });

    it("handles empty string", () => {
      expect(stripMarkdownFences("")).toBe("");
    });

    it("handles multiline code with fences", () => {
      const input = "```js\nfunction foo() {\n  return 1;\n}\n```";
      expect(stripMarkdownFences(input)).toBe("function foo() {\n  return 1;\n}");
    });

    it("only strips outermost fences", () => {
      const input = "```\nconst md = `\\`\\`\\`code\\`\\`\\``;\n```";
      const result = stripMarkdownFences(input);
      expect(result).toContain("const md");
    });
  });

  describe("parseModelString", () => {
    it("parses provider/modelId format", () => {
      expect(parseModelString("anthropic/claude-sonnet-4-6")).toEqual({
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
      });
    });

    it("parses grok model", () => {
      expect(parseModelString("grok/grok-3")).toEqual({
        provider: "grok",
        modelId: "grok-3",
      });
    });

    it("defaults to grok provider when no slash", () => {
      expect(parseModelString("grok-3")).toEqual({
        provider: "grok",
        modelId: "grok-3",
      });
    });

    it("handles ollama models", () => {
      expect(parseModelString("ollama/llama3.1:8b")).toEqual({
        provider: "ollama",
        modelId: "llama3.1:8b",
      });
    });
  });

  describe("buildEditSystemPrompt", () => {
    it("includes language and file path", () => {
      const prompt = buildEditSystemPrompt("typescript", "/src/app.ts");
      expect(prompt).toContain("Language: typescript");
      expect(prompt).toContain("File: /src/app.ts");
    });

    it("includes code editor instruction", () => {
      const prompt = buildEditSystemPrompt("python", "main.py");
      expect(prompt).toContain("precise code editor");
      expect(prompt).toContain("ONLY the replacement code");
    });

    it("includes indentation preservation instruction", () => {
      const prompt = buildEditSystemPrompt("go", "main.go");
      expect(prompt).toContain("indentation");
    });
  });

  describe("buildEditUserPrompt", () => {
    it("includes instruction and selected code", () => {
      const prompt = buildEditUserPrompt(
        "Add error handling",
        "return fetch(url);",
        "const url = 'https://api.example.com';",
        "console.log('done');",
      );
      expect(prompt).toContain("## Instruction\nAdd error handling");
      expect(prompt).toContain("return fetch(url);");
    });

    it("handles empty context before", () => {
      const prompt = buildEditUserPrompt("fix", "code", "", "after");
      expect(prompt).toContain("(start of file)");
    });

    it("handles empty context after", () => {
      const prompt = buildEditUserPrompt("fix", "code", "before", "");
      expect(prompt).toContain("(end of file)");
    });

    it("includes all sections", () => {
      const prompt = buildEditUserPrompt("refactor", "old code", "before", "after");
      expect(prompt).toContain("Context Before Selection");
      expect(prompt).toContain("Selected Code (replace this)");
      expect(prompt).toContain("Context After Selection");
      expect(prompt).toContain("ONLY the replacement code");
    });
  });
});
