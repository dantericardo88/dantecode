import { describe, it, expect } from "vitest";
import { EvidenceSealer } from "../evidence-sealer.js";
import { sha256 } from "../types.js";

const VALID_ROOT = sha256("root-hash-input");

describe("EvidenceSealer", () => {
  const sealer = new EvidenceSealer();
  const config = { model: "claude-opus-4-6", temperature: 0.7, maxTokens: 4096 };
  const metrics = [
    { name: "accuracy", value: 0.95 },
    { name: "latency_ms", value: 320 },
  ];

  it("createSeal returns a seal with non-empty sealHash", () => {
    const seal = sealer.createSeal({
      sessionId: "session-1",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 42,
    });
    expect(seal.sealHash).toBeTruthy();
    expect(seal.sealHash).toHaveLength(64);
  });

  it("verifySeal returns true with matching config and metrics", () => {
    const seal = sealer.createSeal({
      sessionId: "session-2",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 10,
    });
    expect(sealer.verifySeal(seal, config, metrics)).toBe(true);
  });

  it("verifySeal returns false when config key is modified", () => {
    const seal = sealer.createSeal({
      sessionId: "session-3",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 5,
    });
    const badConfig = { ...config, temperature: 0.9 };
    expect(sealer.verifySeal(seal, badConfig, metrics)).toBe(false);
  });

  it("verifySeal returns false when metrics array is modified", () => {
    const seal = sealer.createSeal({
      sessionId: "session-4",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 5,
    });
    const badMetrics = [{ name: "accuracy", value: 0.5 }];
    expect(sealer.verifySeal(seal, config, badMetrics)).toBe(false);
  });

  it("verifySeal returns false when evidenceRootHash is modified on the seal", () => {
    const seal = sealer.createSeal({
      sessionId: "session-5",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 7,
    });
    const tampered = { ...seal, evidenceRootHash: sha256("other-root") };
    expect(sealer.verifySeal(tampered, config, metrics)).toBe(false);
  });

  // PRD test 5.5 #5: invalid evidenceRootHash throws
  it("createSeal throws when evidenceRootHash is not 64-char hex (PRD spec)", () => {
    expect(() =>
      sealer.createSeal({
        sessionId: "session-bad",
        evidenceRootHash: "not-a-valid-hash",
        config,
        metrics,
        eventCount: 1,
      }),
    ).toThrow();
    expect(() =>
      sealer.createSeal({
        sessionId: "session-bad2",
        evidenceRootHash: "abc123", // too short
        config,
        metrics,
        eventCount: 1,
      }),
    ).toThrow();
    expect(() =>
      sealer.createSeal({
        sessionId: "session-bad3",
        evidenceRootHash: "", // empty
        config,
        metrics,
        eventCount: 1,
      }),
    ).toThrow();
  });

  it("verifySeal is true after round-trip (same seal, same config, same metrics)", () => {
    const seal = sealer.createSeal({
      sessionId: "session-6",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 7,
    });
    // Calling twice with the same arguments must both return true
    expect(sealer.verifySeal(seal, config, metrics)).toBe(true);
    expect(sealer.verifySeal(seal, config, metrics)).toBe(true);
  });

  it("configHash and metricsHash are stored in the seal", () => {
    const seal = sealer.createSeal({
      sessionId: "session-7",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 3,
    });
    expect(seal.configHash).toBeTruthy();
    expect(seal.configHash).toHaveLength(64);
    expect(seal.metricsHash).toBeTruthy();
    expect(seal.metricsHash).toHaveLength(64);
  });

  it("eventCount is preserved in the seal", () => {
    const seal = sealer.createSeal({
      sessionId: "session-8",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 99,
    });
    expect(seal.eventCount).toBe(99);
  });

  // PRD test 5.5 #6: sealId starts with "DC-SEAL-"
  it("sealId starts with 'DC-SEAL-' (PRD spec)", () => {
    const seal = sealer.createSeal({
      sessionId: "session-9",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 1,
    });
    expect(seal.sealId).toMatch(/^DC-SEAL-/);
  });

  // PRD spec: timestamp field (formerly sealedAt)
  it("timestamp is an ISO-8601 string", () => {
    const seal = sealer.createSeal({
      sessionId: "session-10",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics,
      eventCount: 0,
    });
    expect(() => new Date(seal.timestamp)).not.toThrow();
    expect(new Date(seal.timestamp).toISOString()).toBe(seal.timestamp);
  });

  it("empty metrics array produces a valid seal", () => {
    const seal = sealer.createSeal({
      sessionId: "session-empty-metrics",
      evidenceRootHash: VALID_ROOT,
      config,
      metrics: [],
      eventCount: 0,
    });
    expect(sealer.verifySeal(seal, config, [])).toBe(true);
  });
});
