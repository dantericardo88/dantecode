import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SelfImprovementContext } from "@dantecode/config-types";

const {
  mockReadFile,
  mockWriteFile,
  mockMkdir,
  mockReaddir,
  mockStat,
  mockExecSync,
  mockExec,
  mockExecFile,
  mockAppendAuditEvent,
  mockResolvePreferredShell,
  mockAutoCommit,
  mockPushBranch,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockExecSync: vi.fn(),
  mockExec: vi.fn(),
  mockExecFile: vi.fn(),
  mockAppendAuditEvent: vi.fn().mockResolvedValue(undefined),
  mockResolvePreferredShell: vi.fn(() => "/bin/bash"),
  mockAutoCommit: vi.fn(),
  mockPushBranch: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: (...args: unknown[]) => mockExecSync(...args),
    exec: (...args: unknown[]) => mockExec(...args),
    execFile: (...args: unknown[]) => mockExecFile(...args),
  };
});

vi.mock("@dantecode/core", async () => {
  const policy = await vi.importActual<object>("../../core/src/self-improvement-policy.ts");
  const search = await vi.importActual<object>("../../core/src/search-synthesizer.ts");
  const providers = await vi.importActual<object>("../../core/src/search-providers.ts");
  const orchestrator = await vi.importActual<object>("../../core/src/web-search-orchestrator.ts");
  const reranker = await vi.importActual<object>("../../core/src/search-reranker.ts");
  return {
    ...policy,
    ...search,
    ...providers,
    ...orchestrator,
    ...reranker,
    appendAuditEvent: mockAppendAuditEvent,
    resolvePreferredShell: mockResolvePreferredShell,
  };
});

vi.mock("@dantecode/git-engine", () => ({
  autoCommit: (...args: unknown[]) => mockAutoCommit(...args),
  pushBranch: (...args: unknown[]) => mockPushBranch(...args),
}));

import { executeTool, getToolDefinitions, type CliToolExecutionContext } from "./tools.js";

function makeContext(overrides: Partial<CliToolExecutionContext> = {}): CliToolExecutionContext {
  return {
    sessionId: "session-1",
    roundId: "round-1",
    readTracker: new Map(),
    editAttempts: new Map(),
    sandboxEnabled: false,
    ...overrides,
  };
}

function makeSelfImprovement(): SelfImprovementContext {
  return {
    enabled: true,
    workflowId: "autoforge-self-improve",
    triggerCommand: "/autoforge --self-improve",
    allowedRoots: ["/proj/packages/cli", "/proj/packages/core", "/proj/.dantecode"],
  };
}

