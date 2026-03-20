import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerificationHistoryStore } from "./verification-history-store.js";

describe("VerificationHistoryStore", () => {
  let projectRoot = "";

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = "";
    }
  });

  it("persists entries and lists newest first", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-verification-history-"));
    const store = new VerificationHistoryStore(projectRoot);

    await store.append({
      kind: "verify_output",
      source: "cli",
      label: "Deploy plan",
      summary: "Verification passed",
      sessionId: "session-1",
      passed: true,
      pdseScore: 0.93,
      payload: { task: "Deploy plan" },
      recordedAt: "2026-03-18T10:00:00.000Z",
    });

    await store.append({
      kind: "critic_debate",
      source: "cli",
      label: "Critic review",
      summary: "Consensus warn",
      sessionId: "session-1",
      averageConfidence: 0.71,
      payload: { consensus: "warn" },
      recordedAt: "2026-03-19T10:00:00.000Z",
    });

    const entries = await store.list();

    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("critic_debate");
    expect(entries[1]?.kind).toBe("verify_output");
  });

  it("filters by kind and session", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-verification-history-filter-"));
    const store = new VerificationHistoryStore(projectRoot);

    await store.append({
      kind: "verify_output",
      source: "cli",
      label: "Session one",
      summary: "Pass",
      sessionId: "session-1",
      passed: true,
      payload: {},
    });
    await store.append({
      kind: "qa_suite",
      source: "cli",
      label: "Session two",
      summary: "Fail",
      sessionId: "session-2",
      passed: false,
      payload: {},
    });

    const byKind = await store.list({ kind: "qa_suite" });
    const bySession = await store.list({ sessionId: "session-1" });

    expect(byKind).toHaveLength(1);
    expect(byKind[0]?.kind).toBe("qa_suite");
    expect(bySession).toHaveLength(1);
    expect(bySession[0]?.sessionId).toBe("session-1");
  });
});
