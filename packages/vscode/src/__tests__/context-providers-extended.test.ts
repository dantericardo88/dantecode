// ============================================================================
// packages/vscode/src/__tests__/context-providers-extended.test.ts
// 10 tests for the new context providers (Machine 3 + Machine 4 SDK)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock vscode before any imports that need it
vi.mock("vscode", () => ({
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(() => "none") })), asRelativePath: vi.fn((u: { fsPath: string }) => u.fsPath) },
  window: { activeTextEditor: null, visibleTextEditors: [], terminals: [], activeTerminal: null, createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })) },
  languages: { getDiagnostics: vi.fn(() => []) },
  env: { clipboard: { readText: vi.fn(async () => "test clipboard text") } },
  debug: {
    onDidStartDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
    onDidTerminateDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
    onDidReceiveDebugSessionCustomEvent: vi.fn(() => ({ dispose: vi.fn() })),
    registerDebugAdapterTrackerFactory: vi.fn(() => ({ dispose: vi.fn() })),
    activeDebugSession: undefined,
    customRequest: vi.fn(),
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  Uri: { parse: vi.fn((s: string) => ({ fsPath: s, toString: () => s })) },
  commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })) },
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
}));

// Mock child_process for execSync calls in providers
vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes("git log")) return "src/auth.ts\nsrc/user.ts\n";
    if (cmd.includes("git diff")) return "diff --git a/src/auth.ts b/src/auth.ts\n+added line";
    return "";
  }),
}));

import {
  TREE_PROVIDER,
  RECENT_PROVIDER,
  DIFF_PROVIDER,
  OS_PROVIDER,
  HTTP_PROVIDER,
  parseAllMentions,
  globalContextRegistry,
} from "../context-provider.js";
import {
  registerExternalProvider,
  unregisterExternalProvider,
  listExternalProviders,
} from "../context-provider-sdk.js";

const WORKSPACE = "/tmp/test-workspace";

describe("TREE_PROVIDER", () => {
  it("returns content that looks like a directory listing", async () => {
    const result = await TREE_PROVIDER.resolve("", WORKSPACE);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("tree");
    expect(result[0]!.label).toBe("@tree");
    // Content is a string (even if workspace doesn't exist, returns "." at minimum)
    expect(typeof result[0]!.content).toBe("string");
    expect(result[0]!.content.length).toBeGreaterThanOrEqual(1);
  });
});

describe("RECENT_PROVIDER", () => {
  it("invokes git log --since and returns file list", async () => {
    const { execSync } = await import("node:child_process");
    const result = await RECENT_PROVIDER.resolve("", WORKSPACE);
    expect(execSync).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("recent");
    expect(result[0]!.content).toContain("auth.ts");
  });
});

describe("DIFF_PROVIDER", () => {
  it("returns diff content when git diff succeeds", async () => {
    const result = await DIFF_PROVIDER.resolve("", WORKSPACE);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("diff");
    expect(result[0]!.content).toContain("diff");
  });
});

describe("OS_PROVIDER", () => {
  it("returns platform and arch info", async () => {
    const result = await OS_PROVIDER.resolve("", WORKSPACE);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("os");
    expect(result[0]!.content).toContain("platform:");
    expect(result[0]!.content).toContain("arch:");
    expect(result[0]!.content).toContain("node:");
  });
});

describe("HTTP_PROVIDER", () => {
  it("returns error item for empty query without throwing", async () => {
    const result = await HTTP_PROVIDER.resolve("", WORKSPACE);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("https://");
  });

  it("returns error item for http:// (non-https) URLs", async () => {
    const result = await HTTP_PROVIDER.resolve("http://example.com", WORKSPACE);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("https://");
  });
});

describe("MENTION_RE coverage for new triggers", () => {
  it("matches @tree, @recent, @diff, @os, @http in text", () => {
    const text = "Check @tree and @recent and @diff and @os and @http:https://example.com";
    const mentions = parseAllMentions(text);
    const triggers = mentions.map((m) => m.trigger);
    expect(triggers).toContain("@tree");
    expect(triggers).toContain("@recent");
    expect(triggers).toContain("@diff");
    expect(triggers).toContain("@os");
    expect(triggers).toContain("@http");
  });
});

describe("ExternalContextProvider SDK", () => {
  beforeEach(() => {
    // Clean up any providers registered in previous tests
    unregisterExternalProvider("@test-external");
  });

  it("registered provider resolves via globalContextRegistry", async () => {
    registerExternalProvider({
      name: "test-external",
      trigger: "@test-external",
      description: "Test external provider",
      async resolve(query) {
        return [{ label: `@test-external:${query}`, content: `result for ${query}` }];
      },
    });

    const item = await globalContextRegistry.resolve("@test-external:hello", WORKSPACE);
    expect(item).not.toBeNull();
    expect(item!.content).toBe("result for hello");
  });

  it("unregisterExternalProvider removes it from the external list", () => {
    registerExternalProvider({
      name: "jira",
      trigger: "@jira",
      description: "JIRA tickets",
      async resolve() { return []; },
    });

    expect(listExternalProviders().some((p) => p.trigger === "@jira")).toBe(true);

    unregisterExternalProvider("@jira");
    expect(listExternalProviders().some((p) => p.trigger === "@jira")).toBe(false);
  });

  it("listExternalProviders returns all registered providers", () => {
    registerExternalProvider({
      name: "confluence",
      trigger: "@confluence",
      description: "Confluence pages",
      async resolve() { return []; },
    });

    const list = listExternalProviders();
    expect(list.some((p) => p.trigger === "@confluence")).toBe(true);
  });
});

describe("All 15 providers have unique triggers", () => {
  it("no duplicate triggers in globalContextRegistry", () => {
    const providers = globalContextRegistry.listProviders();
    const triggers = providers.map((p) => p.trigger);
    const unique = new Set(triggers);
    expect(unique.size).toBe(triggers.length);
  });
});
