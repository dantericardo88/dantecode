import { sha256, stableJSON, hashDict } from "./types.js";

export interface CertificationSeal {
  sealId: string;
  timestamp: string;          // ISO-8601; was "sealedAt" — renamed to match PRD spec
  sessionId: string;
  evidenceRootHash: string;
  configHash: string;
  metricsHash: string;
  eventCount: number;
  sealHash: string;
}

interface CreateSealOptions {
  sessionId: string;
  evidenceRootHash: string;
  config: Record<string, unknown>;
  metrics: Record<string, unknown>[];
  eventCount: number;
}

export class EvidenceSealer {
  createSeal(opts: CreateSealOptions): CertificationSeal {
    // PRD spec: evidenceRootHash must be a 64-character hex string
    if (!/^[0-9a-f]{64}$/i.test(opts.evidenceRootHash)) {
      throw new Error(
        `evidenceRootHash must be a 64-character hex string, got: "${opts.evidenceRootHash.slice(0, 20)}..."`,
      );
    }

    // PRD spec: sealId = "DC-SEAL-" + new Date().toISOString()
    const sealId = "DC-SEAL-" + new Date().toISOString();
    const timestamp = new Date().toISOString();
    const configHash = hashDict(opts.config);
    const metricsHash = sha256(stableJSON(opts.metrics));

    // PRD spec: sealHash = sha256("{sealId}:{timestamp}:{sessionId}:{evidenceRootHash}:{configHash}:{metricsHash}")
    // 6-field colon-delimited string — no eventCount, no stableJSON envelope
    const sealHash = sha256(
      `${sealId}:${timestamp}:${opts.sessionId}:${opts.evidenceRootHash}:${configHash}:${metricsHash}`,
    );

    return {
      sealId,
      timestamp,
      sessionId: opts.sessionId,
      evidenceRootHash: opts.evidenceRootHash,
      configHash,
      metricsHash,
      eventCount: opts.eventCount,
      sealHash,
    };
  }

  verifySeal(
    seal: CertificationSeal,
    config: Record<string, unknown>,
    metrics: Record<string, unknown>[],
  ): boolean {
    const configHash = hashDict(config);
    const metricsHash = sha256(stableJSON(metrics));
    const expectedSealHash = sha256(
      `${seal.sealId}:${seal.timestamp}:${seal.sessionId}:${seal.evidenceRootHash}:${configHash}:${metricsHash}`,
    );
    return (
      seal.sealHash === expectedSealHash &&
      seal.configHash === configHash &&
      seal.metricsHash === metricsHash
    );
  }
}
