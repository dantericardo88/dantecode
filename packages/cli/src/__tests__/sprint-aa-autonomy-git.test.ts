// ============================================================================
// Sprint AA — Dims 15+8: ContinuousVerifyMode + GitLifecycleManager
// Tests that:
//  - GitLifecycleManager tracks lifecycle stages correctly
//  - emitGitLifecycleEvent writes to git-lifecycle-log.json
//  - git-lifecycle-log.json exists with seeded entries
//  - summarize() returns correct stage counts
//  - summarizeAgentSession() extracts decisions from messages
//  - summarizeAgentSession() returns status in output
//  - git-lifecycle-log.json entries have required fields
//  - GitLifecycleManager tracks PR opened correctly
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  GitLifecycleManager,
  emitGitLifecycleEvent,
  type GitLifecycleEvent,
} from "@dantecode/core";
import { summarizeAgentSession } from "../agent-loop.js";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-aa-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: GitLifecycleManager unit tests ───────────────────────────────────

describe("GitLifecycleManager — Sprint AA (dim 8)", () => {
  // 1. Lifecycle events accumulate in order
  it("records branch_created, commit, push, pr_opened in order", () => {
    const dir = makeDir();
    const mgr = new GitLifecycleManager("feat/test-branch", dir);
    mgr.recordBranchCreated("author@test.com");
    mgr.recordCommit("abc1234", 3, 40, 10);
    mgr.recordPush();
    mgr.recordPROpened(99, "feat: test PR");
    const summary = mgr.summarize();
    expect(summary.events[0]?.stage).toBe("branch_created");
    expect(summary.events[1]?.stage).toBe("commit");
    expect(summary.events[2]?.stage).toBe("push");
    expect(summary.events[3]?.stage).toBe("pr_opened");
  });

  // 2. summarize counts commits correctly
  it("summarize() counts totalCommits correctly", () => {
    const dir = makeDir();
    const mgr = new GitLifecycleManager("feat/commit-count", dir);
    mgr.recordBranchCreated();
    mgr.recordCommit("sha1", 1, 5, 2);
    mgr.recordCommit("sha2", 2, 8, 3);
    mgr.recordCommit("sha3", 3, 12, 4);
    const summary = mgr.summarize();
    expect(summary.totalCommits).toBe(3);
  });

  // 3. reachedPR is false before pr_opened
  it("reachedPR is false before pr_opened", () => {
    const dir = makeDir();
    const mgr = new GitLifecycleManager("feat/no-pr", dir);
    mgr.recordBranchCreated();
    mgr.recordCommit("sha1", 1, 5, 2);
    expect(mgr.summarize().reachedPR).toBe(false);
  });

  // 4. reachedPR is true after pr_opened
  it("reachedPR is true after recordPROpened()", () => {
    const dir = makeDir();
    const mgr = new GitLifecycleManager("feat/with-pr", dir);
    mgr.recordBranchCreated();
    mgr.recordPROpened(10, "feat: something");
    expect(mgr.summarize().reachedPR).toBe(true);
  });

  // 5. reachedMerge is true after pr_merged
  it("reachedMerge is true after recordPRMerged()", () => {
    const dir = makeDir();
    const mgr = new GitLifecycleManager("feat/merged", dir);
    mgr.recordBranchCreated();
    mgr.recordPROpened(20, "feat: merged PR");
    mgr.recordPRMerged(20);
    expect(mgr.summarize().reachedMerge).toBe(true);
  });

  // 6. emitGitLifecycleEvent writes to git-lifecycle-log.json
  it("emitGitLifecycleEvent writes JSONL entry to .danteforge/git-lifecycle-log.json", () => {
    const dir = makeDir();
    emitGitLifecycleEvent({ stage: "branch_created", branch: "feat/emit-test" }, dir);
    const logPath = join(dir, ".danteforge", "git-lifecycle-log.json");
    expect(existsSync(logPath)).toBe(true);
    const line = readFileSync(logPath, "utf-8").trim();
    const entry = JSON.parse(line) as GitLifecycleEvent;
    expect(entry.stage).toBe("branch_created");
    expect(entry.branch).toBe("feat/emit-test");
    expect(typeof entry.timestamp).toBe("string");
  });

  // 7. Seeded git-lifecycle-log.json exists with required fields
  it("seeded git-lifecycle-log.json exists at .danteforge/ with required fields", () => {
    const logPath = join(repoRoot, ".danteforge", "git-lifecycle-log.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      const entry = JSON.parse(line) as GitLifecycleEvent;
      expect(typeof entry.timestamp).toBe("string");
      expect(typeof entry.stage).toBe("string");
      expect(typeof entry.branch).toBe("string");
    }
  });

  // 8. GitLifecycleManager branch field on all events
  it("all events emitted by GitLifecycleManager carry the correct branch name", () => {
    const dir = makeDir();
    const mgr = new GitLifecycleManager("feat/branch-name-check", dir);
    mgr.recordBranchCreated();
    mgr.recordPush();
    const summary = mgr.summarize();
    for (const event of summary.events) {
      expect(event.branch).toBe("feat/branch-name-check");
    }
  });
});

// ─── Part 2: summarizeAgentSession (Sprint AB — dim 11) ──────────────────────

describe("summarizeAgentSession — Sprint AB (dim 11)", () => {
  // 9. Contains status in output
  it("summarizeAgentSession output contains status=COMPLETE", () => {
    const result = summarizeAgentSession([], [], "COMPLETE");
    expect(result).toContain("status=COMPLETE");
  });

  // 10. Contains file count
  it("summarizeAgentSession output contains files count", () => {
    const result = summarizeAgentSession([], ["a.ts", "b.ts"], "COMPLETE");
    expect(result).toContain("files=2");
  });

  // 11. Extracts decision from assistant message
  it("summarizeAgentSession extracts key decision from assistant messages", () => {
    const messages = [
      { role: "assistant", content: "Adding new function to handle authentication flow\nfunction auth() {}" },
    ];
    const result = summarizeAgentSession(messages, [], "COMPLETE");
    expect(result).toContain("Key decisions");
  });

  // 12. Works with no messages (empty session)
  it("summarizeAgentSession handles empty messages gracefully", () => {
    const result = summarizeAgentSession([], [], "FAILED");
    expect(result).toContain("status=FAILED");
    expect(result).toContain("files=0");
  });
});
