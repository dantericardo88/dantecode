import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodeIndex } from "@dantecode/core";
import { createDefaultToolHandlers } from "./default-tool-handlers.js";

describe("MCP wave integrations", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-mcp-e2e-"));
    await mkdir(join(projectRoot, "src"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("runs semantic search against a saved code index", async () => {
    await writeFile(
      join(projectRoot, "src", "math.ts"),
      [
        "export function add(a: number, b: number): number {",
        "  return a + b;",
        "}",
        "",
        "export function multiply(a: number, b: number): number {",
        "  return a * b;",
        "}",
      ].join("\n"),
      "utf-8",
    );
    await writeFile(
      join(projectRoot, "src", "strings.ts"),
      [
        "export function capitalize(value: string): string {",
        "  return value.charAt(0).toUpperCase() + value.slice(1);",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const index = new CodeIndex();
    await index.buildIndex(projectRoot);
    await index.save(projectRoot);

    const handlers = createDefaultToolHandlers();
    const semanticSearch = handlers["semantic_search"]!;
    const response = await semanticSearch({
      projectRoot,
      query: "add return number",
      limit: 3,
    });
    const parsed = JSON.parse(response) as {
      mode: string;
      results: Array<{ filePath: string }>;
    };

    expect(parsed.mode).toBe("tfidf");
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results[0]?.filePath).toBe("src/math.ts");
  });

  it("records and queries lessons through the default handlers", async () => {
    const handlers = createDefaultToolHandlers();

    await handlers["record_lesson"]!({
      projectRoot,
      pattern: "Avoid TODO markers in shipping code",
      correction: "Replace TODOs with complete implementations before merging",
      type: "success",
      severity: "info",
      language: "typescript",
    });

    const response = await handlers["lessons_query"]!({
      projectRoot,
      language: "typescript",
      limit: 5,
    });
    const parsed = JSON.parse(response) as {
      count: number;
      lessons: Array<{ type: string; pattern: string }>;
      prompt: string;
    };

    expect(parsed.count).toBe(1);
    expect(parsed.lessons[0]?.type).toBe("success");
    expect(parsed.prompt).toContain("Avoid TODO markers");
  });

  it("verifies files and reports failing autoforge gates", async () => {
    await writeFile(
      join(projectRoot, "src", "todo.ts"),
      [
        "export function unfinishedTask(): string {",
        "  // TODO finish this implementation",
        "  return 'stub';",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const handlers = createDefaultToolHandlers();
    const response = await handlers["autoforge_verify"]!({
      projectRoot,
      taskDescription: "Verify the unfinished task implementation",
      filePaths: ["src/todo.ts"],
    });
    const parsed = JSON.parse(response) as {
      succeeded: boolean;
      verifiedFiles: number;
      files: Array<{ filePath: string; antiStubPassed: boolean; hardViolations: number }>;
    };

    expect(parsed.succeeded).toBe(false);
    expect(parsed.verifiedFiles).toBe(1);
    expect(parsed.files[0]?.filePath).toBe("src/todo.ts");
    expect(parsed.files[0]?.antiStubPassed).toBe(false);
    expect(parsed.files[0]?.hardViolations).toBeGreaterThan(0);
  });
});
