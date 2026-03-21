// ============================================================================
// @dantecode/debug-trail — ReplayOrchestrator Determinism Verification Tests
// Covers verifyReplayDeterminism for matched, diverged, empty, and missing file cases.
// ============================================================================

import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { AuditLogger } from "../audit-logger.js";
import { ReplayOrchestrator } from "../replay-orchestrator.js";

/** SHA-256 hash of a string, matching how the replay engine hashes file content. */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("ReplayOrchestrator — verifyReplayDeterminism", () => {
  it("session with file_write where afterHash matches current file → determinismRate = 1.0", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-replay-match-"));
    const fileDir = await mkdtemp(join(tmpdir(), "dt-replay-files-"));
    const filePath = join(fileDir, "matched.ts");
    const fileContent = "export const value = 42;\n";

    await writeFile(filePath, fileContent, "utf8");
    const expectedHash = sha256(fileContent);

    const sessionId = `sess_replay_match_${Date.now()}`;
    const logger = new AuditLogger({ config: { storageRoot }, sessionId });
    await logger.init();

    // Log a file_write event with afterHash matching the file's current content
    await logger.logFileWrite(filePath, undefined, expectedHash);
    await logger.flush({ endSession: false });

    const orchestrator = new ReplayOrchestrator({ storageRoot });
    const result = await orchestrator.verifyReplayDeterminism(sessionId);

    expect(result.total).toBe(1);
    expect(result.matched).toBe(1);
    expect(result.diverged).toBe(0);
    expect(result.determinismRate).toBe(1.0);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.matched).toBe(true);
    expect(result.results[0]!.replayHash).toBe(expectedHash);

    await rm(storageRoot, { recursive: true, force: true });
    await rm(fileDir, { recursive: true, force: true });
  });

  it("session with file_write where afterHash does not match current file → diverged > 0, determinismRate < 1.0", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-replay-diverge-"));
    const fileDir = await mkdtemp(join(tmpdir(), "dt-replay-div-files-"));
    const filePath = join(fileDir, "diverged.ts");

    // Write initial content and capture hash BEFORE modifying the file
    const originalContent = "export const original = true;\n";
    const originalHash = sha256(originalContent);

    // Now write DIFFERENT content to the file so current hash won't match
    const modifiedContent = "export const modified = true;\n";
    await writeFile(filePath, modifiedContent, "utf8");

    const sessionId = `sess_replay_diverge_${Date.now()}`;
    const logger = new AuditLogger({ config: { storageRoot }, sessionId });
    await logger.init();

    // Log event with the ORIGINAL hash — but the file now has different content
    await logger.logFileWrite(filePath, undefined, originalHash);
    await logger.flush({ endSession: false });

    const orchestrator = new ReplayOrchestrator({ storageRoot });
    const result = await orchestrator.verifyReplayDeterminism(sessionId);

    expect(result.total).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.diverged).toBe(1);
    expect(result.determinismRate).toBeLessThan(1.0);
    expect(result.determinismRate).toBe(0);
    expect(result.results[0]!.matched).toBe(false);
    // originalHash was the afterHash stored in the event
    expect(result.results[0]!.originalHash).toBe(originalHash);
    // replayHash is the current file content hash (not equal to originalHash)
    expect(result.results[0]!.replayHash).not.toBe(originalHash);

    await rm(storageRoot, { recursive: true, force: true });
    await rm(fileDir, { recursive: true, force: true });
  });

  it("session with no file_write events → determinismRate = 1.0 and total = 0", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-replay-empty-"));
    const sessionId = `sess_replay_empty_${Date.now()}`;
    const logger = new AuditLogger({ config: { storageRoot }, sessionId });
    await logger.init();

    // Log only non-file events
    await logger.logToolCall("myTool", { step: 1 });
    await logger.logModelDecision("gpt-4", "Some decision");
    await logger.logVerification("verify-stage", true);
    await logger.flush({ endSession: false });

    const orchestrator = new ReplayOrchestrator({ storageRoot });
    const result = await orchestrator.verifyReplayDeterminism(sessionId);

    // No file_write events with afterHash → total is 0, rate defaults to 1.0
    expect(result.total).toBe(0);
    expect(result.matched).toBe(0);
    expect(result.diverged).toBe(0);
    expect(result.determinismRate).toBe(1.0);
    expect(result.results).toHaveLength(0);

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("session with file_write for non-existent file → replayHash = 'file_missing'", async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), "dt-replay-missing-"));
    const sessionId = `sess_replay_missing_${Date.now()}`;
    const logger = new AuditLogger({ config: { storageRoot }, sessionId });
    await logger.init();

    const phantomPath = join(tmpdir(), `phantom-${Date.now()}.ts`);
    const storedHash = sha256("content that was there when the event was logged");

    // Log a file_write for a path that does NOT exist on disk
    await logger.logFileWrite(phantomPath, undefined, storedHash);
    await logger.flush({ endSession: false });

    const orchestrator = new ReplayOrchestrator({ storageRoot });
    const result = await orchestrator.verifyReplayDeterminism(sessionId);

    expect(result.total).toBe(1);
    expect(result.diverged).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.determinismRate).toBe(0);

    const verif = result.results[0]!;
    expect(verif.replayHash).toBe("file_missing");
    expect(verif.matched).toBe(false);
    expect(verif.originalHash).toBe(storedHash);

    await rm(storageRoot, { recursive: true, force: true });
  });
});
