// ============================================================================
// @dantecode/core — Task Circuit Breaker Tests
// Tests for 5-identical-failure threshold, re-read recovery, and escalation.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { TaskCircuitBreaker, hashErrorForTesting } from "./task-circuit-breaker.js";
import type { FailureAction } from "./task-circuit-breaker.js";

describe("TaskCircuitBreaker", () => {
  let breaker: TaskCircuitBreaker;

  beforeEach(() => {
    breaker = new TaskCircuitBreaker({
      identicalFailureThreshold: 5,
      maxRecoveryAttempts: 2,
    });
  });

  // --------------------------------------------------------------------------
  // Initial state
  // --------------------------------------------------------------------------

  describe("initial state", () => {
    it("starts in active state", () => {
      expect(breaker.getState()).toBe("active");
    });

    it("has zero total failures", () => {
      expect(breaker.getTotalFailures()).toBe(0);
    });

    it("has no escalations", () => {
      expect(breaker.getEscalations()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Failure counting — continue action
  // --------------------------------------------------------------------------

  describe("continue action (below threshold)", () => {
    it("returns continue for first failure", () => {
      const result = breaker.recordFailure("typecheck failed: TS2322", 1);
      expect(result.action).toBe("continue");
      expect(result.identicalCount).toBe(1);
      expect(result.state).toBe("active");
    });

    it("returns continue for failures under threshold", () => {
      for (let i = 0; i < 4; i++) {
        const result = breaker.recordFailure("typecheck failed: TS2322", i);
        expect(result.action).toBe("continue");
        expect(result.identicalCount).toBe(i + 1);
      }
    });

    it("tracks total failure count", () => {
      breaker.recordFailure("error A", 1);
      breaker.recordFailure("error B", 2);
      breaker.recordFailure("error C", 3);
      expect(breaker.getTotalFailures()).toBe(3);
    });

    it("treats different errors independently", () => {
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure("error alpha", i);
      }
      const result = breaker.recordFailure("error beta", 5);
      expect(result.action).toBe("continue");
      expect(result.identicalCount).toBe(1); // different error
    });
  });

  // --------------------------------------------------------------------------
  // Pause and recover action (threshold reached, recovery available)
  // --------------------------------------------------------------------------

  describe("pause_and_recover action", () => {
    it("triggers pause after 5 identical failures", () => {
      let result: FailureAction = {
        action: "continue",
        state: "active",
        identicalCount: 0,
        recoveryAttempts: 0,
      };
      for (let i = 0; i < 5; i++) {
        result = breaker.recordFailure("typecheck failed: TS2322", i);
      }
      expect(result.action).toBe("pause_and_recover");
      expect(result.state).toBe("paused");
      expect(result.recoveryAttempts).toBe(1);
    });

    it("resets identical count after triggering recovery", () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("typecheck failed: TS2322", i);
      }

      // After recovery, the same error should start counting from 0 again
      const result = breaker.recordFailure("typecheck failed: TS2322", 6);
      expect(result.action).toBe("continue");
      expect(result.identicalCount).toBe(1);
    });

    it("triggers second recovery after another 5 identical failures", () => {
      // First round: 5 failures → pause_and_recover
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("lint error", i);
      }

      // Second round: 5 more → second pause_and_recover
      let result: FailureAction = {
        action: "continue",
        state: "active",
        identicalCount: 0,
        recoveryAttempts: 0,
      };
      for (let i = 5; i < 10; i++) {
        result = breaker.recordFailure("lint error", i);
      }
      expect(result.action).toBe("pause_and_recover");
      expect(result.recoveryAttempts).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Escalation action (recovery exhausted)
  // --------------------------------------------------------------------------

  describe("escalate action", () => {
    it("escalates after exhausting all recovery attempts", () => {
      // First 5 → recovery 1
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("test failed: assert.equal", i);
      }

      // Next 5 → recovery 2
      for (let i = 5; i < 10; i++) {
        breaker.recordFailure("test failed: assert.equal", i);
      }

      // Next 5 → escalation (maxRecoveryAttempts = 2, exhausted)
      let result: FailureAction = {
        action: "continue",
        state: "active",
        identicalCount: 0,
        recoveryAttempts: 0,
      };
      for (let i = 10; i < 15; i++) {
        result = breaker.recordFailure("test failed: assert.equal", i);
      }
      expect(result.action).toBe("escalate");
      expect(result.state).toBe("escalated");
    });

    it("records escalation event", () => {
      // Exhaust recovery (5 + 5 + 5)
      for (let i = 0; i < 15; i++) {
        breaker.recordFailure("persistent error", i);
      }

      const escalations = breaker.getEscalations();
      expect(escalations).toHaveLength(1);
      expect(escalations[0]!.errorMessage).toBe("persistent error");
      expect(escalations[0]!.failureCount).toBe(5);
      expect(escalations[0]!.recoveryAttempts).toBe(2);
    });

    it("sets state to escalated", () => {
      for (let i = 0; i < 15; i++) {
        breaker.recordFailure("unrecoverable", i);
      }
      expect(breaker.getState()).toBe("escalated");
    });
  });

  // --------------------------------------------------------------------------
  // Success resets state
  // --------------------------------------------------------------------------

  describe("recordSuccess", () => {
    it("resets state to active after failures", () => {
      for (let i = 0; i < 3; i++) {
        breaker.recordFailure("error", i);
      }
      expect(breaker.getState()).toBe("active");

      breaker.recordSuccess();
      expect(breaker.getState()).toBe("active");
    });

    it("resets paused state to active", () => {
      for (let i = 0; i < 5; i++) {
        breaker.recordFailure("error", i);
      }
      expect(breaker.getState()).toBe("paused");

      breaker.recordSuccess();
      expect(breaker.getState()).toBe("active");
    });

    it("clears identical failure counts after success", () => {
      for (let i = 0; i < 4; i++) {
        breaker.recordFailure("error", i);
      }

      breaker.recordSuccess();

      // After success, the counter should restart from 1
      const result = breaker.recordFailure("error", 5);
      expect(result.identicalCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Reset
  // --------------------------------------------------------------------------

  describe("reset", () => {
    it("clears all state", () => {
      for (let i = 0; i < 10; i++) {
        breaker.recordFailure("error", i);
      }

      breaker.reset();
      expect(breaker.getState()).toBe("active");
      expect(breaker.getTotalFailures()).toBe(0);
      expect(breaker.getFailures()).toHaveLength(0);
      expect(breaker.getEscalations()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Custom options
  // --------------------------------------------------------------------------

  describe("custom options", () => {
    it("respects custom failure threshold", () => {
      const custom = new TaskCircuitBreaker({ identicalFailureThreshold: 2 });
      custom.recordFailure("error", 1);
      const result = custom.recordFailure("error", 2);
      expect(result.action).toBe("pause_and_recover");
    });

    it("respects custom max recovery attempts", () => {
      const custom = new TaskCircuitBreaker({
        identicalFailureThreshold: 1,
        maxRecoveryAttempts: 1,
      });

      // First failure → recovery
      custom.recordFailure("error", 1);

      // Second failure → escalation (only 1 recovery attempt allowed)
      const result = custom.recordFailure("error", 2);
      expect(result.action).toBe("escalate");
    });

    it("exposes threshold and max recovery via getters", () => {
      expect(breaker.getThreshold()).toBe(5);
      expect(breaker.getMaxRecoveryAttempts()).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // Error deduplication
  // --------------------------------------------------------------------------

  describe("error deduplication", () => {
    it("normalizes line numbers when comparing errors", () => {
      // These should be treated as identical (line numbers differ)
      const hash1 = hashErrorForTesting("Error at line 42: expected number");
      const hash2 = hashErrorForTesting("Error at line 99: expected number");
      expect(hash1).toBe(hash2);
    });

    it("normalizes whitespace when comparing errors", () => {
      const hash1 = hashErrorForTesting("type error:   too many   spaces");
      const hash2 = hashErrorForTesting("type error: too many spaces");
      expect(hash1).toBe(hash2);
    });

    it("treats structurally different errors as distinct", () => {
      const hash1 = hashErrorForTesting("TypeError: cannot read property of undefined");
      const hash2 = hashErrorForTesting("SyntaxError: unexpected token");
      expect(hash1).not.toBe(hash2);
    });
  });

  // --------------------------------------------------------------------------
  // Full lifecycle: active → paused → recovered → active
  // --------------------------------------------------------------------------

  describe("full lifecycle", () => {
    it("handles active → paused → success → active flow", () => {
      // Active: 4 failures (under threshold)
      for (let i = 0; i < 4; i++) {
        const r = breaker.recordFailure("typecheck error", i);
        expect(r.action).toBe("continue");
      }
      expect(breaker.getState()).toBe("active");

      // 5th failure: triggers pause
      const pauseResult = breaker.recordFailure("typecheck error", 4);
      expect(pauseResult.action).toBe("pause_and_recover");
      expect(breaker.getState()).toBe("paused");

      // Recovery succeeds
      breaker.recordSuccess();
      expect(breaker.getState()).toBe("active");

      // Can continue working normally
      const afterRecovery = breaker.recordFailure("different error", 5);
      expect(afterRecovery.action).toBe("continue");
      expect(afterRecovery.identicalCount).toBe(1);
    });
  });
});
