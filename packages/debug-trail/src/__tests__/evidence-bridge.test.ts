// ============================================================================
// @dantecode/debug-trail — EvidenceBridge Tests
// Covers the stable API wrapper around the AuditLogger evidence chain.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { AuditLogger } from "../audit-logger.js";
import { EvidenceBridge } from "../integrations/evidence-bridge.js";

describe("EvidenceBridge", () => {
  let storageRoot: string;
  let logger: AuditLogger;
  let bridge: EvidenceBridge;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "dt-bridge-"));
    logger = new AuditLogger({
      config: { storageRoot },
      sessionId: `sess_bridge_${Date.now()}`,
    });
    await logger.init();
    bridge = new EvidenceBridge(logger);
  });

  it("getSessionMerkleRoot() returns a 64-char hex string after events are logged", async () => {
    await logger.logToolCall("bridgeTool", { step: 1 });
    await logger.logFileWrite("/tmp/bridge-test.ts");

    const root = bridge.getSessionMerkleRoot();
    expect(root).not.toBeNull();
    expect(root!).toMatch(/^[0-9a-f]{64}$/i);
    expect(root!).not.toBe("0".repeat(64));

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("verifyChainIntegrity() returns true on a clean session with multiple events", async () => {
    await logger.logToolCall("tool1", { x: 1 });
    await logger.logModelDecision("gpt-4", "Decision A");
    await logger.logVerification("stage-check", true);

    const intact = bridge.verifyChainIntegrity();
    expect(intact).toBe(true);

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("getChainStats() returns the same values as logger.getChainStats()", async () => {
    await logger.logToolCall("statsTool", { a: 42 });
    await logger.logFileWrite("/tmp/stats.ts", "a".repeat(64), "b".repeat(64));

    const bridgeStats = bridge.getChainStats();
    const loggerStats = logger.getChainStats();

    expect(bridgeStats).not.toBeNull();
    expect(loggerStats).not.toBeNull();

    expect(bridgeStats!.chainLength).toBe(loggerStats!.chainLength);
    expect(bridgeStats!.merkleRoot).toBe(loggerStats!.merkleRoot);
    expect(bridgeStats!.receiptCount).toBe(loggerStats!.receiptCount);
    expect(bridgeStats!.headHash).toBe(loggerStats!.headHash);
    expect(bridgeStats!.integrityVerified).toBe(loggerStats!.integrityVerified);

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("sealSession() → verifySeal() roundtrip passes via bridge", async () => {
    await logger.logToolCall("sealBridgeTool", { run: 99 });

    const config = { model: "claude-3", maxTokens: 8192 };
    const metrics = [{ tokensUsed: 500, latencyMs: 120 }];

    const seal = bridge.sealSession(config, metrics);
    expect(seal).not.toBeNull();
    expect(seal!.sealHash).toHaveLength(64);

    const valid = bridge.verifySeal(seal!, config, metrics);
    expect(valid).toBe(true);

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("sealSession() with modified config → verifySeal() returns false", async () => {
    await logger.logToolCall("tamperTool", { x: 1 });

    const originalConfig = { model: "claude-3", temperature: 0.5 };
    const metrics = [{ latencyMs: 200 }];

    const seal = bridge.sealSession(originalConfig, metrics);
    expect(seal).not.toBeNull();

    // Tamper: change one config field
    const tamperedConfig = { model: "claude-3", temperature: 0.9 };
    const valid = bridge.verifySeal(seal!, tamperedConfig, metrics);
    expect(valid).toBe(false);

    await rm(storageRoot, { recursive: true, force: true });
  });

  it("exportEvidence() returns complete { chain, receipts, merkleRoot } structure", async () => {
    await logger.logFileWrite("/tmp/export-bridge.ts", "1".repeat(64), "2".repeat(64));
    await logger.logToolCall("exportBridgeTool", { phase: "test" });

    const exported = bridge.exportEvidence();
    expect(exported).not.toBeNull();

    expect(exported).toHaveProperty("chain");
    expect(exported).toHaveProperty("receipts");
    expect(exported).toHaveProperty("merkleRoot");

    // chain is a HashChainExport object with a blocks array
    expect(typeof exported!.chain).toBe("object");
    expect(Array.isArray(exported!.chain.chain)).toBe(true);
    expect(exported!.chain.chain.length).toBeGreaterThan(0);

    // receipts is a ReceiptChain export object with a receipts array
    expect(typeof exported!.receipts).toBe("object");
    expect(Array.isArray(exported!.receipts.receipts)).toBe(true);
    // 1 file_write with before+after hashes → at least 1 receipt
    expect(exported!.receipts.receipts.length).toBeGreaterThan(0);

    expect(exported!.merkleRoot).toMatch(/^[0-9a-f]{64}$/i);

    await rm(storageRoot, { recursive: true, force: true });
  });
});
