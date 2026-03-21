import { randomBytes } from "node:crypto";
import { hashDict } from "./types.js";
import type { EvidenceType } from "./types.js";

export interface EvidenceBundleData {
  bundleId: string;
  runId: string;
  seq: number;
  organ: string;
  eventType: EvidenceType;
  evidence: Record<string, unknown>;
  prevHash: string;
  hash: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface CreateEvidenceBundleOptions {
  runId: string;
  seq: number;
  organ: string;
  eventType: EvidenceType;
  evidence: Record<string, unknown>;
  prevHash: string;
  metadata?: Record<string, unknown>;
}

export function createEvidenceBundle(opts: CreateEvidenceBundleOptions): EvidenceBundleData {
  // PRD spec: "ev_" + randomBytes(8).toString("hex") → "ev_" prefix + 16 hex chars = 19 chars total
  const bundleId = "ev_" + randomBytes(8).toString("hex");
  const timestamp = new Date().toISOString();
  // PRD spec: hash = hashDict(evidence) — evidence payload only, not full envelope
  const hash = hashDict(opts.evidence);
  return {
    bundleId,
    runId: opts.runId,
    seq: opts.seq,
    organ: opts.organ,
    eventType: opts.eventType,
    evidence: opts.evidence,
    prevHash: opts.prevHash,
    hash,
    timestamp,
    metadata: opts.metadata,
  };
}

export function verifyBundle(bundle: EvidenceBundleData): boolean {
  // PRD spec: verify hash = hashDict(evidence)
  return bundle.hash === hashDict(bundle.evidence);
}
