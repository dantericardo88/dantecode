import { describe, it, expect } from "vitest";
import { createEvidenceBundle, verifyBundle } from "../evidence-bundle.js";
import { hashDict, EvidenceType } from "../types.js";

const GENESIS_PREV = "0".repeat(64);

describe("createEvidenceBundle", () => {
  it("produces bundle with non-empty hash", () => {
    const bundle = createEvidenceBundle({
      runId: "run-1",
      seq: 0,
      organ: "agent",
      eventType: EvidenceType.TOOL_CALL,
      evidence: { tool: "bash", args: ["ls"] },
      prevHash: GENESIS_PREV,
    });
    expect(bundle.hash).toBeTruthy();
    expect(bundle.hash).toHaveLength(64);
  });

  it("verifyBundle returns true on untampered bundle", () => {
    const bundle = createEvidenceBundle({
      runId: "run-2",
      seq: 0,
      organ: "file-writer",
      eventType: EvidenceType.FILE_WRITE,
      evidence: { path: "src/auth.ts", size: 512 },
      prevHash: GENESIS_PREV,
    });
    expect(verifyBundle(bundle)).toBe(true);
  });

  it("verifyBundle returns false when evidence field is modified", () => {
    const bundle = createEvidenceBundle({
      runId: "run-3",
      seq: 0,
      organ: "model",
      eventType: EvidenceType.MODEL_DECISION,
      evidence: { choice: "A", confidence: 0.9 },
      prevHash: GENESIS_PREV,
    });
    const tampered = { ...bundle, evidence: { choice: "B", confidence: 0.9 } };
    expect(verifyBundle(tampered)).toBe(false);
  });

  // PRD test 5.4 #4: tamper hash field directly → verifyBundle returns false
  it("verifyBundle returns false when hash field is directly modified", () => {
    const bundle = createEvidenceBundle({
      runId: "run-3b",
      seq: 0,
      organ: "model",
      eventType: EvidenceType.MODEL_DECISION,
      evidence: { choice: "A", confidence: 0.9 },
      prevHash: GENESIS_PREV,
    });
    const tampered = { ...bundle, hash: "a".repeat(64) };
    expect(verifyBundle(tampered)).toBe(false);
  });

  it("verifyBundle is unaffected by prevHash modification — hash covers evidence payload only", () => {
    const bundle = createEvidenceBundle({
      runId: "run-4",
      seq: 1,
      organ: "git",
      eventType: EvidenceType.GIT_COMMIT,
      evidence: { commit: "abc123" },
      prevHash: GENESIS_PREV,
    });
    // prevHash is not part of hash formula (hash = hashDict(evidence) only)
    // so modifying prevHash does NOT affect verifyBundle — that's by PRD design
    // (chain linkage is the caller's responsibility, not verifyBundle's)
    const withAltPrevHash = { ...bundle, prevHash: "a".repeat(64) };
    expect(verifyBundle(withAltPrevHash)).toBe(true);
  });

  it("seq 0 with genesis prevHash works (genesis bundle)", () => {
    const bundle = createEvidenceBundle({
      runId: "run-5",
      seq: 0,
      organ: "session",
      eventType: EvidenceType.SESSION_STARTED,
      evidence: { sessionId: "s1" },
      prevHash: "0".repeat(64),
    });
    expect(verifyBundle(bundle)).toBe(true);
  });

  // PRD test 5.4 #6: bundleId starts with "ev_", 19 chars total
  it("bundleId starts with 'ev_' and is 19 characters (PRD spec)", () => {
    const bundle = createEvidenceBundle({
      runId: "run-6",
      seq: 0,
      organ: "test",
      eventType: EvidenceType.ANOMALY_DETECTED,
      evidence: { type: "loop" },
      prevHash: GENESIS_PREV,
    });
    expect(bundle.bundleId).toMatch(/^ev_[0-9a-f]{16}$/);
    expect(bundle.bundleId).toHaveLength(19);
  });

  it("timestamp is ISO-8601 string", () => {
    const bundle = createEvidenceBundle({
      runId: "run-7",
      seq: 0,
      organ: "test",
      eventType: EvidenceType.VERIFICATION_PASSED,
      evidence: { result: "ok" },
      prevHash: GENESIS_PREV,
    });
    expect(() => new Date(bundle.timestamp)).not.toThrow();
    expect(new Date(bundle.timestamp).toISOString()).toBe(bundle.timestamp);
  });

  it("metadata is preserved when provided", () => {
    const metadata = { source: "unit-test", priority: 1 };
    const bundle = createEvidenceBundle({
      runId: "run-8",
      seq: 0,
      organ: "test",
      eventType: EvidenceType.CHECKPOINT_CREATED,
      evidence: { step: 1 },
      prevHash: GENESIS_PREV,
      metadata,
    });
    expect(bundle.metadata).toEqual(metadata);
  });

  it("metadata is undefined when not provided", () => {
    const bundle = createEvidenceBundle({
      runId: "run-9",
      seq: 0,
      organ: "test",
      eventType: EvidenceType.CHECKPOINT_CREATED,
      evidence: { step: 1 },
      prevHash: GENESIS_PREV,
    });
    expect(bundle.metadata).toBeUndefined();
  });

  // PRD test 5.4 #2: hash = hashDict(evidence) — evidence payload only
  it("bundle.hash equals hashDict(evidence) — evidence payload only (PRD spec)", () => {
    const evidence = { decision: "merge", confidence: 0.88 };
    const bundle = createEvidenceBundle({
      runId: "run-10",
      seq: 0,
      organ: "council",
      eventType: EvidenceType.COUNCIL_DECISION,
      evidence,
      prevHash: GENESIS_PREV,
    });
    expect(bundle.hash).toBe(hashDict(evidence));
  });

  // PRD test 5.4 #5: prevHash chain linkage — bundle N's prevHash matches bundle N-1's hash
  it("prevHash chain linkage: bundle[1].prevHash === bundle[0].hash, etc.", () => {
    const b0 = createEvidenceBundle({
      runId: "run-chain",
      seq: 0,
      organ: "session",
      eventType: EvidenceType.SESSION_STARTED,
      evidence: { seq: 0 },
      prevHash: "0".repeat(64),
    });
    const b1 = createEvidenceBundle({
      runId: "run-chain",
      seq: 1,
      organ: "agent",
      eventType: EvidenceType.TOOL_CALL,
      evidence: { seq: 1 },
      prevHash: b0.hash,
    });
    const b2 = createEvidenceBundle({
      runId: "run-chain",
      seq: 2,
      organ: "agent",
      eventType: EvidenceType.TOOL_RESULT,
      evidence: { seq: 2 },
      prevHash: b1.hash,
    });
    expect(b1.prevHash).toBe(b0.hash);
    expect(b2.prevHash).toBe(b1.hash);
  });
});
