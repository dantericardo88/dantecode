import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DanteSkillbookIntegration } from "./integration.js";
import type { TaskResult, UpdateOperation } from "./types.js";

const makeTestDir = () => {
  const dir = join(tmpdir(), `dc-integration-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const makeResult = (): TaskResult => ({
  runId: "run-1",
  taskType: "code-generation",
  outcome: "success",
  summary: "Implemented feature X.",
  sessionId: "sess-1",
});

describe("DanteSkillbookIntegration", () => {
  let testDir: string;
  let integration: DanteSkillbookIntegration;

  beforeEach(() => {
    testDir = makeTestDir();
    integration = new DanteSkillbookIntegration({ cwd: testDir, gitStage: false });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("starts with empty skillbook", () => {
    expect(integration.stats().totalSkills).toBe(0);
  });

  it("applyProposals with pass applies and saves", () => {
    const proposal: UpdateOperation = {
      action: "add",
      rationale: "good",
      candidateSkill: {
        id: "s1", title: "T", content: "C", section: "coding",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      },
    };
    const result = integration.applyProposals([proposal], ["pass"]);
    expect(result.applied).toBe(1);
    expect(integration.stats().totalSkills).toBe(1);
  });

  it("applyProposals with review-required enqueues", () => {
    const proposal: UpdateOperation = { action: "add", rationale: "uncertain", candidateSkill: {
      id: "s1", title: "T", content: "C", section: "coding",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }};
    const result = integration.applyProposals([proposal], ["review-required"]);
    expect(result.queued).toBe(1);
    expect(integration.reviewQueue.pendingCount()).toBe(1);
  });

  it("applyProposals with fail discards", () => {
    const proposal: UpdateOperation = { action: "add", rationale: "bad", candidateSkill: {
      id: "s1", title: "T", content: "C", section: "coding",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }};
    const result = integration.applyProposals([proposal], ["fail"]);
    expect(result.rejected).toBe(1);
    expect(integration.stats().totalSkills).toBe(0);
  });

  it("triggerReflection skips trivial tasks", async () => {
    const trivialResult: TaskResult = { ...makeResult(), taskType: "trivial" };
    const r = await integration.triggerReflection(trivialResult);
    expect((r as {skipped: boolean}).skipped).toBe(true);
  });

  it("triggerReflection runs for meaningful tasks", async () => {
    const r = await integration.triggerReflection(makeResult());
    expect((r as {skipped: boolean}).skipped).toBe(false);
  });

  it("getRelevantSkills works after adding", () => {
    const proposal: UpdateOperation = {
      action: "add", rationale: "useful",
      candidateSkill: { id: "s1", title: "TypeScript patterns", content: "Use strict null checks", section: "coding",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    };
    integration.applyProposals([proposal], ["pass"]);
    const skills = integration.getRelevantSkills({ keywords: ["typescript", "null"] });
    expect(skills.length).toBeGreaterThan(0);
  });

  it("persists across reload", () => {
    const proposal: UpdateOperation = {
      action: "add", rationale: "r",
      candidateSkill: { id: "s1", title: "T", content: "C", section: "coding",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    };
    integration.applyProposals([proposal], ["pass"]);
    const integration2 = new DanteSkillbookIntegration({ cwd: testDir, gitStage: false });
    expect(integration2.stats().totalSkills).toBe(1);
  });

  it("applyReviewItem promotes queued item to skillbook", () => {
    const proposal: UpdateOperation = { action: "add", rationale: "review", candidateSkill: {
      id: "s1", title: "T", content: "C", section: "coding",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }};
    integration.applyProposals([proposal], ["review-required"]);
    const pending = integration.reviewQueue.getPending();
    expect(pending).toHaveLength(1);
    const ok = integration.applyReviewItem(pending[0]!.id);
    expect(ok).toBe(true);
    expect(integration.stats().totalSkills).toBe(1);
  });
});
