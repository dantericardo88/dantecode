import { describe, expect, it } from "vitest";
import { MultiRepoCoordinator } from "./multi-repo-coordinator.js";

describe("MultiRepoCoordinator", () => {
  it("allows a workflow to start when under concurrency limit", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 2 });
    expect(coordinator.canRun("/repo")).toBe(true);
    const result = coordinator.startWorkflow("/repo");
    expect(result.workflowId).toBeTruthy();
    expect(result.repoRoot).toBe("/repo");
  });

  it("blocks a workflow when per-repo limit is reached", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 1 });
    coordinator.startWorkflow("/repo");
    expect(coordinator.canRun("/repo")).toBe(false);
    expect(() => coordinator.startWorkflow("/repo")).toThrow("concurrency limit");
  });

  it("blocks when global ceiling is reached", () => {
    const coordinator = new MultiRepoCoordinator({
      maxConcurrentPerRepo: 4,
      maxGlobalConcurrent: 2,
    });
    coordinator.startWorkflow("/repo1");
    coordinator.startWorkflow("/repo2");
    expect(coordinator.canRun("/repo3")).toBe(false);
  });

  it("releases slot after finishWorkflow", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 1 });
    const { workflowId } = coordinator.startWorkflow("/repo");
    expect(coordinator.canRun("/repo")).toBe(false);
    coordinator.finishWorkflow("/repo", workflowId);
    expect(coordinator.canRun("/repo")).toBe(true);
  });

  it("finishWorkflow is a no-op for unknown workflowId", () => {
    const coordinator = new MultiRepoCoordinator();
    expect(() => coordinator.finishWorkflow("/repo", "unknown-id")).not.toThrow();
  });

  it("supports per-repo concurrency override via registerRepo", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 2 });
    coordinator.registerRepo("/important-repo", 8);
    for (let i = 0; i < 8; i++) {
      expect(coordinator.canRun("/important-repo")).toBe(true);
      coordinator.startWorkflow("/important-repo");
    }
    expect(coordinator.canRun("/important-repo")).toBe(false);
  });

  it("getLoad reports active workflows and queued events", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 4 });
    coordinator.startWorkflow("/repo1");
    coordinator.startWorkflow("/repo1");
    coordinator.adjustQueuedEvents("/repo1", 3);

    const load = coordinator.getLoad();
    const entry = load.find((entry) => entry.repoRoot === "/repo1");
    expect(entry?.activeWorkflows).toBe(2);
    expect(entry?.queuedEvents).toBe(3);
  });

  it("isBackpressured returns true for a full repo", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 1 });
    coordinator.startWorkflow("/repo");
    expect(coordinator.isBackpressured("/repo")).toBe(true);
    expect(coordinator.isBackpressured("/other-repo")).toBe(false);
  });

  it("isBackpressured returns true globally when ceiling reached", () => {
    const coordinator = new MultiRepoCoordinator({
      maxConcurrentPerRepo: 4,
      maxGlobalConcurrent: 1,
    });
    coordinator.startWorkflow("/repo");
    expect(coordinator.isBackpressured()).toBe(true);
  });

  it("globalActiveCount reflects all active workflows", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 8 });
    coordinator.startWorkflow("/a");
    coordinator.startWorkflow("/a");
    coordinator.startWorkflow("/b");
    expect(coordinator.globalActiveCount()).toBe(3);
  });

  it("normalises Windows-style paths", () => {
    const coordinator = new MultiRepoCoordinator({ maxConcurrentPerRepo: 2 });
    const r1 = coordinator.startWorkflow("C:\\Projects\\MyRepo");
    const load = coordinator.getLoad();
    expect(load[0]?.repoRoot).toBe("C:/Projects/MyRepo");
    coordinator.finishWorkflow("C:\\Projects\\MyRepo", r1.workflowId);
    expect(coordinator.globalActiveCount()).toBe(0);
  });

  it("supports 8+ concurrent workflows across repos (GF-06 parity)", () => {
    const coordinator = new MultiRepoCoordinator({
      maxConcurrentPerRepo: 4,
      maxGlobalConcurrent: 16,
    });
    const slots: Array<{ repoRoot: string; workflowId: string }> = [];

    for (let i = 0; i < 8; i++) {
      const repoRoot = `/repo${(i % 2) + 1}`;
      const result = coordinator.startWorkflow(repoRoot);
      slots.push({ repoRoot, workflowId: result.workflowId });
    }

    expect(coordinator.globalActiveCount()).toBe(8);

    for (const slot of slots) {
      coordinator.finishWorkflow(slot.repoRoot, slot.workflowId);
    }

    expect(coordinator.globalActiveCount()).toBe(0);
  });

  it("reset clears all state", () => {
    const coordinator = new MultiRepoCoordinator();
    coordinator.startWorkflow("/repo");
    coordinator.adjustQueuedEvents("/repo", 5);
    coordinator.reset();
    expect(coordinator.getLoad()).toHaveLength(0);
    expect(coordinator.globalActiveCount()).toBe(0);
  });
});
