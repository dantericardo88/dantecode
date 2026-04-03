// ============================================================================
// @dantecode/debug-trail — AuditLogger Evidence Chain Tests
// Covers getChainStats, sealSession, exportEvidenceChain, flush chain behavior
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { AuditLogger } from "../audit-logger.js";
import { EvidenceSealer } from "@dantecode/evidence-chain";

describe("AuditLogger — Evidence Chain", () => {
  let storageRoot: string;
  let logger: AuditLogger;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "dt-evidence-"));
    logger = new AuditLogger({ config: { storageRoot }, sessionId: `sess_evidence_${Date.now()}` });
    await logger.init();
  });

  it("logging a file_write increases chain length by 1", async () => {
    const statsBefore = logger.getChainStats();
    const lengthBefore = statsBefore!.chainLength;

    await logger.logFileWrite("/tmp/test.ts");

    const statsAfter = logger.getChainStats();
    expect(statsAfter).not.toBeNull();
    expect(statsAfter!.chainLength).toBe(lengthBefore + 1);
  });

  it("logging a file_write with beforeHash/afterHash creates a receipt", async () => {
    const beforeHash = "a".repeat(64);
    const afterHash = "b".repeat(64);

    await logger.logFileWrite("/tmp/test.ts", beforeHash, afterHash);

    const stats = logger.getChainStats();
    expect(stats).not.toBeNull();
    expect(stats!.receiptCount).toBeGreaterThan(0);
  });

  it("logging 100 events produces a chain where verifyIntegrity returns true", async () => {
    for (let i = 0; i < 100; i++) {
      await logger.logToolCall(`tool_${i}`, { index: i });
    }

    const stats = logger.getChainStats();
    expect(stats).not.toBeNull();
    expect(stats!.integrityVerified).toBe(true);
  });

  it("logging 10 events produces a non-empty 64-char hex Merkle root", async () => {
    for (let i = 0; i < 10; i++) {
      await logger.logModelDecision("gpt-4", `Decision ${i}`);
    }

    const stats = logger.getChainStats();
    expect(stats).not.toBeNull();
    const root = stats!.merkleRoot;
    // Must be a valid 64-char hex string (not all-zeros placeholder)
    expect(root).toMatch(/^[0-9a-f]{64}$/i);
    expect(root).not.toBe("0".repeat(64));
  });

  it("flush() appends an integrity-check bundle — chainLength increases", async () => {
    await logger.logFileWrite("/tmp/flush-test.ts");
    const statsBeforeFlush = logger.getChainStats();
    const lengthBeforeFlush = statsBeforeFlush!.chainLength;

    await logger.flush({ endSession: false });

    const statsAfterFlush = logger.getChainStats();
    expect(statsAfterFlush).not.toBeNull();
    // flush() appends 1 CHAIN_INTEGRITY_CHECK bundle
    expect(statsAfterFlush!.chainLength).toBeGreaterThan(lengthBeforeFlush);
  });

  it("getChainStats() returns correct counts after multiple events", async () => {
    const beforeHash = "c".repeat(64);
    const afterHash = "d".repeat(64);

    // 3 plain events + 2 events with hashes (produce receipts)
    await logger.logToolCall("myTool", { a: 1 });
    await logger.logVerification("stage-1", true);
    await logger.logFileWrite("/tmp/a.ts", beforeHash, afterHash);
    await logger.logFileWrite("/tmp/b.ts", beforeHash, afterHash);
    await logger.logError("Actor", "Something went wrong");

    const stats = logger.getChainStats();
    expect(stats).not.toBeNull();
    // 1 init bundle + 5 logged events = 6 total
    expect(stats!.chainLength).toBe(6);
    // 2 file_write events with before+afterHash → 2 receipts
    expect(stats!.receiptCount).toBe(2);
    expect(stats!.headHash).toHaveLength(64);
    expect(stats!.integrityVerified).toBe(true);
  });

  it("sealSession() produces a seal that passes EvidenceSealer.verifySeal roundtrip", async () => {
    await logger.logFileWrite("/tmp/seal-test.ts");
    await logger.logToolCall("sealTool", { run: 1 });

    const config = { model: "gpt-4", temperature: 0.2, maxTokens: 4096 };
    const metrics = [{ tokensUsed: 1200, latencyMs: 340 }];

    const seal = logger.sealSession(config, metrics);
    expect(seal).not.toBeNull();
    expect(seal!.sealId).toMatch(/^DC-SEAL-/);
    expect(seal!.sessionId).toBeTruthy();
    expect(seal!.sealHash).toHaveLength(64);
    // The timestamp field (not sealedAt) must be an ISO-8601 string
    expect(seal!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const sealer = new EvidenceSealer();
    const valid = sealer.verifySeal(seal!, config, metrics);
    expect(valid).toBe(true);
  });

  it("exportEvidenceChain() returns { chain, receipts, merkleRoot } structure", async () => {
    await logger.logFileWrite("/tmp/export-test.ts", "e".repeat(64), "f".repeat(64));
    await logger.logToolCall("exportTool", {});

    const exported = logger.exportEvidenceChain();
    expect(exported).not.toBeNull();

    // Must have the three top-level keys
    expect(exported).toHaveProperty("chain");
    expect(exported).toHaveProperty("receipts");
    expect(exported).toHaveProperty("merkleRoot");

    // chain is a HashChainExport object containing a blocks array
    expect(typeof exported!.chain).toBe("object");
    expect(Array.isArray(exported!.chain.chain)).toBe(true);
    expect(exported!.chain.chain.length).toBeGreaterThan(0);
    expect(typeof exported!.chain.verified).toBe("boolean");

    // receipts is a ReceiptChain export object containing a receipts array
    expect(typeof exported!.receipts).toBe("object");
    expect(Array.isArray(exported!.receipts.receipts)).toBe(true);

    // merkleRoot must be a 64-char hex string
    expect(exported!.merkleRoot).toMatch(/^[0-9a-f]{64}$/i);

    // Clean up
    await rm(storageRoot, { recursive: true, force: true });
  });
});
