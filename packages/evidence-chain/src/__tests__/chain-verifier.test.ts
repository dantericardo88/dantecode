import { describe, it, expect } from "vitest";
import { ChainVerifier } from "../chain-verifier.js";
import { HashChain } from "../hash-chain.js";

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
