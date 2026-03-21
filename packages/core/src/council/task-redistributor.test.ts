// ============================================================================
// task-redistributor.test.ts — Unit tests for TaskRedistributor
// ============================================================================

import { describe, it, expect } from "vitest";
import { TaskRedistributor } from "./task-redistributor.js";
import type { BusyLaneInfo } from "./task-redistributor.js";

describe("TaskRedistributor", () => {
  const redistributor = new TaskRedistributor();

  // Helper to build a BusyLaneInfo
  function busyLane(overrides: Partial<BusyLaneInfo> & { laneId: string }): BusyLaneInfo {
    return {
      laneId: overrides.laneId,
      agentKind: overrides.agentKind ?? "dantecode",
      objective: overrides.objective ?? "Implement feature X and write tests",
      startedAt: overrides.startedAt ?? Date.now() - 60_000,
      estimatedCompletion: overrides.estimatedCompletion,
      ownedFiles: overrides.ownedFiles ?? [],
    };
  }

  describe("findRedistribution", () => {
    it("one idle + one busy (decomposable) — redistribution candidate found", async () => {
      const busy = busyLane({
        laneId: "busy-lane",
        objective: "Implement authentication and write integration tests",
        estimatedCompletion: 0.3,
      });
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", [busy]);
      expect(candidate).not.toBeNull();
      expect(candidate!.fromLaneId).toBe("busy-lane");
      expect(candidate!.toLaneId).toBe("idle-lane");
      expect(candidate!.subObjective).toBeTruthy();
    });

    it("no busy lanes — returns null", async () => {
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", []);
      expect(candidate).toBeNull();
    });

    it("all busy lanes at 90% completion — no redistribution (not worth overhead)", async () => {
      const busy = busyLane({
        laneId: "busy-lane",
        objective: "Implement auth and write tests",
        estimatedCompletion: 0.9,
      });
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", [busy]);
      expect(candidate).toBeNull();
    });

    it("exactly at 80% — no redistribution (boundary condition)", async () => {
      const busy = busyLane({
        laneId: "busy-lane",
        objective: "Implement feature and write tests",
        estimatedCompletion: 0.8,
      });
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", [busy]);
      expect(candidate).toBeNull();
    });

    it("just under 80% — redistribution allowed", async () => {
      const busy = busyLane({
        laneId: "busy-lane",
        objective: "Add caching and then add rate limiting",
        estimatedCompletion: 0.79,
      });
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", [busy]);
      expect(candidate).not.toBeNull();
    });

    it("undefined completion — treated as unknown, redistribution allowed", async () => {
      const busy = busyLane({
        laneId: "busy-lane",
        objective: "Implement search and add pagination",
        estimatedCompletion: undefined,
      });
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", [busy]);
      expect(candidate).not.toBeNull();
    });

    it("single-step objective (no decomposition) — returns null", async () => {
      const busy = busyLane({
        laneId: "busy-lane",
        objective: "Fix typo",
        estimatedCompletion: 0.1,
      });
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", [busy]);
      expect(candidate).toBeNull();
    });

    it("picks the lane with the most remaining work (lowest completion)", async () => {
      const lanes = [
        busyLane({ laneId: "lane-60", objective: "Write tests and add docs", estimatedCompletion: 0.6 }),
        busyLane({ laneId: "lane-20", objective: "Implement auth and add caching", estimatedCompletion: 0.2 }),
        busyLane({ laneId: "lane-40", objective: "Refactor module and write tests", estimatedCompletion: 0.4 }),
      ];
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", lanes);
      expect(candidate).not.toBeNull();
      expect(candidate!.fromLaneId).toBe("lane-20");
    });

    it("candidate has estimated tokens and priority", async () => {
      const busy = busyLane({
        laneId: "busy-lane",
        objective: "Add search feature and then write integration tests",
        estimatedCompletion: 0.1,
        startedAt: Date.now() - 200_000, // 200 seconds ago → high priority
      });
      const candidate = await redistributor.findRedistribution("idle-lane", "dantecode", [busy]);
      expect(candidate).not.toBeNull();
      expect(candidate!.estimatedTokens).toBeGreaterThan(0);
      expect(candidate!.priority).toBe("high");
    });
  });

  describe("decomposeObjective", () => {
    it("splits on 'and'", () => {
      const parts = redistributor.decomposeObjective("Implement auth and write tests");
      expect(parts.length).toBeGreaterThan(1);
      expect(parts.some((p) => p.toLowerCase().includes("implement"))).toBe(true);
      expect(parts.some((p) => p.toLowerCase().includes("write"))).toBe(true);
    });

    it("splits on 'then'", () => {
      const parts = redistributor.decomposeObjective("Add caching then add rate limiting");
      expect(parts.length).toBeGreaterThan(1);
    });

    it("splits on 'and then'", () => {
      const parts = redistributor.decomposeObjective("Build auth and then write integration tests");
      expect(parts.length).toBeGreaterThan(1);
    });

    it("splits numbered steps", () => {
      const obj = "1. Implement login\n2. Write tests\n3. Add docs";
      const parts = redistributor.decomposeObjective(obj);
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });

    it("single short objective returns single-element array", () => {
      const parts = redistributor.decomposeObjective("Fix bug");
      expect(parts.length).toBe(1);
      expect(parts[0]).toBe("Fix bug");
    });

    it("semicolons split into sub-tasks", () => {
      const parts = redistributor.decomposeObjective(
        "Create database schema; write migrations; add tests",
      );
      expect(parts.length).toBeGreaterThan(1);
    });

    it("complex multi-clause objective decomposed", () => {
      const obj = "Implement search and add caching and then write tests";
      const parts = redistributor.decomposeObjective(obj);
      expect(parts.length).toBeGreaterThan(1);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe("tiebreaker + edge cases", () => {
    it("multiple undefined-completion lanes — picks earliest startedAt (longest-running)", async () => {
      const older = busyLane({
        laneId: "older",
        objective: "Implement auth system and write integration tests",
        startedAt: Date.now() - 200_000,
        estimatedCompletion: undefined,
      });
      const newer = busyLane({
        laneId: "newer",
        objective: "Add caching layer and then add rate limiting",
        startedAt: Date.now() - 50_000,
        estimatedCompletion: undefined,
      });
      const candidate = await redistributor.findRedistribution("idle", "dantecode", [older, newer]);
      expect(candidate).not.toBeNull();
      // Should pick "older" (earlier startedAt), not "newer"
      expect(candidate!.fromLaneId).toBe("older");
    });

    it("priority boundary: exactly 30_000ms elapsed → 'medium'", async () => {
      const lane = busyLane({
        laneId: "lane",
        objective: "Implement feature and write tests",
        startedAt: Date.now() - 30_000,
        estimatedCompletion: 0.1,
      });
      const candidate = await redistributor.findRedistribution("idle", "dantecode", [lane]);
      expect(candidate).not.toBeNull();
      expect(candidate!.priority).toBe("medium");
    });

    it("priority boundary: exactly 120_000ms elapsed → 'high'", async () => {
      const lane = busyLane({
        laneId: "lane",
        objective: "Implement feature and write tests",
        startedAt: Date.now() - 120_000,
        estimatedCompletion: 0.1,
      });
      const candidate = await redistributor.findRedistribution("idle", "dantecode", [lane]);
      expect(candidate).not.toBeNull();
      expect(candidate!.priority).toBe("high");
    });

    it("picked sub-objective is the LAST part from decomposeObjective", async () => {
      const lane = busyLane({
        laneId: "lane",
        // Will split into ["Implement authentication", "write integration tests"]
        objective: "Implement authentication and then write integration tests",
        startedAt: Date.now() - 60_000,
        estimatedCompletion: 0.2,
      });
      const candidate = await redistributor.findRedistribution("idle", "dantecode", [lane]);
      expect(candidate).not.toBeNull();
      expect(candidate!.subObjective).toBe("write integration tests");
    });

    it("undefined vs defined completion: undefined treated as 0% → picked over 50% lane", async () => {
      const definedLane = busyLane({
        laneId: "defined",
        objective: "Implement feature A and write tests",
        startedAt: Date.now() - 60_000,
        estimatedCompletion: 0.5,
      });
      const undefinedLane = busyLane({
        laneId: "undefined",
        objective: "Build module B and add integration tests",
        startedAt: Date.now() - 50_000, // slightly newer — ensures tiebreaker isn't the differentiator
        estimatedCompletion: undefined,
      });
      const candidate = await redistributor.findRedistribution("idle", "dantecode", [definedLane, undefinedLane]);
      expect(candidate).not.toBeNull();
      // undefined → 0% → beats 50% → should pick "undefined" lane
      expect(candidate!.fromLaneId).toBe("undefined");
    });
  });
});
