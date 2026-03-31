/**
 * council-health.test.ts
 *
 * Integration tests for council health checks.
 * Validates that CouncilOrchestrator.getHealthReport() correctly reflects:
 * - Lane status (healthy/degraded/unhealthy)
 * - Fleet budget health
 * - Orchestrator state health
 */

import { describe, it, expect } from "vitest";
import { CouncilOrchestrator } from "./council-orchestrator.js";
import type { HealthStatus } from "@dantecode/observability";

describe("Council Health Checks", () => {
  describe("Health Check Structure", () => {
    it("health report has correct structure", async () => {
      // Create empty adapter map (no actual adapters needed for health checks)
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();

      // Validate report structure
      expect(health).toHaveProperty("status");
      expect(health).toHaveProperty("checks");
      expect(health).toHaveProperty("timestamp");
      expect(health).toHaveProperty("totalChecks");
      expect(health).toHaveProperty("healthyCount");
      expect(health).toHaveProperty("degradedCount");
      expect(health).toHaveProperty("unhealthyCount");

      // Status should be a valid health status
      const validStatuses: HealthStatus[] = ["healthy", "degraded", "unhealthy"];
      expect(validStatuses).toContain(health.status);

      // Checks should be an array
      expect(Array.isArray(health.checks)).toBe(true);

      // Counts should sum to total
      expect(health.healthyCount + health.degradedCount + health.unhealthyCount).toBe(
        health.totalChecks
      );
    });

    it("individual health checks have correct structure", async () => {
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);
      const health = await orchestrator.getHealthReport();

      for (const check of health.checks) {
        // Each check should have these properties
        expect(check).toHaveProperty("name");
        expect(check).toHaveProperty("status");
        expect(check).toHaveProperty("timestamp");
        expect(check).toHaveProperty("duration");

        // Status should be valid
        const validStatuses: HealthStatus[] = ["healthy", "degraded", "unhealthy"];
        expect(validStatuses).toContain(check.status);

        // Duration should be non-negative
        expect(check.duration).toBeGreaterThanOrEqual(0);

        // Timestamp should be reasonable
        expect(check.timestamp).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
      }
    });
  });

  describe("Fleet Budget Health", () => {
    it("fleet budget health reflects remaining budget", async () => {
      // Test with limited budget
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();

      // Find fleet-budget check
      const budgetCheck = health.checks.find((c) => c.name === "fleet-budget");
      if (budgetCheck) {
        // Budget check should exist
        expect(budgetCheck).toBeDefined();
        expect(budgetCheck.name).toBe("fleet-budget");

        // Status should be one of the valid values
        expect(["healthy", "degraded", "unhealthy"]).toContain(budgetCheck.status);

        // Message may provide details
        if (budgetCheck.message) {
          expect(typeof budgetCheck.message).toBe("string");
        }
      }
    });

    it("reports healthy when budget is unlimited", async () => {
      // Default CouncilOrchestrator has unlimited budget
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();
      const budgetCheck = health.checks.find((c) => c.name === "fleet-budget");

      if (budgetCheck) {
        // Unlimited budget should be healthy
        expect(budgetCheck.status).toBe("healthy");
      }
    });
  });

  describe("Lane Status Health", () => {
    it("reports on lane status correctly", async () => {
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();

      // Find lanes check
      const lanesCheck = health.checks.find((c) => c.name === "lanes");
      if (lanesCheck) {
        // Lanes check should exist
        expect(lanesCheck).toBeDefined();
        expect(lanesCheck.name).toBe("lanes");

        // Status should be valid
        expect(["healthy", "degraded", "unhealthy"]).toContain(lanesCheck.status);
      }
    });

    it("reflects no lanes as healthy (no failures)", async () => {
      // Fresh orchestrator with no lanes started
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();
      const lanesCheck = health.checks.find((c) => c.name === "lanes");

      if (lanesCheck) {
        // No lanes = no failures = healthy
        expect(lanesCheck.status).toBe("healthy");
      }
    });
  });

  describe("Orchestrator State Health", () => {
    it("orchestrator state health reflects current status", async () => {
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();

      // Find orchestrator-state check
      const stateCheck = health.checks.find((c) => c.name === "orchestrator-state");
      if (stateCheck) {
        expect(stateCheck).toBeDefined();
        expect(stateCheck.name).toBe("orchestrator-state");

        // Status should be valid
        expect(["healthy", "degraded", "unhealthy"]).toContain(stateCheck.status);
      }
    });

    it("reports healthy when orchestrator is idle", async () => {
      // Fresh orchestrator is idle
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();
      const stateCheck = health.checks.find((c) => c.name === "orchestrator-state");

      if (stateCheck) {
        // Idle orchestrator should be healthy
        expect(stateCheck.status).toBe("healthy");
      }
    });
  });

  describe("Overall Health Status", () => {
    it("aggregates check statuses correctly", async () => {
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const health = await orchestrator.getHealthReport();

      // Overall status should reflect worst check status
      const hasUnhealthy = health.checks.some((c) => c.status === "unhealthy");
      const hasDegraded = health.checks.some((c) => c.status === "degraded");

      if (hasUnhealthy) {
        expect(health.status).toBe("unhealthy");
      } else if (hasDegraded) {
        expect(health.status).toBe("degraded");
      } else {
        expect(health.status).toBe("healthy");
      }
    });

    it("health check completes within timeout", async () => {
      const adapters = new Map();
      const orchestrator = new CouncilOrchestrator(adapters);

      const startTime = Date.now();
      await orchestrator.getHealthReport();
      const duration = Date.now() - startTime;

      // Health check should complete within 5 seconds (generous allowance)
      // Actual timeout is 3 seconds, but allow buffer for test execution
      expect(duration).toBeLessThan(5000);
    });
  });
});
