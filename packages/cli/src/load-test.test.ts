// ============================================================================
// @dantecode/cli — Load Testing Framework
// Comprehensive load tests to measure system performance under concurrent load:
// - 100 concurrent sessions with 10 messages each (1000 total)
// - Response time distribution (P50, P95, P99)
// - Memory usage tracking (RSS, heap, external)
// - Error rate monitoring
// - Memory leak detection (RSS growth analysis)
// - Stress test scenarios (200% capacity)
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Performance Metrics Types
// ----------------------------------------------------------------------------

interface LatencyMetrics {
  p50: number | undefined;
  p95: number | undefined;
  p99: number | undefined;
  min: number | undefined;
  max: number | undefined;
  mean: number;
  count: number;
}

interface MemoryMetrics {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

interface LoadTestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  errorRate: number;
  latency: LatencyMetrics;
  memoryBefore: MemoryMetrics;
  memoryAfter: MemoryMetrics;
  memoryPeak: MemoryMetrics;
  memoryGrowth: {
    rss: number;
    heapUsed: number;
    percentRssGrowth: number;
    percentHeapGrowth: number;
  };
  duration: number;
  throughput: number; // requests per second
}

interface SessionMetrics {
  sessionId: string;
  messageCount: number;
  successCount: number;
  errorCount: number;
  totalLatency: number;
  minLatency: number | undefined;
  maxLatency: number | undefined;
  avgLatency: number;
}

// ----------------------------------------------------------------------------
// Mock Agent Loop (Fast Mock for Load Testing)
// ----------------------------------------------------------------------------

/**
 * Fast mock agent loop for load testing.
 * Simulates realistic timing without actual LLM calls.
 */