describe("cli tools hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    mockReaddir.mockReset();
    mockStat.mockReset();
    mockExecSync.mockReset();
    mockResolvePreferredShell.mockReset();
    mockResolvePreferredShell.mockReturnValue("/bin/bash");
    mockAutoCommit.mockReset();
    mockPushBranch.mockReset();
  });

  it("blocks protected writes outside explicit self-improvement mode", async () => {
    const result = await executeTool(
      "Write",
      { file_path: "packages/cli/src/tools.ts", content: "export {};" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Self-modification blocked");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/proj",
      expect.objectContaining({ type: "self_modification_denied" }),
    );
  });

  it("allows protected writes in explicit self-improvement mode", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await executeTool(
      "Write",
      { file_path: "packages/cli/src/tools.ts", content: "export {};" },
      "/proj",
      makeContext({ selfImprovement: makeSelfImprovement() }),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Successfully wrote");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/proj",
      expect.objectContaining({ type: "self_modification_allowed" }),
    );
  });

  it("rejects repo-internal cd chains for Bash", async () => {
    const result = await executeTool(
      "Bash",
      { command: "cd packages/cli && npm test" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Run this from the repository root");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("requires a recent full-file Read before Edit", async () => {
    const result = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "old", new_string: "new" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Read the full current file before Edit");
  });

  it("returns current file contents after the first edit mismatch", async () => {
    const context = makeContext();
    mockReadFile.mockResolvedValueOnce("line 1\nline 2\n");

    const readResult = await executeTool("Read", { file_path: "src/app.ts" }, "/proj", context);
    expect(readResult.isError).toBe(false);

    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    const result = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("old_string not found");
    expect(result.content).toContain("Latest file contents");
  });

  it("forces whole-file rewrite guidance on the second identical edit failure", async () => {
    const context = makeContext();
    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    await executeTool("Read", { file_path: "src/app.ts" }, "/proj", context);

    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    const second = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    expect(second.isError).toBe(true);
    expect(second.content).toContain("Use Write with the full updated file");
  });

  it("blocks a third identical edit attempt in the same round", async () => {
    const context = makeContext();
    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    await executeTool("Read", { file_path: "src/app.ts" }, "/proj", context);

    for (let i = 0; i < 2; i++) {
      mockReadFile.mockResolvedValueOnce("const value = 1;\n");
      await executeTool(
        "Edit",
        { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
        "/proj",
        context,
      );
    }

    const third = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    expect(third.isError).toBe(true);
    expect(third.content).toContain("Third identical Edit attempt blocked");
  });

  it("uses the shared preferred shell for Bash commands", async () => {
    mockExecSync.mockReturnValue("tests passed");
    mockResolvePreferredShell.mockReturnValue("C:\\Program Files\\Git\\bin\\bash.exe");

    const result = await executeTool("Bash", { command: "npm test" }, "/proj", makeContext());

    expect(result.isError).toBe(false);
    expect(mockExecSync).toHaveBeenCalledWith(
      "npm test",
      expect.objectContaining({
        shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      }),
    );
  });

  it("routes GitPush through git-engine with verification details", async () => {
    mockPushBranch.mockReturnValue({
      remote: "origin",
      branch: "main",
      localCommit: "abc123",
      remoteCommit: "abc123",
      output: "Everything up-to-date",
      setUpstream: true,
    });

    const result = await executeTool(
      "GitPush",
      { remote: "origin", branch: "main", set_upstream: true },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Push verified");
    expect(mockPushBranch).toHaveBeenCalledWith(
      { remote: "origin", branch: "main", setUpstream: true },
      "/proj",
    );
  });

  it("blocks GitPush while sandbox mode is enabled", async () => {
    const result = await executeTool(
      "GitPush",
      { remote: "origin", branch: "main" },
      "/proj",
      makeContext({ sandboxEnabled: true }),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Sandbox");
    expect(mockPushBranch).not.toHaveBeenCalled();
  });

  it("advertises GitPush in the available tool definitions", () => {
    expect(getToolDefinitions().some((tool) => tool.name === "GitPush")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WebSearch + WebFetch Tools
// ---------------------------------------------------------------------------

describe("WebSearch tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns error when query is missing", async () => {
    const result = await executeTool("WebSearch", {}, "/proj", makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("query parameter is required");
  });

  it("returns structured search results from DuckDuckGo HTML", async () => {
    const mockHtml = `
      <div class="result results_links results_links_deep web-result">
        <div class="links_main links_deep result__body">
          <a class="result__a" href="https://example.com/page1">Example Page One</a>
          <a class="result__snippet">A snippet describing the first result.</a>
        </div>
      </div>
      <div class="result results_links results_links_deep web-result">
        <div class="links_main links_deep result__body">
          <a class="result__a" href="https://example.com/page2">Example Page Two</a>
          <a class="result__snippet">Second result snippet here.</a>
        </div>
      </div>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    });

    const result = await executeTool("WebSearch", { query: "test query" }, "/proj", makeContext());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Search results for");
    expect(result.content).toContain("Example Page One");
    expect(result.content).toContain("https://example.com/page1");
  });

  it("falls back to link extraction when structured parsing fails", async () => {
    const mockHtml = `
      <html><body>
        <a href="https://github.com/test/repo">Test Repository</a>
        <a href="https://docs.example.com/guide">Documentation Guide</a>
      </body></html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    });

    const result = await executeTool("WebSearch", { query: "fallback test" }, "/proj", makeContext());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("https://github.com/test/repo");
  });

  it("returns no results message when page has no links", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("<html><body>No results here</body></html>"),
    });

    const result = await executeTool("WebSearch", { query: "empty query" }, "/proj", makeContext());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("No search results found");
  });

  it("handles HTTP errors gracefully (returns no results)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    const result = await executeTool("WebSearch", { query: "rate limited" }, "/proj", makeContext());
    // Multi-engine search degrades gracefully: returns no results instead of hard error
    expect(result.isError).toBe(false);
    expect(result.content).toContain("No search results");
  });

  it("handles network errors gracefully (returns no results)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const result = await executeTool("WebSearch", { query: "timeout test" }, "/proj", makeContext());
    // Multi-engine search degrades gracefully: returns no results instead of hard error
    expect(result.isError).toBe(false);
    expect(result.content).toContain("No search results");
  });

  it("uses cache for repeated queries", async () => {
    const mockHtml = `
      <html><body>
        <a href="https://cached.example.com/page">Cached Result</a>
      </body></html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
    });

    const result1 = await executeTool("WebSearch", { query: "cache test query xyz" }, "/proj", makeContext());
    const result2 = await executeTool("WebSearch", { query: "cache test query xyz" }, "/proj", makeContext());

    expect(result1.content).toBe(result2.content);
    // fetch should only be called once (second uses cache)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("WebFetch tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns error when url is missing", async () => {
    const result = await executeTool("WebFetch", {}, "/proj", makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("url parameter is required");
  });

  it("rejects invalid URLs", async () => {
    const result = await executeTool("WebFetch", { url: "not-a-url" }, "/proj", makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("invalid URL");
  });

  it("rejects non-HTTP protocols", async () => {
    const result = await executeTool("WebFetch", { url: "ftp://example.com/file" }, "/proj", makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("only HTTP/HTTPS");
  });

  it("converts HTML to readable text", async () => {
    const mockHtml = `
      <html><head><title>Test</title></head>
      <body>
        <h1>Hello World</h1>
        <p>This is a <strong>test</strong> paragraph.</p>
        <script>console.log('removed');</script>
      </body></html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
      headers: new Map([["content-type", "text/html"]]),
    });

    const result = await executeTool("WebFetch", { url: "https://example.com" }, "/proj", makeContext());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Hello World");
    expect(result.content).toContain("test paragraph");
    expect(result.content).not.toContain("console.log");
  });

  it("returns JSON as-is without conversion", async () => {
    const mockJson = '{"name": "test", "value": 42}';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockJson),
      headers: new Map([["content-type", "application/json"]]),
    });

    const result = await executeTool("WebFetch", { url: "https://api.example.com/data" }, "/proj", makeContext());
    expect(result.isError).toBe(false);
    expect(result.content).toContain('"name": "test"');
    expect(result.content).toContain('"value": 42');
  });

  it("truncates content exceeding max_chars", async () => {
    const longContent = "x".repeat(5000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(longContent),
      headers: new Map([["content-type", "text/plain"]]),
    });

    const result = await executeTool(
      "WebFetch",
      { url: "https://example.com/long", max_chars: 100 },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toContain("truncated at 100 chars");
  });

  it("handles HTTP errors gracefully", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const result = await executeTool("WebFetch", { url: "https://example.com/missing" }, "/proj", makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("HTTP 404");
  });

  it("returns raw content when raw flag is true", async () => {
    const rawHtml = "<h1>Raw HTML</h1><p>Not converted</p>";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(rawHtml),
      headers: new Map([["content-type", "text/html"]]),
    });

    const result = await executeTool(
      "WebFetch",
      { url: "https://example.com/raw", raw: true },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(false);
    expect(result.content).toContain("<h1>Raw HTML</h1>");
    expect(result.content).toContain("<p>Not converted</p>");
  });

  it("extracts page metadata (title and description)", async () => {
    const mockHtml = `
      <html>
      <head>
        <title>Project Documentation</title>
        <meta name="description" content="Learn how to use the project API.">
      </head>
      <body><main><p>Main content here.</p></main></body>
      </html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
      headers: new Map([["content-type", "text/html"]]),
    });

    const result = await executeTool("WebFetch", { url: "https://docs.example.com" }, "/proj", makeContext());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Title: Project Documentation");
    expect(result.content).toContain("Description: Learn how to use the project API.");
  });

  it("extracts main content from article tag", async () => {
    const mockHtml = `
      <html><body>
        <nav>Navigation links here</nav>
        <article>
          <h1>Important Article</h1>
          <p>This is the main content that should be extracted. It needs to be long enough to pass the 200 char threshold so let me add more words here to ensure the extraction works properly and returns this block.</p>
        </article>
        <footer>Footer content here</footer>
      </body></html>
    `;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(mockHtml),
      headers: new Map([["content-type", "text/html"]]),
    });

    const result = await executeTool("WebFetch", { url: "https://blog.example.com/post" }, "/proj", makeContext());
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Important Article");
    expect(result.content).toContain("main content that should be extracted");
  });

  it("advertises WebSearch and WebFetch in tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools.some((t) => t.name === "WebSearch")).toBe(true);
    expect(tools.some((t) => t.name === "WebFetch")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SubAgent Tool
// ---------------------------------------------------------------------------

describe("SubAgent tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when prompt is missing", async () => {
    const result = await executeTool("SubAgent", {}, "/proj", makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("prompt parameter is required");
  });

  it("returns error when no subAgentExecutor is set", async () => {
    const result = await executeTool(
      "SubAgent",
      { prompt: "search for files" },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Sub-agent execution is not available");
  });

  it("returns successful result from sub-agent executor", async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      output: "Found 3 relevant files and updated them.",
      touchedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
      durationMs: 1500,
      success: true,
    });

    const result = await executeTool(
      "SubAgent",
      { prompt: "find and update files" },
      "/proj",
      makeContext({ subAgentExecutor: mockExecutor }),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("completed successfully");
    expect(result.content).toContain("1500ms");
    expect(result.content).toContain("src/a.ts");
    expect(result.content).toContain("src/b.ts");
    expect(result.content).toContain("Files modified (3)");
    expect(mockExecutor).toHaveBeenCalledWith("find and update files", {
      maxRounds: 30,
      background: false,
      worktreeIsolation: false,
    });
  });

  it("passes max_rounds option to executor", async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      output: "done",
      touchedFiles: [],
      durationMs: 100,
      success: true,
    });

    await executeTool(
      "SubAgent",
      { prompt: "quick task", max_rounds: 10 },
      "/proj",
      makeContext({ subAgentExecutor: mockExecutor }),
    );

    expect(mockExecutor).toHaveBeenCalledWith("quick task", {
      maxRounds: 10,
      background: false,
      worktreeIsolation: false,
    });
  });

  it("caps max_rounds at 100", async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      output: "done",
      touchedFiles: [],
      durationMs: 100,
      success: true,
    });

    await executeTool(
      "SubAgent",
      { prompt: "long task", max_rounds: 500 },
      "/proj",
      makeContext({ subAgentExecutor: mockExecutor }),
    );

    expect(mockExecutor).toHaveBeenCalledWith("long task", {
      maxRounds: 100,
      background: false,
      worktreeIsolation: false,
    });
  });

  it("returns error result when sub-agent fails", async () => {
    const mockExecutor = vi.fn().mockResolvedValue({
      output: "partial work done",
      touchedFiles: [],
      durationMs: 5000,
      success: false,
      error: "Context window exceeded",
    });

    const result = await executeTool(
      "SubAgent",
      { prompt: "complex task" },
      "/proj",
      makeContext({ subAgentExecutor: mockExecutor }),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Sub-agent failed");
    expect(result.content).toContain("Context window exceeded");
    expect(result.content).toContain("partial work done");
  });

  it("handles executor exceptions gracefully", async () => {
    const mockExecutor = vi.fn().mockRejectedValue(new Error("Network timeout"));

    const result = await executeTool(
      "SubAgent",
      { prompt: "failing task" },
      "/proj",
      makeContext({ subAgentExecutor: mockExecutor }),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Network timeout");
  });

  it("advertises SubAgent in tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools.some((t) => t.name === "SubAgent")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GitHubSearch Tool
// ---------------------------------------------------------------------------

describe("GitHubSearch tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReset();
    mockResolvePreferredShell.mockReturnValue("/bin/bash");
  });

  it("returns error when query is missing", async () => {
    const result = await executeTool("GitHubSearch", {}, "/proj", makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain("query parameter is required");
  });

  it("rejects invalid search type", async () => {
    const result = await executeTool(
      "GitHubSearch",
      { query: "test", type: "invalid" },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("type must be one of");
  });

  it("searches repos and formats results", async () => {
    mockExecSync.mockReturnValue(JSON.stringify([
      {
        name: "awesome-project",
        url: "https://github.com/user/awesome-project",
        description: "An awesome project",
        stargazersCount: 1234,
        language: "TypeScript",
        updatedAt: "2026-03-15T00:00:00Z",
      },
      {
        name: "cool-lib",
        url: "https://github.com/user/cool-lib",
        description: "A cool library",
        stargazersCount: 567,
        language: "JavaScript",
        updatedAt: "2026-03-10T00:00:00Z",
      },
    ]));

    const result = await executeTool(
      "GitHubSearch",
      { query: "awesome typescript" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("awesome-project");
    expect(result.content).toContain("1234 stars");
    expect(result.content).toContain("TypeScript");
    expect(result.content).toContain("cool-lib");
  });

  it("searches issues with correct command", async () => {
    mockExecSync.mockReturnValue(JSON.stringify([
      {
        title: "Bug: crash on startup",
        url: "https://github.com/user/repo/issues/42",
        state: "OPEN",
        repository: { nameWithOwner: "user/repo" },
        createdAt: "2026-03-12T00:00:00Z",
        labels: [{ name: "bug" }],
      },
    ]));

    const result = await executeTool(
      "GitHubSearch",
      { query: "crash startup", type: "issues", limit: 5 },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Bug: crash on startup");
    expect(result.content).toContain("OPEN");
    expect(result.content).toContain("user/repo");
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("gh search issues"),
      expect.objectContaining({ cwd: "/proj" }),
    );
  });

  it("returns no results message when search returns empty", async () => {
    mockExecSync.mockReturnValue("[]");

    const result = await executeTool(
      "GitHubSearch",
      { query: "nonexistent thing" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("No repos found");
  });

  it("handles gh not installed error", async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("Command failed") as Error & { stderr: string };
      err.stderr = "gh: command not found";
      throw err;
    });

    const result = await executeTool(
      "GitHubSearch",
      { query: "test" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("not installed");
  });

  it("handles gh not authenticated error", async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("Command failed") as Error & { stderr: string };
      err.stderr = "To get started with GitHub CLI, please run: gh auth login";
      throw err;
    });

    const result = await executeTool(
      "GitHubSearch",
      { query: "test" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("not authenticated");
  });

  it("advertises GitHubSearch in tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools.some((t) => t.name === "GitHubSearch")).toBe(true);
  });
});

// ============================================================================
// GitHubOps tool
// ============================================================================

describe("GitHubOps tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReset();
    mockResolvePreferredShell.mockReturnValue("/bin/bash");
  });

  it("rejects invalid action", async () => {
    const result = await executeTool(
      "GitHubOps",
      { action: "invalid_action" },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("action must be one of");
  });

  it("delegates search_repos to GitHubSearch", async () => {
    mockExecSync.mockReturnValue(JSON.stringify([
      {
        name: "test-repo",
        url: "https://github.com/user/test-repo",
        description: "A test",
        stargazersCount: 42,
        language: "TypeScript",
        updatedAt: "2026-03-15T00:00:00Z",
      },
    ]));

    const result = await executeTool(
      "GitHubOps",
      { action: "search_repos", query: "test" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("test-repo");
    expect(result.content).toContain("42 stars");
  });

  it("creates a PR with title and body", async () => {
    mockExecSync.mockReturnValue("https://github.com/user/repo/pull/99\n");

    const result = await executeTool(
      "GitHubOps",
      { action: "create_pr", title: "Add feature X", body: "This PR adds feature X" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("PR created");
    expect(result.content).toContain("pull/99");
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("gh pr create"),
      expect.objectContaining({ cwd: "/proj" }),
    );
  });

  it("creates a draft PR with base branch", async () => {
    mockExecSync.mockReturnValue("https://github.com/user/repo/pull/100\n");

    const result = await executeTool(
      "GitHubOps",
      { action: "create_pr", title: "WIP: feature", base: "develop", draft: true },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    const cmd = mockExecSync.mock.calls[0]![0] as string;
    expect(cmd).toContain("--draft");
    expect(cmd).toContain("--base");
  });

  it("returns error when create_pr missing title", async () => {
    const result = await executeTool(
      "GitHubOps",
      { action: "create_pr" },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("title is required");
  });

  it("views a PR with structured output", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      title: "Fix bug",
      state: "OPEN",
      url: "https://github.com/user/repo/pull/42",
      body: "Fixes the crash",
      author: { login: "dev" },
      reviewDecision: "APPROVED",
      mergeable: "MERGEABLE",
      additions: 10,
      deletions: 3,
      changedFiles: 2,
    }));

    const result = await executeTool(
      "GitHubOps",
      { action: "view_pr", number: 42 },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Fix bug");
    expect(result.content).toContain("OPEN");
    expect(result.content).toContain("APPROVED");
    expect(result.content).toContain("+10 -3");
  });

  it("reviews a PR with approve", async () => {
    mockExecSync.mockReturnValue("Approved");

    const result = await executeTool(
      "GitHubOps",
      { action: "review_pr", number: 42, review_action: "approve", body: "LGTM" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("reviewed (approve)");
    const cmd = mockExecSync.mock.calls[0]![0] as string;
    expect(cmd).toContain("--approve");
  });

  it("rejects invalid review action", async () => {
    const result = await executeTool(
      "GitHubOps",
      { action: "review_pr", number: 42, review_action: "reject" },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("review_action must be one of");
  });

  it("merges a PR with squash", async () => {
    mockExecSync.mockReturnValue("Merged");

    const result = await executeTool(
      "GitHubOps",
      { action: "merge_pr", number: 42, merge_method: "squash" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("merged (squash)");
    const cmd = mockExecSync.mock.calls[0]![0] as string;
    expect(cmd).toContain("--squash");
  });

  it("rejects invalid merge method", async () => {
    const result = await executeTool(
      "GitHubOps",
      { action: "merge_pr", number: 42, merge_method: "fast-forward" },
      "/proj",
      makeContext(),
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("merge_method must be one of");
  });

  it("lists open PRs", async () => {
    mockExecSync.mockReturnValue(JSON.stringify([
      {
        number: 1,
        title: "First PR",
        state: "OPEN",
        url: "https://github.com/user/repo/pull/1",
        author: { login: "dev1" },
        headRefName: "feature-a",
      },
      {
        number: 2,
        title: "Second PR",
        state: "OPEN",
        url: "https://github.com/user/repo/pull/2",
        author: { login: "dev2" },
        headRefName: "feature-b",
      },
    ]));

    const result = await executeTool(
      "GitHubOps",
      { action: "list_prs", state: "open" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("First PR");
    expect(result.content).toContain("Second PR");
    expect(result.content).toContain("feature-a");
  });

  it("creates an issue with labels", async () => {
    mockExecSync.mockReturnValue("https://github.com/user/repo/issues/55\n");

    const result = await executeTool(
      "GitHubOps",
      { action: "create_issue", title: "Bug report", body: "Steps to reproduce", labels: "bug,critical" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Issue created");
    const cmd = mockExecSync.mock.calls[0]![0] as string;
    expect(cmd).toContain("--label");
  });

  it("comments on an issue", async () => {
    mockExecSync.mockReturnValue("");

    const result = await executeTool(
      "GitHubOps",
      { action: "comment_issue", number: 55, body: "Working on this now" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Comment added to #55");
  });

  it("closes an issue", async () => {
    mockExecSync.mockReturnValue("");

    const result = await executeTool(
      "GitHubOps",
      { action: "close_issue", number: 55, reason: "completed" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Issue #55 closed");
  });

  it("triggers a workflow", async () => {
    mockExecSync.mockReturnValue("");

    const result = await executeTool(
      "GitHubOps",
      { action: "trigger_workflow", workflow: "ci.yml", ref: "main" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Workflow triggered");
  });

  it("views a workflow run", async () => {
    mockExecSync.mockReturnValue(JSON.stringify({
      name: "CI",
      status: "completed",
      conclusion: "success",
      url: "https://github.com/user/repo/actions/runs/123",
      headBranch: "main",
      event: "push",
      createdAt: "2026-03-18T10:00:00Z",
      updatedAt: "2026-03-18T10:05:00Z",
    }));

    const result = await executeTool(
      "GitHubOps",
      { action: "view_run", run_id: "123" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("CI");
    expect(result.content).toContain("completed");
    expect(result.content).toContain("success");
  });

  it("handles gh not installed", async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("Command failed") as Error & { stderr: string };
      err.stderr = "gh: command not found";
      throw err;
    });

    const result = await executeTool(
      "GitHubOps",
      { action: "create_pr", title: "test" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("not installed");
  });

  it("handles gh not authenticated", async () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("Command failed") as Error & { stderr: string };
      err.stderr = "To get started with GitHub CLI, please run: gh auth login";
      throw err;
    });

    const result = await executeTool(
      "GitHubOps",
      { action: "view_pr", number: 1 },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("not authenticated");
  });

  it("advertises GitHubOps in tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools.some((t) => t.name === "GitHubOps")).toBe(true);
  });
});
