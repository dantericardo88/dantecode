import { describe, it, expect } from "vitest";
import { ChainVerifier } from "../chain-verifier.js";
import { HashChain } from "../hash-chain.js";
import { createReceipt, ReceiptChain } from "../receipt.js";
import { createEvidenceBundle } from "../evidence-bundle.js";
import { EvidenceSealer } from "../evidence-sealer.js";
import { sha256 } from "../types.js";
import { EvidenceType } from "../types.js";

const verifier = new ChainVerifier();

describe("ChainVerifier", () => {
  it("valid chain passes verification", () => {
    const chain = new HashChain({ event: "genesis" });
    chain.append({ event: "step1" });
    chain.append({ event: "step2" });

    const report = verifier.verify(chain);
    expect(report.valid).toBe(true);
    expect(report.chainLength).toBe(3);
    expect(report.integrityStatus).toBe("intact");
    expect(report.firstFailurePoint).toBeUndefined();
    expect(report.details.length).toBeGreaterThan(0);
  });

  it("detects tampered chain when block data is modified", () => {
    const chain = new HashChain<{ n: number }>({ n: 0 });
    chain.append({ n: 1 });
    chain.append({ n: 2 });

    // Tamper with block data via export/modify/reimport
    const exported = chain.exportToJSON();
    exported.chain[1] = { ...exported.chain[1]!, data: { n: 999 } };

    // Rebuild a chain with tampered blocks (bypass integrity check)
    const tampered = new HashChain<{ n: number }>({ n: 0 });
    tampered["blocks"] = exported.chain;

    const report = verifier.verify(tampered);
    expect(report.valid).toBe(false);
    expect(report.integrityStatus).toBe("tampered");
    expect(report.firstFailurePoint).toBe(1);
  });

  it("detects gaps when block indices are non-sequential", () => {
    const chain = new HashChain<{ step: string }>({ step: "init" });
    chain.append({ step: "a" });
    chain.append({ step: "b" });

    // Modify indices to create a gap
    const exported = chain.exportToJSON();
    exported.chain[2] = { ...exported.chain[2]!, index: 5 };
    const tampered = new HashChain<{ step: string }>({ step: "init" });
    tampered["blocks"] = exported.chain;

    const gaps = verifier.detectGaps(tampered);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0]!.expectedIndex).toBe(2);
  });

  it("single-block chain (genesis only) passes verification", () => {
    const chain = new HashChain({ single: true });

    const report = verifier.verify(chain);
    expect(report.valid).toBe(true);
    expect(report.chainLength).toBe(1);
    expect(report.integrityStatus).toBe("intact");
  });

  it("report includes detailed verification messages", () => {
    const chain = new HashChain({ event: "start" });
    chain.append({ event: "middle" });
    chain.append({ event: "end" });

    const report = verifier.verify(chain);
    // Should have genesis check + per-block messages
    expect(report.details.length).toBeGreaterThanOrEqual(4);
    expect(report.details[0]).toContain("Genesis block");
    expect(report.details.some((d) => d.includes("verified"))).toBe(true);
  });

  it("detectTampering returns tamper reports with hash details", () => {
    const chain = new HashChain<{ v: number }>({ v: 1 });
    chain.append({ v: 2 });

    // Tamper hash
    const exported = chain.exportToJSON();
    exported.chain[1] = { ...exported.chain[1]!, hash: "bad" + "0".repeat(60) };
    const tampered = new HashChain<{ v: number }>({ v: 1 });
    tampered["blocks"] = exported.chain;

    const tampers = verifier.detectTampering(tampered);
    expect(tampers.length).toBe(1);
    expect(tampers[0]!.blockIndex).toBe(1);
    expect(tampers[0]!.actualHash).toContain("bad");
    expect(tampers[0]!.expectedHash).toHaveLength(64);
  });

  it("valid chain has no gaps and no tampering", () => {
    const chain = new HashChain<Record<string, unknown>>({ ok: true });
    for (let i = 0; i < 5; i++) chain.append({ ok: true, i });

    expect(verifier.detectGaps(chain)).toEqual([]);
    expect(verifier.detectTampering(chain)).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Static method tests
// ────────────────────────────────────────────────────────────────────────────

describe("ChainVerifier.verifyHashChain (static)", () => {
  it("valid chain passes — returns valid=true, correct blockCount, no gaps or tampered", () => {
    const chain = new HashChain({ event: "genesis" });
    chain.append({ event: "step1" });
    chain.append({ event: "step2" });

    const result = ChainVerifier.verifyHashChain(chain);

    expect(result.valid).toBe(true);
    expect(result.blockCount).toBe(3);
    expect(result.gaps).toEqual([]);
    expect(result.tampered).toEqual([]);
    expect(result.genesisHash).toHaveLength(64);
    expect(result.headHash).toHaveLength(64);
    expect(result.genesisHash).not.toBe(result.headHash);
    expect(result.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("corrupted chain reports tampered index", () => {
    const chain = new HashChain<{ n: number }>({ n: 0 });
    chain.append({ n: 1 });
    chain.append({ n: 2 });

    // Tamper block 1 data directly without recomputing hash
    const exported = chain.exportToJSON();
    exported.chain[1] = { ...exported.chain[1]!, data: { n: 999 } };
    const tampered = new HashChain<{ n: number }>({ n: 0 });
    tampered["blocks"] = exported.chain;

    const result = ChainVerifier.verifyHashChain(tampered);

    expect(result.valid).toBe(false);
    expect(result.tampered).toContain(1);
  });

  it("empty chain returns valid=true with zero counts", () => {
    // HashChain always has at least genesis, so simulate empty via a zero-block chain
    // We test via a chain that has a genesis block (minimum valid state)
    const chain = new HashChain({ only: "genesis" });
    const result = ChainVerifier.verifyHashChain(chain);

    expect(result.valid).toBe(true);
    expect(result.blockCount).toBe(1);
    expect(result.gaps).toEqual([]);
    expect(result.tampered).toEqual([]);
  });

  it("genesis hash and head hash are both present for multi-block chain", () => {
    const chain = new HashChain({ x: 1 });
    chain.append({ x: 2 });

    const result = ChainVerifier.verifyHashChain(chain);
    expect(result.genesisHash).toBe(chain.getEntry(0)!.hash);
    expect(result.headHash).toBe(chain.headHash);
  });
});

describe("ChainVerifier.verifyReceiptChain (static)", () => {
  it("valid receipt chain passes — merkleRootValid=true, all proofs valid", () => {
    const chain = new ReceiptChain();
    chain.append(createReceipt({ correlationId: "c1", actor: "agent", action: "write:foo.ts", beforeState: "before", afterState: "after" }));
    chain.append(createReceipt({ correlationId: "c1", actor: "agent", action: "write:bar.ts", beforeState: "a", afterState: "b" }));

    const result = ChainVerifier.verifyReceiptChain(chain);

    expect(result.valid).toBe(true);
    expect(result.receiptCount).toBe(2);
    expect(result.merkleRootValid).toBe(true);
    expect(result.proofValidations).toHaveLength(2);
    expect(result.proofValidations.every(p => p.valid)).toBe(true);
    expect(result.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("empty receipt chain returns valid with zero receipts", () => {
    const chain = new ReceiptChain();
    const result = ChainVerifier.verifyReceiptChain(chain);

    expect(result.valid).toBe(true);
    expect(result.receiptCount).toBe(0);
    expect(result.proofValidations).toEqual([]);
  });
});

describe("ChainVerifier.verifyBundle (static)", () => {
  it("valid bundle passes verification", () => {
    const bundle = createEvidenceBundle({
      runId: "run-1",
      seq: 0,
      organ: "test-organ",
      eventType: EvidenceType.TOOL_CALL,
      evidence: { tool: "bash", cmd: "ls" },
      prevHash: "0".repeat(64),
    });

    const result = ChainVerifier.verifyBundle(bundle);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("bundle with wrong hash fails verification with reason", () => {
    const bundle = createEvidenceBundle({
      runId: "run-2",
      seq: 1,
      organ: "test-organ",
      eventType: EvidenceType.FILE_WRITE,
      evidence: { file: "src/foo.ts" },
      prevHash: "0".repeat(64),
    });

    // Corrupt the hash
    const corrupted = { ...bundle, hash: "0".repeat(64) };

    const result = ChainVerifier.verifyBundle(corrupted);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("mismatch");
  });
});

describe("ChainVerifier.verifySeal (static)", () => {
  it("valid seal passes verification", () => {
    const sealer = new EvidenceSealer();
    const evidenceRootHash = sha256("some root");
    const seal = sealer.createSeal({
      sessionId: "sess-abc",
      evidenceRootHash,
      config: { model: "claude-3" },
      metrics: [{ score: 95 }],
      eventCount: 10,
    });

    const result = ChainVerifier.verifySeal(seal);
    expect(result.valid).toBe(true);
  });

  it("tampered seal data fails verification", () => {
    const sealer = new EvidenceSealer();
    const evidenceRootHash = sha256("root-data");
    const seal = sealer.createSeal({
      sessionId: "sess-xyz",
      evidenceRootHash,
      config: { env: "prod" },
      metrics: [],
      eventCount: 5,
    });

    // Tamper: change sessionId without recomputing sealHash
    const tampered = { ...seal, sessionId: "HACKED" };

    const result = ChainVerifier.verifySeal(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });
});