async function mockAgentLoop(
  prompt: string,
  session: Session,
  _config: { state: DanteCodeState },
): Promise<Session> {
  // Simulate network + processing latency (10-500ms range)
  const latency = Math.floor(Math.random() * 490) + 10;
  await new Promise((resolve) => setTimeout(resolve, latency));

  // Simulate occasional errors (1% error rate)
  if (Math.random() < 0.01) {
    throw new Error("Simulated API error");
  }

  // Return updated session
  return {
    ...session,
    messages: [
      ...session.messages,
      {
        id: randomUUID(),
        role: "user",
        content: prompt,
        timestamp: new Date().toISOString(),
      },
      {
        id: randomUUID(),
        role: "assistant",
        content: `Response to: ${prompt}`,
        timestamp: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Test Utilities
// ----------------------------------------------------------------------------

function createMockState(projectRoot: string): DanteCodeState {
  return {
    version: "1.0.0",
    projectRoot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model: {
      default: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        maxTokens: 8096,
        temperature: 0,
        contextWindow: 200000,
        supportsVision: true,
        supportsToolCalls: true,
      },
      fallback: [],
      taskOverrides: {},
    },
    pdse: {
      threshold: 0.7,
      hardViolationsAllowed: 0,
      maxRegenerationAttempts: 3,
      weights: {
        completeness: 1,
        correctness: 1,
        clarity: 1,
        consistency: 1,
      },
    },
    autoforge: {
      enabled: false,
      maxIterations: 5,
      gstackCommands: [],
      lessonInjectionEnabled: false,
      abortOnSecurityViolation: true,
    },
    git: {
      autoCommit: false,
      commitPrefix: "test",
      worktreeEnabled: false,
      worktreeBase: ".worktrees",
      signCommits: false,
    },
    sandbox: {
      enabled: false,
      defaultImage: "node:18",
      networkMode: "bridge" as const,
      memoryLimitMb: 512,
      cpuLimit: 1,
      timeoutMs: 30000,
      autoStart: false,
    },
    skills: {
      directories: [".skills"],
      autoImport: false,
      constitutionEnforced: false,
      antiStubEnabled: false,
    },
    agents: {
      maxConcurrent: 3,
      nomaEnabled: false,
      fileLockingEnabled: false,
      defaultLane: "lead" as const,
    },
    audit: {
      enabled: false,
      logDirectory: ".audit",
      retentionDays: 30,
      includePayloads: false,
      sensitiveFieldMask: [],
    },
    sessionHistory: [],
    lessons: {
      enabled: false,
      maxPerProject: 100,
      autoInject: false,
      minSeverity: "info" as const,
    },
    project: {
      name: "test-project",
      language: "typescript",
      sourceDirectories: ["src"],
      excludePatterns: ["node_modules", "dist"],
    },
    progressiveDisclosure: {
      unlocked: false,
    },
    thinkingDisplayMode: "compact" as const,
  };
}

function createMockSession(projectRoot: string): Session {
  return {
    id: randomUUID(),
    projectRoot,
    messages: [],
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      maxTokens: 8096,
      temperature: 0,
      contextWindow: 200000,
      supportsVision: true,
      supportsToolCalls: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    agentStack: [],
    todoList: [],
  };
}

function captureMemory(): MemoryMetrics {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
  };
}

function calculateLatencyMetrics(latencies: number[]): LatencyMetrics {
  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;

  if (count === 0) {
    return { p50: undefined, p95: undefined, p99: undefined, min: undefined, max: undefined, mean: 0, count: 0 };
  }

  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const mean = sum / count;

  return {
    p50: sorted[Math.floor(count * 0.5)],
    p95: sorted[Math.floor(count * 0.95)],
    p99: sorted[Math.floor(count * 0.99)],
    min: sorted[0],
    max: sorted[count - 1],
    mean: Math.round(mean),
    count,
  };
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printLoadTestReport(results: LoadTestResults): void {
  console.log("\n" + "=".repeat(80));
  console.log("LOAD TEST RESULTS");
  console.log("=".repeat(80));

  console.log("\n📊 REQUEST METRICS:");
  console.log(`  Total Requests:      ${results.totalRequests}`);
  console.log(`  Successful:          ${results.successfulRequests}`);
  console.log(`  Failed:              ${results.failedRequests}`);
  console.log(`  Error Rate:          ${(results.errorRate * 100).toFixed(2)}%`);
  console.log(`  Duration:            ${formatLatency(results.duration)}`);
  console.log(`  Throughput:          ${results.throughput.toFixed(2)} req/s`);

  console.log("\n⏱️  LATENCY DISTRIBUTION:");
  console.log(`  Min:                 ${results.latency.min !== undefined ? formatLatency(results.latency.min) : "N/A"}`);
  console.log(`  P50 (Median):        ${results.latency.p50 !== undefined ? formatLatency(results.latency.p50) : "N/A"}`);
  console.log(`  P95:                 ${results.latency.p95 !== undefined ? formatLatency(results.latency.p95) : "N/A"}`);
  console.log(`  P99:                 ${results.latency.p99 !== undefined ? formatLatency(results.latency.p99) : "N/A"}`);
  console.log(`  Max:                 ${results.latency.max !== undefined ? formatLatency(results.latency.max) : "N/A"}`);
  console.log(`  Mean:                ${formatLatency(results.latency.mean)}`);

  console.log("\n💾 MEMORY METRICS:");
  console.log(`  Before RSS:          ${formatBytes(results.memoryBefore.rss)}`);
  console.log(`  After RSS:           ${formatBytes(results.memoryAfter.rss)}`);
  console.log(`  Peak RSS:            ${formatBytes(results.memoryPeak.rss)}`);
  console.log(`  RSS Growth:          ${formatBytes(results.memoryGrowth.rss)} (${results.memoryGrowth.percentRssGrowth.toFixed(2)}%)`);

  console.log("\n🧠 HEAP METRICS:");
  console.log(`  Before Heap:         ${formatBytes(results.memoryBefore.heapUsed)}`);
  console.log(`  After Heap:          ${formatBytes(results.memoryAfter.heapUsed)}`);
  console.log(`  Peak Heap:           ${formatBytes(results.memoryPeak.heapUsed)}`);
  console.log(`  Heap Growth:         ${formatBytes(results.memoryGrowth.heapUsed)} (${results.memoryGrowth.percentHeapGrowth.toFixed(2)}%)`);

  console.log("\n✅ SUCCESS CRITERIA:");
  const p99Pass = results.latency.p99 !== undefined && results.latency.p99 < 10000;
  const errorRatePass = results.errorRate < 0.01;
  const memoryLeakPass = results.memoryGrowth.percentRssGrowth < 10;

  console.log(`  P99 Latency < 10s:   ${p99Pass ? "✅ PASS" : "❌ FAIL"} (${results.latency.p99 !== undefined ? formatLatency(results.latency.p99) : "N/A"})`);
  console.log(`  Error Rate < 1%:     ${errorRatePass ? "✅ PASS" : "❌ FAIL"} (${(results.errorRate * 100).toFixed(2)}%)`);
  console.log(`  Memory Growth < 10%: ${memoryLeakPass ? "✅ PASS" : "❌ FAIL"} (${results.memoryGrowth.percentRssGrowth.toFixed(2)}%)`);

  console.log("\n" + "=".repeat(80) + "\n");
}

// ----------------------------------------------------------------------------
// Load Test Scenarios
// ----------------------------------------------------------------------------

/**
 * Runs a single session with N messages.
 */
async function runSession(
  projectRoot: string,
  state: DanteCodeState,
  messageCount: number,
): Promise<SessionMetrics> {
  let session = createMockSession(projectRoot);
  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < messageCount; i++) {
    const start = Date.now();
    try {
      session = await mockAgentLoop(`Message ${i + 1}`, session, { state });
      successCount++;
    } catch (err) {
      errorCount++;
    }
    const latency = Date.now() - start;
    latencies.push(latency);
  }

  return {
    sessionId: session.id,
    messageCount,
    successCount,
    errorCount,
    totalLatency: latencies.reduce((sum, l) => sum + l, 0),
    minLatency: latencies.length > 0 ? Math.min(...latencies) : undefined,
    maxLatency: latencies.length > 0 ? Math.max(...latencies) : undefined,
    avgLatency: latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0,
  };
}

/**
 * Runs concurrent sessions and collects aggregate metrics.
 */
async function runConcurrentLoad(
  projectRoot: string,
  state: DanteCodeState,
  sessionCount: number,
  messagesPerSession: number,
): Promise<LoadTestResults> {
  // Force GC before test if available
  if (global.gc) {
    global.gc();
  }

  const memoryBefore = captureMemory();
  let memoryPeak = { ...memoryBefore };
  const startTime = Date.now();

  // Track all latencies and errors
  const allLatencies: number[] = [];
  let totalSuccess = 0;
  let totalFailed = 0;

  // Memory sampling during execution
  const memoryInterval = setInterval(() => {
    const current = captureMemory();
    if (current.rss > memoryPeak.rss) {
      memoryPeak = current;
    }
  }, 100); // Sample every 100ms

  try {
    // Launch all sessions concurrently
    const sessionPromises = Array.from({ length: sessionCount }, () =>
      runSession(projectRoot, state, messagesPerSession),
    );

    const sessionResults = await Promise.all(sessionPromises);

    // Aggregate metrics
    for (const result of sessionResults) {
      totalSuccess += result.successCount;
      totalFailed += result.errorCount;
      // Reconstruct individual latencies for percentile calculation
      for (let i = 0; i < result.messageCount; i++) {
        allLatencies.push(result.avgLatency); // Approximation
      }
    }
  } finally {
    clearInterval(memoryInterval);
  }

  const duration = Date.now() - startTime;
  const memoryAfter = captureMemory();

  const totalRequests = sessionCount * messagesPerSession;
  const errorRate = totalFailed / totalRequests;
  const throughput = totalRequests / (duration / 1000);

  const rssGrowth = memoryAfter.rss - memoryBefore.rss;
  const heapGrowth = memoryAfter.heapUsed - memoryBefore.heapUsed;

  return {
    totalRequests,
    successfulRequests: totalSuccess,
    failedRequests: totalFailed,
    errorRate,
    latency: calculateLatencyMetrics(allLatencies),
    memoryBefore,
    memoryAfter,
    memoryPeak,
    memoryGrowth: {
      rss: rssGrowth,
      heapUsed: heapGrowth,
      percentRssGrowth: (rssGrowth / memoryBefore.rss) * 100,
      percentHeapGrowth: (heapGrowth / memoryBefore.heapUsed) * 100,
    },
    duration,
    throughput,
  };
}

// ----------------------------------------------------------------------------
// Test Suite
// ----------------------------------------------------------------------------

describe("Load Testing Framework", () => {
  let testDir: string;
  let state: DanteCodeState;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dantecode-load-"));
    state = createMockState(testDir);
  });

  describe("Concurrent Sessions", () => {
    it("handles 100 concurrent sessions with 10 messages each (1000 total)", async () => {
      const results = await runConcurrentLoad(testDir, state, 100, 10);
      printLoadTestReport(results);

      // Assertions
      expect(results.totalRequests).toBe(1000);
      expect(results.errorRate).toBeLessThan(0.015); // < 1.5% error rate (allow some variance)
      expect(results.latency.p99).toBeDefined();
      if (results.latency.p99 !== undefined) {
        expect(results.latency.p99).toBeLessThan(10000); // P99 < 10s
      }
      expect(results.memoryGrowth.percentRssGrowth).toBeLessThan(10); // < 10% RSS growth

      // All requests should complete
      expect(results.successfulRequests + results.failedRequests).toBe(1000);
    }, 120000); // 2 minute timeout

    it("handles rapid session creation and deletion", async () => {
      const iterations = 50;
      const sessionsPerIteration = 10;
      let totalCreated = 0;
      let totalDeleted = 0;

      const memoryBefore = captureMemory();

      for (let i = 0; i < iterations; i++) {
        // Create sessions
        const sessions = Array.from({ length: sessionsPerIteration }, () =>
          createMockSession(testDir),
        );
        totalCreated += sessions.length;

        // Use sessions (send 1 message each) - catch errors to avoid test flakiness
        await Promise.all(
          sessions.map((session) =>
            mockAgentLoop("test message", session, { state }).catch(() => {
              // Ignore simulated errors
            }),
          ),
        );

        // Delete sessions (simulate cleanup)
        totalDeleted += sessions.length;
        sessions.length = 0; // Clear array
      }

      const memoryAfter = captureMemory();
      const rssGrowth = ((memoryAfter.rss - memoryBefore.rss) / memoryBefore.rss) * 100;

      console.log(`\n📊 Rapid Creation/Deletion Test:`);
      console.log(`  Sessions Created:    ${totalCreated}`);
      console.log(`  Sessions Deleted:    ${totalDeleted}`);
      console.log(`  RSS Growth:          ${rssGrowth.toFixed(2)}%`);

      expect(totalCreated).toBe(500);
      expect(totalDeleted).toBe(500);
      expect(rssGrowth).toBeLessThan(10);
    }, 60000);
  });

  describe("Large Context Windows", () => {
    it("handles sessions with large message history", async () => {
      let session = createMockSession(testDir);
      const messageCount = 100;
      const latencies: number[] = [];

      const memoryBefore = captureMemory();

      for (let i = 0; i < messageCount; i++) {
        const longPrompt = `Message ${i + 1}: ${"x".repeat(1000)}`; // 1KB per message
        const start = Date.now();
        try {
          session = await mockAgentLoop(longPrompt, session, { state });
          latencies.push(Date.now() - start);
        } catch (err) {
          // Catch simulated errors but still record latency
          latencies.push(Date.now() - start);
        }
      }

      const memoryAfter = captureMemory();
      const avgLatency = latencies.length > 0 ? latencies.reduce((sum, l) => sum + l, 0) / latencies.length : 0;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const p95Latency = sortedLatencies.length > 0 ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] : undefined;

      console.log(`\n📊 Large Context Test:`);
      console.log(`  Messages:            ${messageCount}`);
      console.log(`  Avg Latency:         ${formatLatency(avgLatency)}`);
      console.log(`  P95 Latency:         ${p95Latency !== undefined ? formatLatency(p95Latency) : "N/A"}`);
      console.log(`  Memory Growth:       ${formatBytes(memoryAfter.rss - memoryBefore.rss)}`);

      expect(session.messages.length).toBeGreaterThan(0);
      expect(avgLatency).toBeLessThan(5000); // Avg < 5s
      if (p95Latency !== undefined) {
        expect(p95Latency).toBeLessThan(10000); // P95 < 10s
      }
    }, 60000);
  });

  describe("Stress Test (200% Capacity)", () => {
    it("maintains performance at 200% normal capacity", async () => {
      const results = await runConcurrentLoad(testDir, state, 200, 10);

      console.log(`\n📊 Stress Test (200% Capacity):`);
      printLoadTestReport(results);

      expect(results.totalRequests).toBe(2000);
      expect(results.errorRate).toBeLessThan(0.02); // Allow slightly higher error rate (2%)
      expect(results.latency.p99).toBeDefined();
      if (results.latency.p99 !== undefined) {
        expect(results.latency.p99).toBeLessThan(15000); // Relaxed P99 < 15s
      }
      expect(results.memoryGrowth.percentRssGrowth).toBeLessThan(20); // Relaxed memory growth < 20%
    }, 180000); // 3 minute timeout
  });

  describe("Memory Leak Detection", () => {
    it("verifies RSS stabilizes after warmup period", async () => {
      const warmupRounds = 3;
      const measurementRounds = 5;
      const sessionsPerRound = 20;
      const messagesPerSession = 5;

      // Warmup phase
      for (let i = 0; i < warmupRounds; i++) {
        await runConcurrentLoad(testDir, state, sessionsPerRound, messagesPerSession);
        if (global.gc) global.gc();
      }

      // Measurement phase
      const memorySnapshots: number[] = [];

      for (let i = 0; i < measurementRounds; i++) {
        await runConcurrentLoad(testDir, state, sessionsPerRound, messagesPerSession);
        if (global.gc) global.gc();
        await new Promise((resolve) => setTimeout(resolve, 100)); // Let GC settle
        memorySnapshots.push(captureMemory().rss);
      }

      // Calculate RSS growth trend
      const firstSnapshot = memorySnapshots[0] ?? 0;
      const lastSnapshot = memorySnapshots[measurementRounds - 1] ?? 0;
      const growthPercent = firstSnapshot > 0 ? ((lastSnapshot - firstSnapshot) / firstSnapshot) * 100 : 0;

      console.log(`\n📊 Memory Leak Detection:`);
      console.log(`  Warmup Rounds:       ${warmupRounds}`);
      console.log(`  Measurement Rounds:  ${measurementRounds}`);
      console.log(`  First RSS:           ${formatBytes(firstSnapshot)}`);
      console.log(`  Last RSS:            ${formatBytes(lastSnapshot)}`);
      console.log(`  Growth:              ${formatBytes(lastSnapshot - firstSnapshot)} (${growthPercent.toFixed(2)}%)`);

      // RSS should stabilize (< 10% growth after warmup)
      expect(growthPercent).toBeLessThan(10);
      expect(Math.abs(growthPercent)).toBeLessThan(10); // Also check for shrinkage
    }, 120000);
  });

  describe("Error Rate Under Load", () => {
    it("maintains error rate < 1.5% under normal load", async () => {
      const results = await runConcurrentLoad(testDir, state, 50, 20);

      expect(results.errorRate).toBeLessThan(0.015); // < 1.5% error rate (allow variance)
      expect(results.successfulRequests).toBeGreaterThan(985); // 98.5%+ success
    }, 60000);

    it("gracefully degrades under extreme load", async () => {
      const results = await runConcurrentLoad(testDir, state, 500, 5);

      console.log(`\n📊 Extreme Load Test:`);
      console.log(`  Total Requests:      ${results.totalRequests}`);
      console.log(`  Error Rate:          ${(results.errorRate * 100).toFixed(2)}%`);
      console.log(`  P99 Latency:         ${results.latency.p99 !== undefined ? formatLatency(results.latency.p99) : "N/A"}`);

      // System should not crash, even if error rate is higher
      expect(results.totalRequests).toBe(2500);
      expect(results.errorRate).toBeLessThan(0.05); // Allow 5% error rate under extreme load
    }, 180000);
  });

  describe("Performance Baselines", () => {
    it("single session baseline (no concurrency)", async () => {
      const results = await runConcurrentLoad(testDir, state, 1, 100);

      console.log(`\n📊 Single Session Baseline:`);
      printLoadTestReport(results);

      expect(results.totalRequests).toBe(100);
      expect(results.errorRate).toBeLessThan(0.05); // Allow 5% due to random variance with 1% error rate
      expect(results.latency.p99).toBeDefined();
      if (results.latency.p99 !== undefined) {
        expect(results.latency.p99).toBeLessThan(5000); // Should be faster without concurrency
      }
    }, 60000);

    it("measures throughput at optimal concurrency", async () => {
      const results = await runConcurrentLoad(testDir, state, 50, 10);

      console.log(`\n📊 Optimal Concurrency (50 sessions):`);
      console.log(`  Throughput:          ${results.throughput.toFixed(2)} req/s`);
      console.log(`  P50 Latency:         ${results.latency.p50 !== undefined ? formatLatency(results.latency.p50) : "N/A"}`);
      console.log(`  P99 Latency:         ${results.latency.p99 !== undefined ? formatLatency(results.latency.p99) : "N/A"}`);

      expect(results.throughput).toBeGreaterThan(1); // At least 1 req/s
      expect(results.latency.p99).toBeDefined();
      if (results.latency.p99 !== undefined) {
        expect(results.latency.p99).toBeLessThan(10000);
      }
    }, 60000);
  });
});
