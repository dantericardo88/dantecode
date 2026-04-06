import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamRecovery } from "./stream-recovery.js";

describe("StreamRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("initializes with default options", () => {
    const sr = new StreamRecovery();
    expect(sr.chunks).toBe(0);
    expect(sr.retries).toBe(0);
    expect(sr.shouldRetry()).toBe(true);
  });

  it("initializes with custom options", () => {
    const sr = new StreamRecovery({ timeoutMs: 10000, maxRetries: 5 });
    expect(sr.shouldRetry()).toBe(true);
  });

  it("tracks activity via updateActivity", () => {
    const sr = new StreamRecovery();
    sr.updateActivity();
    sr.updateActivity();
    sr.updateActivity();
    expect(sr.chunks).toBe(3);
  });

  it("detects stalled stream after timeout", () => {
    const sr = new StreamRecovery({ timeoutMs: 3000 });
    expect(sr.isStalled()).toBe(false);

    vi.advanceTimersByTime(4000);
    expect(sr.isStalled()).toBe(true);
  });

  it("resets stall detection on updateActivity", () => {
    const sr = new StreamRecovery({ timeoutMs: 3000 });
    vi.advanceTimersByTime(2000);
    sr.updateActivity();
    vi.advanceTimersByTime(2000);
    expect(sr.isStalled()).toBe(false);
  });

  it("shouldRetry returns false after maxRetries", () => {
    const sr = new StreamRecovery({ maxRetries: 2 });
    expect(sr.shouldRetry()).toBe(true);
    sr.recordRetry();
    expect(sr.shouldRetry()).toBe(true);
    sr.recordRetry();
    expect(sr.shouldRetry()).toBe(false);
  });

  it("recordRetry returns new count", () => {
    const sr = new StreamRecovery();
    expect(sr.recordRetry()).toBe(1);
    expect(sr.recordRetry()).toBe(2);
  });

  it("resetForRetry resets activity and chunks but keeps retries", () => {
    const sr = new StreamRecovery({ timeoutMs: 3000 });
    sr.updateActivity();
    sr.updateActivity();
    sr.recordRetry();
    vi.advanceTimersByTime(5000);

    sr.resetForRetry();
    expect(sr.chunks).toBe(0);
    expect(sr.retries).toBe(1);
    expect(sr.isStalled()).toBe(false);
  });

  it("full reset clears everything", () => {
    const sr = new StreamRecovery();
    sr.updateActivity();
    sr.recordRetry();
    sr.recordRetry();

    sr.reset();
    expect(sr.chunks).toBe(0);
    expect(sr.retries).toBe(0);
    expect(sr.shouldRetry()).toBe(true);
  });

  it("timeSinceLastActivity tracks elapsed time", () => {
    const sr = new StreamRecovery();
    vi.advanceTimersByTime(1500);
    expect(sr.timeSinceLastActivity).toBe(1500);
  });
});
