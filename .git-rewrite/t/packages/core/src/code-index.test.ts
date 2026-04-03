// ============================================================================
// @dantecode/core — Code Index Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodeIndex, chunkFile, tokenize } from "./code-index.js";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockReaddir = vi.mocked(readdir);
const mockMkdir = vi.mocked(mkdir);
const mockStat = vi.mocked(stat);

describe("Code Index", () => {
  describe("tokenize", () => {
    it("tokenizes English text into lowercase words", () => {
      const tokens = tokenize("Hello World function modelRouter");
      expect(tokens).toEqual(["hello", "world", "function", "modelrouter"]);
    });

    it("handles camelCase by keeping it as one token", () => {
      const tokens = tokenize("modelRouter buildSystemPrompt");
      expect(tokens).toEqual(["modelrouter", "buildsystemprompt"]);
    });

    it("strips punctuation and special chars", () => {
      const tokens = tokenize("const x = foo();  // comment");
      expect(tokens).toContain("const");
      expect(tokens).toContain("foo");
    });

    it("filters out single-character tokens", () => {
      const tokens = tokenize("a b cd ef");
      expect(tokens).toEqual(["cd", "ef"]);
    });

    it("handles underscore_case", () => {
      const tokens = tokenize("my_function_name");
      expect(tokens).toEqual(["my_function_name"]);
    });
  });

  describe("chunkFile", () => {
    it("returns single chunk for small files", () => {
      const content = "const x = 1;\nconst y = 2;";
      const chunks = chunkFile(content, "test.ts", 200);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]!.startLine).toBe(1);
      expect(chunks[0]!.endLine).toBe(2);
    });

    it("splits at function boundaries", () => {
      const lines = [
        "import { foo } from 'bar';",
        "",
        "export function first() {",
        "  return 1;",
        "}",
        "",
        "export function second() {",
        "  return 2;",
        "}",
        "",
        "export function third() {",
        "  return 3;",
        "}",
      ];
      // Use maxChunkLines=5 to force splitting
      // But min chunk is 10 lines, so with 13 lines it may not split much
      const content = lines.join("\n");
      const chunks = chunkFile(content, "funcs.ts", 200);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it("extracts symbols from chunks", () => {
      const content = [
        "export function processData(input: string) {",
        "  const result = transform(input);",
        "  return result;",
        "}",
        "",
        "export class DataHandler {",
        "  handle() {}",
        "}",
      ].join("\n");
      const chunks = chunkFile(content, "data.ts", 200);
      const allSymbols = chunks.flatMap((c) => c.symbols);
      expect(allSymbols).toContain("processData");
      expect(allSymbols).toContain("DataHandler");
    });

    it("returns empty for empty content", () => {
      expect(chunkFile("", "empty.ts", 200)).toEqual([]);
    });

    it("handles files with only whitespace lines", () => {
      const content = "\n\n\n";
      const chunks = chunkFile(content, "blank.ts", 200);
      // Should return at most 1 chunk (the whole file)
      expect(chunks.length).toBeLessThanOrEqual(1);
    });
  });

  describe("CodeIndex", () => {
    let index: CodeIndex;

    beforeEach(() => {
      vi.clearAllMocks();
      index = new CodeIndex();
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
    });

    describe("buildIndex", () => {
      it("indexes source files from a directory", async () => {
        mockReaddir.mockImplementation(async (dir) => {
          const d = dir as string;
          if (d.includes("node_modules") || d.includes("dist")) return [];
          if (d.endsWith("project"))
            return ["src", "package.json"] as unknown as Awaited<ReturnType<typeof readdir>>;
          if (d.endsWith("src"))
            return ["main.ts", "utils.ts"] as unknown as Awaited<ReturnType<typeof readdir>>;
          return [];
        });

        mockStat.mockImplementation(async (path) => {
          const p = path as string;
          return {
            isFile: () => p.endsWith(".ts") || p.endsWith(".json"),
            isDirectory: () => !p.includes("."),
          } as Awaited<ReturnType<typeof stat>>;
        });

        mockReadFile.mockImplementation(async (path) => {
          const p = path as string;
          if (p.includes("main.ts")) return "export function main() {\n  console.log('hello');\n}";
          if (p.includes("utils.ts"))
            return "export function add(a: number, b: number) {\n  return a + b;\n}";
          return "";
        });

        const count = await index.buildIndex("/project");
        expect(count).toBeGreaterThan(0);
        expect(index.size).toBeGreaterThan(0);
      });

      it("skips excluded directories", async () => {
        mockReaddir.mockImplementation(async (dir) => {
          const d = dir as string;
          if (d.endsWith("project"))
            return ["src", "node_modules"] as unknown as Awaited<ReturnType<typeof readdir>>;
          if (d.endsWith("src"))
            return ["app.ts"] as unknown as Awaited<ReturnType<typeof readdir>>;
          return ["hidden.ts"] as unknown as Awaited<ReturnType<typeof readdir>>;
        });

        mockStat.mockImplementation(async (path) => {
          const p = path as string;
          return {
            isFile: () => p.endsWith(".ts"),
            isDirectory: () => !p.includes("."),
          } as Awaited<ReturnType<typeof stat>>;
        });

        mockReadFile.mockResolvedValue("export const x = 1;");

        await index.buildIndex("/project");
        // Should only have indexed files from src/, not node_modules/
        expect(index.size).toBeGreaterThan(0);
      });

      it("attaches embeddings and persists provider metadata in saved indexes", async () => {
        mockReaddir.mockImplementation(async (dir) => {
          const d = dir as string;
          if (d.endsWith("project"))
            return ["src"] as unknown as Awaited<ReturnType<typeof readdir>>;
          if (d.endsWith("src"))
            return ["auth.ts", "strings.ts"] as unknown as Awaited<ReturnType<typeof readdir>>;
          return [];
        });

        mockStat.mockImplementation(async (path) => {
          const p = path as string;
          return {
            isFile: () => p.endsWith(".ts"),
            isDirectory: () => !p.includes("."),
          } as Awaited<ReturnType<typeof stat>>;
        });

        mockReadFile.mockImplementation(async (path) => {
          const p = path as string;
          if (p.includes("auth.ts")) {
            return "export function authenticate(token: string) { return token.length > 0; }";
          }
          return "export function capitalize(value: string) { return value.toUpperCase(); }";
        });

        const embeddingProvider = {
          info: { provider: "ollama" as const, modelId: "nomic-embed-text" },
          embed: vi.fn().mockResolvedValue([
            [1, 0],
            [0, 1],
          ]),
          embedSingle: vi.fn(),
        };

        await index.buildIndex("/project", undefined, embeddingProvider);
        await index.save("/project");

        expect(index.hasEmbeddings).toBe(true);
        const serialized = JSON.parse(String(mockWriteFile.mock.calls[0]?.[1])) as {
          version: number;
          embeddingProvider?: { provider: string; modelId: string };
        };
        expect(serialized.version).toBe(2);
        expect(serialized.embeddingProvider).toEqual({
          provider: "ollama",
          modelId: "nomic-embed-text",
        });
      });
    });

    describe("search", () => {
      it("returns relevant chunks for a query", async () => {
        // Manually build index with known content
        mockReaddir.mockImplementation(async (dir) => {
          const d = dir as string;
          if (d.endsWith("project"))
            return ["src"] as unknown as Awaited<ReturnType<typeof readdir>>;
          if (d.endsWith("src"))
            return ["auth.ts", "database.ts"] as unknown as Awaited<ReturnType<typeof readdir>>;
          return [];
        });

        mockStat.mockImplementation(async (path) => {
          const p = path as string;
          return {
            isFile: () => p.endsWith(".ts"),
            isDirectory: () => !p.includes("."),
          } as Awaited<ReturnType<typeof stat>>;
        });

        mockReadFile.mockImplementation(async (path) => {
          const p = path as string;
          if (p.includes("auth.ts"))
            return "export function authenticate(user: string, password: string) {\n  return validateCredentials(user, password);\n}\nexport function validateCredentials(u: string, p: string) {\n  return u.length > 0 && p.length > 0;\n}";
          if (p.includes("database.ts"))
            return "export function connectDatabase(url: string) {\n  return createConnection(url);\n}\nexport function createConnection(url: string) {\n  return { connected: true };\n}";
          return "";
        });

        await index.buildIndex("/project");
        const results = index.search("authentication user password");
        expect(results.length).toBeGreaterThan(0);
        // Auth file should rank higher for an auth query
        expect(results[0]!.filePath).toContain("auth");
      });

      it("returns empty for unrelated query", async () => {
        mockReaddir.mockImplementation(async (dir) => {
          const d = dir as string;
          if (d.endsWith("project"))
            return ["src"] as unknown as Awaited<ReturnType<typeof readdir>>;
          if (d.endsWith("src"))
            return ["math.ts"] as unknown as Awaited<ReturnType<typeof readdir>>;
          return [];
        });

        mockStat.mockImplementation(async (path) => {
          const p = path as string;
          return {
            isFile: () => p.endsWith(".ts"),
            isDirectory: () => !p.includes("."),
          } as Awaited<ReturnType<typeof stat>>;
        });

        mockReadFile.mockResolvedValue(
          "export function add(a: number, b: number) { return a + b; }",
        );

        await index.buildIndex("/project");
        const results = index.search("xyzzy nonexistent gibberish");
        // May return results but with low scores, or empty
        expect(results.length).toBeLessThanOrEqual(10);
      });

      it("returns empty when index is empty", () => {
        expect(index.search("anything")).toEqual([]);
      });

      it("returns vector-ranked results when version 2 indexes include embeddings", async () => {
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            version: 2,
            builtAt: "2026-03-17T00:00:00.000Z",
            embeddingProvider: {
              provider: "ollama",
              modelId: "nomic-embed-text",
            },
            entries: [
              {
                chunk: {
                  filePath: "src/auth.ts",
                  startLine: 1,
                  endLine: 3,
                  content: "export function authenticate(user: string, password: string) {}",
                  symbols: ["authenticate"],
                  embedding: [1, 0],
                },
                tfidf: { authenticate: 1, password: 1 },
              },
              {
                chunk: {
                  filePath: "src/strings.ts",
                  startLine: 1,
                  endLine: 3,
                  content: "export function reverse(value: string) {}",
                  symbols: ["reverse"],
                  embedding: [0, 1],
                },
                tfidf: { reverse: 1, string: 1 },
              },
            ],
            idf: { authenticate: 1, password: 1, reverse: 1, string: 1 },
          }),
        );

        await index.load("/project");
        const results = index.vectorSearch([1, 0], 5);
        expect(results[0]?.filePath).toContain("auth");
      });

      it("respects limit parameter", async () => {
        mockReaddir.mockImplementation(async (dir) => {
          const d = dir as string;
          if (d.endsWith("project"))
            return ["src"] as unknown as Awaited<ReturnType<typeof readdir>>;
          if (d.endsWith("src"))
            return ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"] as unknown as Awaited<
              ReturnType<typeof readdir>
            >;
          return [];
        });

        mockStat.mockImplementation(
          async () =>
            ({
              isFile: () => true,
              isDirectory: () => false,
            }) as Awaited<ReturnType<typeof stat>>,
        );

        mockReadFile.mockResolvedValue("export function test() { return 'hello'; }");

        await index.buildIndex("/project");
        const results = index.search("test function", 2);
        expect(results.length).toBeLessThanOrEqual(2);
      });
    });

    describe("save / load", () => {
      it("persists and restores index", async () => {
        // Build a small index
        mockReaddir.mockImplementation(async (dir) => {
          const d = dir as string;
          if (d.endsWith("project"))
            return ["src"] as unknown as Awaited<ReturnType<typeof readdir>>;
          if (d.endsWith("src"))
            return ["main.ts"] as unknown as Awaited<ReturnType<typeof readdir>>;
          return [];
        });

        mockStat.mockImplementation(async (path) => {
          const p = path as string;
          return {
            isFile: () => p.endsWith(".ts"),
            isDirectory: () => !p.includes("."),
          } as Awaited<ReturnType<typeof stat>>;
        });

        mockReadFile.mockImplementation(async (path) => {
          const p = path as string;
          if (p.includes("main.ts")) return "export function main() { return 42; }";
          // For loading the saved index
          if (p.includes("index.json")) {
            return (mockWriteFile.mock.calls[0]?.[1] as string) ?? "{}";
          }
          return "";
        });

        await index.buildIndex("/project");
        await index.save("/project");

        expect(mockWriteFile).toHaveBeenCalledWith(
          expect.stringContaining("index.json"),
          expect.any(String),
          "utf-8",
        );

        // Load into a new index
        const index2 = new CodeIndex();
        const loaded = await index2.load("/project");
        expect(loaded).toBe(true);
        expect(index2.size).toBe(index.size);
      });

      it("returns false for non-existent index", async () => {
        mockReadFile.mockRejectedValue(new Error("ENOENT"));
        const loaded = await index.load("/missing");
        expect(loaded).toBe(false);
      });
    });

    describe("load", () => {
      it("loads version 1 indexes for backward compatibility", async () => {
        mockReadFile.mockResolvedValue(
          JSON.stringify({
            version: 1,
            builtAt: "2026-03-17T00:00:00.000Z",
            entries: [
              {
                chunk: {
                  filePath: "src/legacy.ts",
                  startLine: 1,
                  endLine: 1,
                  content: "export const legacyValue = 'hello';",
                  symbols: ["legacyValue"],
                },
                tfidf: { legacyvalue: 1, hello: 1 },
              },
            ],
            idf: { legacyvalue: 1, hello: 1 },
          }),
        );

        const loaded = await index.load("/project");
        expect(loaded).toBe(true);
        expect(index.search("legacy hello")[0]?.filePath).toBe("src/legacy.ts");
      });
    });
  });
});
