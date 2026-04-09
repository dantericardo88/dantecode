import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Use vi.hoisted so the store is accessible inside the hoisted vi.mock factory
const { lessonStore } = vi.hoisted(() => ({
  lessonStore: [] as Array<{ type: string; pattern: string; correction: string; language?: string }>,
}));

// Mock the danteforge binary — simulates real behavior for e2e tests
vi.mock("@dantecode/danteforge", () => ({
  formatLessonsForPrompt: vi.fn((lessons: Array<{ pattern: string }>) =>
    lessons.map((l) => `- ${l.pattern}`).join("\n"),
  ),
  queryLessons: vi.fn(async (_opts: { language?: string; limit?: number }) =>
    lessonStore.slice(0, _opts?.limit ?? 10),
  ),
  recordLesson: vi.fn(
    async (opts: { type: string; pattern: string; correction: string; language?: string }) => {
      lessonStore.push(opts);
    },
  ),
  recordPreference: vi.fn(
    async (opts: { type?: string; pattern: string; correction: string; language?: string }) => {
      lessonStore.push({ ...opts, type: opts.type ?? "preference" });
    },
  ),
  recordSuccessPattern: vi.fn(
    async (opts: { pattern: string; correction: string; language?: string }) => {
      lessonStore.push({ ...opts, type: "success" });
    },
  ),
  // Called synchronously: runAntiStubScanner(code, projectRoot, filePath)
  runAntiStubScanner: vi.fn((_code: string, _projectRoot: string, filePath: string) => ({
    violations: [{ filePath, line: 2, kind: "todo", severity: "warn", message: "TODO found" }],
    hardViolations: [{ filePath, line: 2, kind: "stub", message: "stub" }],
    passed: false,
  })),
  // Called synchronously: runConstitutionCheck(code, filePath)
  runConstitutionCheck: vi.fn((_code: string, _filePath: string) => ({
    passed: true,
    violations: [],
  })),
  // Called synchronously: runLocalPDSEScorer(code, projectRoot)
  runLocalPDSEScorer: vi.fn((_code: string, _projectRoot: string) => ({
    overall: 0.9,
    passedGate: true,
    score: 0.9,
  })),
}));
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
    // Clear lesson store between tests to prevent cross-test contamination
    lessonStore.length = 0;
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
