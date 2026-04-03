import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PlanStore } from "./plan-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExecutionPlan } from "./architect-planner.js";

function makePlan(goal = "test goal"): ExecutionPlan {
  return {
    goal,
    steps: [
      { id: "step-1", description: "First step", files: ["a.ts"], status: "pending" },
      {
        id: "step-2",
        description: "Second step",
        files: ["b.ts"],
        status: "pending",
        dependencies: ["step-1"],
      },
    ],
    createdAt: new Date().toISOString(),
    estimatedComplexity: 0.5,
  };
}

describe("PlanStore", () => {
  let tmpDir: string;
  let store: PlanStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "plan-store-"));
    store = new PlanStore(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a plan", async () => {
    const plan = makePlan();
    const stored = {
      plan,
      id: "test-plan-1",
      status: "draft" as const,
      createdAt: new Date().toISOString(),
    };
    await store.save(stored);
    const loaded = await store.load("test-plan-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.plan.goal).toBe("test goal");
    expect(loaded!.status).toBe("draft");
  });

  it("returns null for non-existent plan", async () => {
    expect(await store.load("does-not-exist")).toBeNull();
  });

  it("lists plans newest first", async () => {
    const p1 = {
      plan: makePlan("first"),
      id: "001-first",
      status: "draft" as const,
      createdAt: "2026-01-01",
    };
    const p2 = {
      plan: makePlan("second"),
      id: "002-second",
      status: "approved" as const,
      createdAt: "2026-01-02",
    };
    await store.save(p1);
    await store.save(p2);
    const list = await store.list();
    expect(list.length).toBe(2);
    expect(list[0]!.id).toBe("002-second");
  });

  it("filters by status", async () => {
    const p1 = { plan: makePlan(), id: "001-a", status: "draft" as const, createdAt: "2026-01-01" };
    const p2 = {
      plan: makePlan(),
      id: "002-b",
      status: "approved" as const,
      createdAt: "2026-01-02",
    };
    await store.save(p1);
    await store.save(p2);
    const drafts = await store.list({ status: "draft" });
    expect(drafts.length).toBe(1);
    expect(drafts[0]!.status).toBe("draft");
  });

  it("respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await store.save({
        plan: makePlan(),
        id: `plan-${i}`,
        status: "draft" as const,
        createdAt: `2026-01-0${i + 1}`,
      });
    }
    const list = await store.list({ limit: 3 });
    expect(list.length).toBe(3);
  });

  it("updates status", async () => {
    const stored = {
      plan: makePlan(),
      id: "update-test",
      status: "draft" as const,
      createdAt: new Date().toISOString(),
    };
    await store.save(stored);
    await store.updateStatus("update-test", "approved");
    const loaded = await store.load("update-test");
    expect(loaded!.status).toBe("approved");
    expect(loaded!.approvedAt).toBeDefined();
  });

  it("updates status to completed with completedAt", async () => {
    const stored = {
      plan: makePlan(),
      id: "complete-test",
      status: "approved" as const,
      createdAt: new Date().toISOString(),
    };
    await store.save(stored);
    await store.updateStatus("complete-test", "completed");
    const loaded = await store.load("complete-test");
    expect(loaded!.status).toBe("completed");
    expect(loaded!.completedAt).toBeDefined();
  });

  it("returns empty list for empty directory", async () => {
    const list = await store.list();
    expect(list).toEqual([]);
  });

  describe("generateId", () => {
    it("produces timestamp-slug format", () => {
      const id = PlanStore.generateId("Build a REST API");
      expect(id).toMatch(/^\d+-build-a-rest-api$/);
    });

    it("strips special characters", () => {
      const id = PlanStore.generateId("Fix bug #123 (critical!)");
      expect(id).toMatch(/^\d+-fix-bug-123-critical$/);
    });

    it("truncates long goals", () => {
      const longGoal = "a".repeat(100);
      const id = PlanStore.generateId(longGoal);
      const slug = id.split("-").slice(1).join("-");
      expect(slug.length).toBeLessThanOrEqual(40);
    });
  });

  describe("slugify", () => {
    it("lowercases and strips non-alnum", () => {
      expect(PlanStore.slugify("Hello World!")).toBe("hello-world");
    });
    it("collapses multiple dashes", () => {
      expect(PlanStore.slugify("a - - b")).toBe("a-b");
    });
  });
});
