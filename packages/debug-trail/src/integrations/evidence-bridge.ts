// ============================================================================
// @dantecode/debug-trail — Evidence Bridge
// Stable API for consumers to access evidence-chain without direct dependency.
// ============================================================================

import type { AuditLogger } from "../audit-logger.js";
import { EvidenceSealer } from "@dantecode/evidence-chain";
import type { CertificationSeal, MerkleProofStep } from "@dantecode/evidence-chain";

/**
 * Bridge between debug-trail audit system and evidence-chain cryptographic primitives.
 * Provides a stable, version-independent API for other DanteCode packages.
 */
export class EvidenceBridge {
  constructor(private readonly logger: AuditLogger) {}

  /** Get the current session's Merkle root hash. */
  getSessionMerkleRoot(): string | null {
    return this.logger.getChainStats()?.merkleRoot ?? null;
  }

  /** Verify the current chain integrity. */
  verifyChainIntegrity(): boolean {
    return this.logger.getChainStats()?.integrityVerified ?? false;
  }

  /** Get full chain statistics. */
  getChainStats(): {
    chainLength: number;
    merkleRoot: string;
    receiptCount: number;
    headHash: string;
    integrityVerified: boolean;
  } | null {
    return this.logger.getChainStats();
  }

  /** Seal the current session. */
  sealSession(
    config: Record<string, unknown>,
    metrics: Record<string, unknown>[],
  ): CertificationSeal | null {
    return this.logger.sealSession(config, metrics);
  }

  /** Verify a previously created seal. */
  verifySeal(
    seal: CertificationSeal,
    config: Record<string, unknown>,
    metrics: Record<string, unknown>[],
  ): boolean {
    const sealer = new EvidenceSealer();
    return sealer.verifySeal(seal, config, metrics);
  }

  /** Export the full evidence chain for external verification. */
  exportEvidence(): ReturnType<AuditLogger["exportEvidenceChain"]> {
    return this.logger.exportEvidenceChain();
  }
}

// Re-export MerkleProofStep so callers don't need a direct evidence-chain dep.
export type { MerkleProofStep };
