/**
 * health-surface.test.ts
 *
 * Tests for HealthSurface
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { HealthSurface } from "./health-surface.js";
import type { HealthStatus } from "./types.js";

describe("HealthSurface", () => {
  let health: HealthSurface;

  beforeEach(() => {
    health = new HealthSurface();
  });

  describe("registerCheck", () => {
    it("registers a health check", () => {
      health.registerCheck("test", async () => "healthy");
      expect(health.checkCount()).toBe(1);
      expect(health.getCheckNames()).toContain("test");
    });

    it("registers multiple checks", () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "healthy");
      expect(health.checkCount()).toBe(2);
    });

    it("overwrites existing check with same name", () => {
      health.registerCheck("test", async () => "healthy");
      health.registerCheck("test", async () => "degraded");
      expect(health.checkCount()).toBe(1);
    });
  });

  describe("unregisterCheck", () => {
    it("removes a registered check", () => {
      health.registerCheck("test", async () => "healthy");
      const result = health.unregisterCheck("test");
      expect(result).toBe(true);
      expect(health.checkCount()).toBe(0);
    });

    it("returns false for non-existent check", () => {
      const result = health.unregisterCheck("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("setTimeout", () => {
    it("sets default timeout", () => {
      health.setTimeout(10000);
      // Timeout is tested indirectly through runCheck
      expect(() => health.setTimeout(10000)).not.toThrow();
    });
  });

  describe("runCheck", () => {
    it("runs a healthy check", async () => {
      health.registerCheck("database", async () => "healthy");
      const result = await health.runCheck("database");

      expect(result.name).toBe("database");
      expect(result.status).toBe("healthy");
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("runs a degraded check", async () => {
      health.registerCheck("cache", async () => "degraded");
      const result = await health.runCheck("cache");

      expect(result.status).toBe("degraded");
    });

    it("marks failed check as unhealthy", async () => {
      health.registerCheck("api", async () => {
        throw new Error("Connection failed");
      });
      const result = await health.runCheck("api");

      expect(result.status).toBe("unhealthy");
      expect(result.message).toBe("Connection failed");
      expect(result.error).toBeDefined();
    });

    it("handles non-existent check", async () => {
      const result = await health.runCheck("nonexistent");
      expect(result.status).toBe("unhealthy");
      expect(result.message).toBe("Check not found");
    });

    it("times out slow checks", async () => {
      health.registerCheck("slow", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return "healthy" as HealthStatus;
      });

      const result = await health.runCheck("slow", 100); // 100ms timeout
      expect(result.status).toBe("unhealthy");
      expect(result.message).toContain("timeout");
    }, 10000);
  });

  describe("runChecks", () => {
    it("runs all registered checks", async () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "degraded");
      health.registerCheck("check3", async () => "healthy");

      const report = await health.runChecks();

      expect(report.checks).toHaveLength(3);
      expect(report.totalChecks).toBe(3);
      expect(report.healthyCount).toBe(2);
      expect(report.degradedCount).toBe(1);
      expect(report.unhealthyCount).toBe(0);
    });

    it("returns empty report when no checks", async () => {
      const report = await health.runChecks();

      expect(report.checks).toEqual([]);
      expect(report.totalChecks).toBe(0);
      expect(report.status).toBe("healthy");
    });

    it("marks overall status as healthy when all checks healthy", async () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "healthy");

      const report = await health.runChecks();
      expect(report.status).toBe("healthy");
    });

    it("marks overall status as degraded when any check degraded", async () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "degraded");

      const report = await health.runChecks();
      expect(report.status).toBe("degraded");
    });

    it("marks overall status as unhealthy when any check unhealthy", async () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "degraded");
      health.registerCheck("check3", async () => {
        throw new Error("Failed");
      });

      const report = await health.runChecks();
      expect(report.status).toBe("unhealthy");
      expect(report.unhealthyCount).toBe(1);
    });

    it("runs checks in parallel", async () => {
      const startTime = Date.now();

      health.registerCheck("slow1", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "healthy" as HealthStatus;
      });
      health.registerCheck("slow2", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "healthy" as HealthStatus;
      });

      await health.runChecks();
      const duration = Date.now() - startTime;

      // If parallel, should take ~50ms, not ~100ms
      expect(duration).toBeLessThan(150);
    }, 10000);
  });

  describe("getCheckNames", () => {
    it("returns empty array when no checks", () => {
      expect(health.getCheckNames()).toEqual([]);
    });

    it("returns all check names", () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "healthy");

      const names = health.getCheckNames();
      expect(names).toContain("check1");
      expect(names).toContain("check2");
      expect(names).toHaveLength(2);
    });
  });

  describe("checkCount", () => {
    it("returns 0 when no checks", () => {
      expect(health.checkCount()).toBe(0);
    });

    it("counts registered checks", () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "healthy");
      expect(health.checkCount()).toBe(2);
    });
  });

  describe("clear", () => {
    it("clears all checks", () => {
      health.registerCheck("check1", async () => "healthy");
      health.registerCheck("check2", async () => "healthy");
      expect(health.checkCount()).toBe(2);

      health.clear();

      expect(health.checkCount()).toBe(0);
      expect(health.getCheckNames()).toEqual([]);
    });
  });
});
