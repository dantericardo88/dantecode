// ============================================================================
// @dantecode/core — Circuit Breaker Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 60_000 });
  });

  // --------------------------------------------------------------------------
  // Initial state
  // --------------------------------------------------------------------------

  describe("initial state", () => {
    it("starts in closed state for unknown providers", () => {
      expect(breaker.getState("grok")).toBe("closed");
      expect(breaker.getState("anthropic")).toBe("closed");
    });
  });

  // --------------------------------------------------------------------------
  // Closed -> Open transition
  // --------------------------------------------------------------------------

  describe("closed -> open transition", () => {
    it("stays closed after fewer failures than threshold", async () => {
      const fail = () => Promise.reject(new Error("provider error"));

      // 2 failures (threshold is 5)
      await expect(breaker.execute("grok", fail)).rejects.toThrow("provider error");
      expect(breaker.getState("grok")).toBe("closed");

      await expect(breaker.execute("grok", fail)).rejects.toThrow("provider error");
      expect(breaker.getState("grok")).toBe("closed");
    });

    it("opens after reaching failure threshold", async () => {
      const fail = () => Promise.reject(new Error("provider error"));

      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow("provider error");
      }

      expect(breaker.getState("grok")).toBe("open");
    });

    it("rejects immediately when circuit is open", async () => {
      const fail = () => Promise.reject(new Error("provider error"));

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow("provider error");
      }

      // Now attempts should be rejected with CircuitOpenError
      await expect(
        breaker.execute("grok", () => Promise.resolve("should not run")),
      ).rejects.toThrow(CircuitOpenError);
    });

    it("CircuitOpenError contains provider name", async () => {
      const fail = () => Promise.reject(new Error("err"));
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("anthropic", fail)).rejects.toThrow();
      }

      try {
        await breaker.execute("anthropic", () => Promise.resolve("x"));
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        expect((err as CircuitOpenError).provider).toBe("anthropic");
      }
    });
  });

  // --------------------------------------------------------------------------
  // Open -> Half-Open transition
  // --------------------------------------------------------------------------

  describe("open -> half-open transition", () => {
    it("transitions to half-open after reset timeout", async () => {
      const fail = () => Promise.reject(new Error("err"));

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }
      expect(breaker.getState("grok")).toBe("open");

      // Advance time past the reset timeout
      vi.useFakeTimers();
      vi.advanceTimersByTime(60_001);

      expect(breaker.getState("grok")).toBe("half-open");

      vi.useRealTimers();
    });

    it("does not transition before reset timeout", async () => {
      const fail = () => Promise.reject(new Error("err"));

      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }

      vi.useFakeTimers();
      vi.advanceTimersByTime(30_000); // Only 30s, need 60s

      expect(breaker.getState("grok")).toBe("open");

      vi.useRealTimers();
    });
  });

  // --------------------------------------------------------------------------
  // Half-Open -> Closed (on success)
  // --------------------------------------------------------------------------

  describe("half-open -> closed on success", () => {
    it("resets to closed when half-open trial succeeds", async () => {
      const fail = () => Promise.reject(new Error("err"));

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }

      // Advance to half-open
      vi.useFakeTimers();
      vi.advanceTimersByTime(60_001);
      expect(breaker.getState("grok")).toBe("half-open");

      // Successful trial
      const result = await breaker.execute("grok", () => Promise.resolve("success!"));
      expect(result).toBe("success!");
      expect(breaker.getState("grok")).toBe("closed");

      vi.useRealTimers();
    });
  });

  // --------------------------------------------------------------------------
  // Half-Open -> Open (on failure)
  // --------------------------------------------------------------------------

  describe("half-open -> open on failure", () => {
    it("re-opens circuit when half-open trial fails", async () => {
      const fail = () => Promise.reject(new Error("err"));

      // Open the circuit
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }

      // Advance to half-open
      vi.useFakeTimers();
      vi.advanceTimersByTime(60_001);
      expect(breaker.getState("grok")).toBe("half-open");

      // Failed trial
      await expect(breaker.execute("grok", fail)).rejects.toThrow("err");
      expect(breaker.getState("grok")).toBe("open");

      vi.useRealTimers();
    });
  });

  // --------------------------------------------------------------------------
  // Success resets failure count
  // --------------------------------------------------------------------------

  describe("success resets failure count", () => {
    it("resets consecutive failures on success", async () => {
      const fail = () => Promise.reject(new Error("err"));
      const succeed = () => Promise.resolve("ok");

      // 2 failures (under threshold)
      await expect(breaker.execute("grok", fail)).rejects.toThrow();
      await expect(breaker.execute("grok", fail)).rejects.toThrow();

      // 1 success resets the count
      await breaker.execute("grok", succeed);

      // 2 more failures should not open (count reset to 0)
      await expect(breaker.execute("grok", fail)).rejects.toThrow();
      await expect(breaker.execute("grok", fail)).rejects.toThrow();
      expect(breaker.getState("grok")).toBe("closed");
    });
  });

  // --------------------------------------------------------------------------
  // Manual reset
  // --------------------------------------------------------------------------

  describe("manual reset", () => {
    it("resets an open circuit to closed", async () => {
      const fail = () => Promise.reject(new Error("err"));

      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }
      expect(breaker.getState("grok")).toBe("open");

      breaker.reset("grok");
      expect(breaker.getState("grok")).toBe("closed");
    });

    it("allows execution after manual reset", async () => {
      const fail = () => Promise.reject(new Error("err"));

      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }

      breaker.reset("grok");
      const result = await breaker.execute("grok", () => Promise.resolve("ok"));
      expect(result).toBe("ok");
    });
  });

  // --------------------------------------------------------------------------
  // Provider isolation
  // --------------------------------------------------------------------------

  describe("provider isolation", () => {
    it("tracks state independently per provider", async () => {
      const fail = () => Promise.reject(new Error("err"));

      // Open circuit for grok
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }

      // Anthropic should still be closed
      expect(breaker.getState("grok")).toBe("open");
      expect(breaker.getState("anthropic")).toBe("closed");

      // Anthropic should still work
      const result = await breaker.execute("anthropic", () => Promise.resolve("ok"));
      expect(result).toBe("ok");
    });
  });

  // --------------------------------------------------------------------------
  // Custom options
  // --------------------------------------------------------------------------

  describe("custom options", () => {
    it("respects custom failure threshold", async () => {
      const custom = new CircuitBreaker({ failureThreshold: 1 });
      const fail = () => Promise.reject(new Error("err"));

      // Just 1 failure should open the circuit
      await expect(custom.execute("grok", fail)).rejects.toThrow();
      expect(custom.getState("grok")).toBe("open");
    });

    it("respects custom reset timeout", async () => {
      const custom = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5_000 });
      const fail = () => Promise.reject(new Error("err"));

      await expect(custom.execute("grok", fail)).rejects.toThrow();
      expect(custom.getState("grok")).toBe("open");

      vi.useFakeTimers();
      vi.advanceTimersByTime(5_001);
      expect(custom.getState("grok")).toBe("half-open");
      vi.useRealTimers();
    });
  });

  // --------------------------------------------------------------------------
  // Full cycle: closed -> open -> half-open -> closed
  // --------------------------------------------------------------------------

  describe("full state cycle", () => {
    it("completes closed -> open -> half-open -> closed", async () => {
      const fail = () => Promise.reject(new Error("err"));

      // Step 1: closed -> open (5 failures)
      expect(breaker.getState("grok")).toBe("closed");
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute("grok", fail)).rejects.toThrow();
      }
      expect(breaker.getState("grok")).toBe("open");

      // Step 2: open -> half-open (wait for timeout)
      vi.useFakeTimers();
      vi.advanceTimersByTime(60_001);
      expect(breaker.getState("grok")).toBe("half-open");

      // Step 3: half-open -> closed (successful trial)
      const result = await breaker.execute("grok", () => Promise.resolve("recovered"));
      expect(result).toBe("recovered");
      expect(breaker.getState("grok")).toBe("closed");

      vi.useRealTimers();
    });
  });
});
