/**
 * git-hook-handler.test.ts
 *
 * 15 unit tests for GitHookHandler.
 * All node:fs/promises calls are mocked at the module level.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHookHandler } from "./git-hook-handler.js";
import type { GitHookHandlerOptions } from "./git-hook-handler.js";

// ---------------------------------------------------------------------------
// Mock node:fs/promises
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises");

import { writeFile, mkdir, readFile } from "node:fs/promises";

const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);
const mockedReadFile = vi.mocked(readFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an injectable fsFn that wraps the vi-mocked functions. */
function makeFsFn(): GitHookHandlerOptions["fsFn"] {
  return {
    writeFile: mockedWriteFile as unknown as typeof writeFile,
    mkdir: mockedMkdir as unknown as typeof mkdir,
    readFile: mockedReadFile as unknown as typeof readFile,
  };
}

const PROJECT_ROOT = "/project/myrepo";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHookHandler", () => {
  let handler: GitHookHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mkdir and writeFile succeed; readFile throws ENOENT
    mockedMkdir.mockResolvedValue(undefined as never);
    mockedWriteFile.mockResolvedValue(undefined);
    mockedReadFile.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    handler = new GitHookHandler(PROJECT_ROOT, { fsFn: makeFsFn() });
  });

  // 1
  it("parseHookEvent() pre-commit returns payload with correct hookType and branch", () => {
    const payload = handler.parseHookEvent("pre-commit", []);
    expect(payload.hookType).toBe("pre-commit");
    expect(typeof payload.branch).toBe("string");
    expect(payload.branch.length).toBeGreaterThan(0);
  });

  // 2
  it("parseHookEvent() post-commit sets hookType to post-commit", () => {
    const payload = handler.parseHookEvent("post-commit", []);
    expect(payload.hookType).toBe("post-commit");
  });

  // 3
  it("parseHookEvent() pre-push parses remote name and URL from args", () => {
    const payload = handler.parseHookEvent("pre-push", ["origin", "https://github.com/org/repo"]);
    expect(payload.hookType).toBe("pre-push");
    expect(payload.remoteRef).toBe("origin");
    expect(payload.localRef).toBe("https://github.com/org/repo");
  });

  // 4
  it("parseHookEvent() post-merge parses squash flag", () => {
    const squash = handler.parseHookEvent("post-merge", ["1"]);
    expect(squash.hookType).toBe("post-merge");
    expect(squash.files).toContain("squash");

    const noSquash = handler.parseHookEvent("post-merge", ["0"]);
    expect(noSquash.files).toEqual([]);
  });

  // 5
  it("parseHookEvent() pre-rebase parses upstream and branch from args", () => {
    const payload = handler.parseHookEvent("pre-rebase", ["main", "feature/x"]);
    expect(payload.hookType).toBe("pre-rebase");
    expect(payload.remoteRef).toBe("main");
    expect(payload.localRef).toBe("feature/x");
  });

  // 6
  it("toDanteEvent() pre-commit maps to git:commit", () => {
    const payload = handler.parseHookEvent("pre-commit", []);
    const { type } = handler.toDanteEvent(payload);
    expect(type).toBe("git:commit");
  });

  // 7
  it("toDanteEvent() pre-push maps to git:push", () => {
    const payload = handler.parseHookEvent("pre-push", ["origin", "https://example.com"]);
    const { type } = handler.toDanteEvent(payload);
    expect(type).toBe("git:push");
  });

  // 8
  it("toDanteEvent() post-merge maps to git:merge", () => {
    const payload = handler.parseHookEvent("post-merge", ["0"]);
    const { type } = handler.toDanteEvent(payload);
    expect(type).toBe("git:merge");
  });

  // 9
  it("toDanteEvent() pre-rebase maps to git:rebase", () => {
    const payload = handler.parseHookEvent("pre-rebase", ["main", "feature/y"]);
    const { type } = handler.toDanteEvent(payload);
    expect(type).toBe("git:rebase");
  });

  // 10
  it("installHooks() calls writeFile once for each supplied hook type", async () => {
    await handler.installHooks(["pre-commit", "pre-push"]);
    expect(mockedWriteFile).toHaveBeenCalledTimes(2);
  });

  // 11
  it("installHooks() creates the hooks directory via mkdir", async () => {
    await handler.installHooks(["post-commit"]);
    expect(mockedMkdir).toHaveBeenCalledTimes(1);
    expect(mockedMkdir).toHaveBeenCalledWith(
      expect.stringContaining("hooks"),
      { recursive: true },
    );
  });

  // 12
  it("installHooks() writes executable script content referencing the hook type", async () => {
    await handler.installHooks(["pre-commit"]);
    const [, content] = mockedWriteFile.mock.calls[0] as [string, string, unknown];
    expect(content).toContain("#!/bin/sh");
    expect(content).toContain("pre-commit");
    expect(content).toContain("node .dantecode/hooks/handler.js");
  });

  // 13
  it("getInstalledHooks() returns hooks whose files exist", async () => {
    // Make readFile succeed only for pre-commit and post-commit
    mockedReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.endsWith("pre-commit") || p.endsWith("post-commit")) {
        return "#!/bin/sh\n";
      }
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const installed = await handler.getInstalledHooks();
    expect(installed).toContain("pre-commit");
    expect(installed).toContain("post-commit");
    expect(installed).not.toContain("pre-push");
    expect(installed).not.toContain("post-merge");
    expect(installed).not.toContain("pre-rebase");
  });

  // 14
  it("getInstalledHooks() returns empty array when no hooks exist", async () => {
    // All reads throw (default mock behaviour set in beforeEach)
    const installed = await handler.getInstalledHooks();
    expect(installed).toEqual([]);
  });

  // 15
  it("toDanteEvent() eventPayload contains hookType field", () => {
    const payload = handler.parseHookEvent("pre-push", ["upstream", "refs/heads/main"]);
    const { eventPayload } = handler.toDanteEvent(payload);
    expect(eventPayload["hookType"]).toBe("pre-push");
  });
});
