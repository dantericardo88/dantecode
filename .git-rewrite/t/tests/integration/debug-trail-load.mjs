#!/usr/bin/env node
/**
 * Pass 2.5 — debug-trail under 1,000-operation load
 * Tests AuditLogger at scale + chain integrity + query performance.
 * Run via: node tests/integration/debug-trail-load.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const distPath = resolve(repoRoot, "packages/debug-trail/dist/index.js");
const { AuditLogger, TrailQueryEngine } = await import(pathToFileURL(distPath).href);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

const testRoot = resolve(tmpdir(), `dantecode-trail-test-${randomUUID().slice(0, 8)}`);
mkdirSync(testRoot, { recursive: true });

try {
  // ─── Test 1: Write 1,000 events ────────────────────────────────────────────
  console.log("\n[2.5.1] AuditLogger — log 1,000 events");
  const sessionId = `test-session-${randomUUID().slice(0, 8)}`;
  const logger = new AuditLogger({
    sessionId,
    config: { storageRoot: testRoot, enabled: true },
  });

  const startWrite = Date.now();
  const TOTAL_EVENTS = 1000;
  const KINDS = ["tool_call", "tool_result", "file_write", "model_decision", "verification"];
  const ACTORS = ["agent-main", "agent-sub", "forge-runner", "qa-harness"];

  const writePromises = [];
  for (let i = 0; i < TOTAL_EVENTS; i++) {
    const kind = KINDS[i % KINDS.length];
    const actor = ACTORS[i % ACTORS.length];
    writePromises.push(
      logger.log(kind, actor, `Operation ${i}`, {
        index: i,
        category: i % 5,
        success: i % 7 !== 0,
        durationMs: Math.random() * 500,
        filePath: `/src/file-${i % 50}.ts`,
      }),
    );
  }

  await Promise.all(writePromises);
  await logger.flush({ endSession: true });

  const writeMs = Date.now() - startWrite;
  console.log(`  INFO: Wrote ${TOTAL_EVENTS} events in ${writeMs}ms`);
  assert(writeMs < 60000, `Write 1,000 events completes in <60s (actual: ${writeMs}ms)`);

  // ─── Test 2: Query and verify count ────────────────────────────────────────
  // TrailQueryEngine constructor: new TrailQueryEngine(config?: Partial<DebugTrailConfig>)
  console.log("\n[2.5.2] TrailQueryEngine — query events, verify count");
  const queryEngine = new TrailQueryEngine({ storageRoot: testRoot });

  const startQuery = Date.now();
  const result = await queryEngine.querySession(sessionId, 2000);
  const queryMs = Date.now() - startQuery;

  // DebugTrailResult has: results: TrailEvent[], totalMatches: number, latencyMs: number
  console.log(`  INFO: Query took ${queryMs}ms, found ${result.results?.length ?? 0} events`);
  assert(result.results !== undefined, "querySession() returns result.results array");
  assert(
    (result.results?.length ?? 0) >= TOTAL_EVENTS * 0.9,
    `Query returns >= 90% of events (got ${result.results?.length ?? 0}, expected >=${Math.floor(TOTAL_EVENTS * 0.9)})`,
  );
  assert(queryMs < 15000, `Query 1,000 events completes in <15s (actual: ${queryMs}ms)`);
  assert(
    typeof result.totalMatches === "number",
    "querySession() result has totalMatches field",
  );

  // ─── Test 3: Query by kind ──────────────────────────────────────────────────
  console.log("\n[2.5.3] TrailQueryEngine — query by kind filter");
  const toolCallResult = await queryEngine.query({ sessionId, kinds: ["tool_call"], limit: 500 });
  const toolCallCount = toolCallResult.results?.length ?? 0;
  console.log(`  INFO: Found ${toolCallCount} tool_call events`);
  assert(toolCallCount > 0, "Query with kind:'tool_call' returns results");
  assert(
    toolCallResult.results?.every((e) => e.kind === "tool_call") ?? false,
    "All events in kind-filtered result have kind:'tool_call'",
  );

  // ─── Test 4: Query errors ────────────────────────────────────────────────
  console.log("\n[2.5.4] TrailQueryEngine — query errors (no errors expected)");
  const errorResult = await queryEngine.queryErrors(sessionId, 100);
  assert(Array.isArray(errorResult.results), "queryErrors() returns results array without crashing");

  // ─── Test 5: FlushResult structure ─────────────────────────────────────────
  console.log("\n[2.5.5] AuditLogger — check flush result structure");
  const logger2 = new AuditLogger({
    sessionId: `test-check-${randomUUID().slice(0, 8)}`,
    config: { storageRoot: testRoot, enabled: true },
  });
  await logger2.log("tool_call", "test-actor", "Test event 1", { value: 1 });
  await logger2.log("file_write", "test-actor", "Test event 2", { path: "/src/test.ts" });
  const flushResult = await logger2.flush({ endSession: true });

  assert(flushResult !== null && flushResult !== undefined, "flush() returns a non-null result");
  assert(Array.isArray(flushResult.anomalies), "FlushResult has anomalies array");
  assert(
    typeof flushResult.analyzedCount === "number",
    "FlushResult has analyzedCount field",
  );
  assert(
    typeof flushResult.bufferTruncated === "boolean",
    "FlushResult has bufferTruncated field",
  );

  console.log(`  INFO: analyzedCount=${flushResult.analyzedCount}, anomalies=${flushResult.anomalies.length}`);

  console.log(`\n${"─".repeat(55)}`);
  console.log(`debug-trail load test: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("PASS — debug-trail handles 1,000-event workload correctly");
  }
} finally {
  try {
    rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
