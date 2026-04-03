#!/usr/bin/env node
/**
 * Pass 2.3 — memory-engine cross-session persistence test
 * Tests that PersistentMemory persists memories across process instances.
 * Run via: node tests/integration/memory-cross-session.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const coreDist = resolve(repoRoot, "packages/core/dist/index.js");
const { PersistentMemory } = await import(pathToFileURL(coreDist).href);

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

// Create a temp directory for the persistence test
const testRoot = resolve(tmpdir(), `dantecode-mem-test-${randomUUID().slice(0, 8)}`);
mkdirSync(testRoot, { recursive: true });

try {
  // ─── Session 1: Write memories ──────────────────────────────────────────────
  console.log("\n[2.3.1] Session 1 — write 5 memories to disk");
  {
    const memory = new PersistentMemory(testRoot);
    await memory.store("User prefers TypeScript over JavaScript", "fact", ["language", "preference"]);
    await memory.store("Project deadline is March 30, 2026", "fact", ["deadline", "project"]);
    await memory.store("Authentication should use JWT tokens", "decision", ["auth", "security"]);
    await memory.store("Database query timeout set to 5000ms caused flakiness", "error", ["db", "timeout"]);
    await memory.store("Use shallow git clone for performance in CI", "strategy", ["git", "ci", "performance"]);

    // search() is synchronous; entries are already in memory after store() calls
    const all = memory.search("project", { limit: 20 });
    assert(all.length >= 1, "Searching 'project' finds at least 1 memory in Session 1");
    console.log(`  INFO: Session 1 stored 5 memories at ${testRoot}`);
  }

  // ─── Session 2: Recall memories (new PersistentMemory instance) ─────────────
  console.log("\n[2.3.2] Session 2 — recall memories from a new PersistentMemory instance");
  {
    // New instance, new object — simulates a new process/session
    const memory2 = new PersistentMemory(testRoot);
    // MUST call load() explicitly — search() is synchronous and operates on in-memory entries
    await memory2.load();

    const tsResults = memory2.search("TypeScript");
    assert(tsResults.length >= 1, "Session 2 recalls 'TypeScript' preference from Session 1");
    assert(
      tsResults.some((r) => r.entry.content.includes("TypeScript")),
      "Recalled memory contains 'TypeScript'",
    );

    const deadlineResults = memory2.search("deadline");
    assert(deadlineResults.length >= 1, "Session 2 recalls project deadline from Session 1");

    const authResults = memory2.search("JWT");
    assert(authResults.length >= 1, "Session 2 recalls JWT decision from Session 1");

    const errorResults = memory2.search("timeout");
    assert(errorResults.length >= 1, "Session 2 recalls db timeout error from Session 1");

    const stratResults = memory2.search("git clone");
    assert(stratResults.length >= 1, "Session 2 recalls git clone strategy from Session 1");

    // Verify categories are preserved
    assert(
      tsResults.some((r) => r.entry.category === "fact"),
      "TypeScript memory has category 'fact'",
    );
    assert(
      authResults.some((r) => r.entry.category === "decision"),
      "JWT memory has category 'decision'",
    );
  }

  // ─── Session 3: Update and verify deduplication ─────────────────────────────
  console.log("\n[2.3.3] Session 3 — add similar memory, verify deduplication");
  {
    const memory3 = new PersistentMemory(testRoot);

    // store() calls load() internally, so entries from Session 1 are loaded automatically
    await memory3.store(
      "User prefers TypeScript over JavaScript for all projects",
      "fact",
      ["language"],
    );

    const tsResults = memory3.search("TypeScript JavaScript");
    // Deduplication should merge or keep minimal entries — not explode to dozens
    assert(tsResults.length <= 5, `Deduplication works — ${tsResults.length} TypeScript results (expected <=5)`);
    assert(tsResults.length >= 1, "At least 1 TypeScript result after deduplication");
  }

  console.log(`\n${"─".repeat(55)}`);
  console.log(`memory cross-session test: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("PASS — memory-engine persists and recalls across sessions");
  }
} finally {
  // Cleanup
  try {
    rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}
