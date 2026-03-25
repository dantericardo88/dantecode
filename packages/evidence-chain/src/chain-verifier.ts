// ============================================================================
// @dantecode/evidence-chain — Chain Verifier
// Verifies hash chain integrity from genesis to head, detects gaps and
// tampering, and produces structured verification reports.
// ============================================================================

import type { HashChain, HashChainBlock } from "./hash-chain.js";
import { sha256, stableJSON, hashDict } from "./types.js";
import type { ReceiptChain } from "./receipt.js";
import type { EvidenceBundleData } from "./evidence-bundle.js";
import type { CertificationSeal } from "./evidence-sealer.js";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** The integrity status of a verified chain. */
export type IntegrityStatus = "intact" | "tampered" | "gaps-detected";

/** Full verification report for a hash chain. */
export interface VerificationReport {
  /** Whether the chain passed all integrity checks. */
  valid: boolean;
  /** Number of blocks in the chain. */
  chainLength: number;
  /** Overall integrity status. */
  integrityStatus: IntegrityStatus;
  /** Index of the first block that failed verification, if any. */
  firstFailurePoint?: number;
  /** Human-readable details about each check performed. */
  details: string[];
}

/** A detected gap in the chain. */
export interface GapReport {
  /** Expected index of the missing entry. */
  expectedIndex: number;
  /** Hash that the next block references but no block has. */
  expectedPreviousHash: string;
  /** Description of the gap. */
  message: string;
}

/** A detected tampering incident. */
export interface TamperReport {
  /** Index of the tampered block. */
  blockIndex: number;
  /** Expected hash (recomputed). */
  expectedHash: string;
  /** Actual hash stored in the block. */
  actualHash: string;
  /** Description of the tampering. */
  message: string;
}

// ────────────────────────────────────────────────────────────────────────────
// New API types (static method interface)
// ────────────────────────────────────────────────────────────────────────────

/** Result of static HashChain verification. */
export interface VerificationResult {
  valid: boolean;
  blockCount: number;
  genesisHash: string;
  headHash: string;
  /** Indices where chain links break (previousHash mismatch). */
  gaps: number[];
  /** Indices where stored hash does not match recomputed hash. */
  tampered: number[];
  verifiedAt: string;
}

/** Result of static ReceiptChain verification. */
export interface ReceiptChainVerification {
  valid: boolean;
  receiptCount: number;
  merkleRootValid: boolean;
  proofValidations: Array<{ receiptId: string; valid: boolean }>;
  verifiedAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const GENESIS_PREV_HASH = "0".repeat(64);

// ────────────────────────────────────────────────────────────────────────────
// Verifier
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verifies the integrity of a HashChain by:
 * 1. Checking each block's hash matches its recomputed hash.
 * 2. Checking each block's previousHash matches the actual previous block.
 * 3. Checking genesis block has previousHash = "0".repeat(64).
 * 4. Detecting index gaps.
 * 5. Detecting hash mismatches (tampering).
 */
export class ChainVerifier {
  /**
   * Full verification of a hash chain from genesis to head.
   * Returns a structured report with validity, status, and details.
   */
  verify<T>(chain: HashChain<T>): VerificationReport {
    const entries = chain.getAllEntries();
    const details: string[] = [];
    let firstFailurePoint: number | undefined;

    if (entries.length === 0) {
      return {
        valid: false,
        chainLength: 0,
        integrityStatus: "gaps-detected",
        details: ["Chain is empty — no blocks to verify"],
      };
    }

    // Check genesis block
    const genesis = entries[0]!;
    if (genesis.previousHash !== GENESIS_PREV_HASH) {
      details.push(
        `Genesis block has invalid previousHash: expected 64 zeros, got "${genesis.previousHash.slice(0, 16)}..."`,
      );
      firstFailurePoint = 0;
    } else {
      details.push("Genesis block previousHash: valid (64 zeros)");
    }

    if (genesis.index !== 0) {
      details.push(`Genesis block has invalid index: expected 0, got ${genesis.index}`);
      firstFailurePoint = firstFailurePoint ?? 0;
    }

    // Verify each block
    let hasFailure = false;
    for (let i = 0; i < entries.length; i++) {
      const block = entries[i]!;
      const recomputedHash = this.computeBlockHash(block);

      if (block.hash !== recomputedHash) {
        details.push(
          `Block ${i}: hash mismatch — expected ${recomputedHash.slice(0, 16)}..., got ${block.hash.slice(0, 16)}...`,
        );
        hasFailure = true;
        firstFailurePoint = firstFailurePoint ?? i;
        continue;
      }

      if (i > 0) {
        const prev = entries[i - 1]!;
        if (block.previousHash !== prev.hash) {
          details.push(`Block ${i}: previousHash does not match block ${i - 1} hash`);
          hasFailure = true;
          firstFailurePoint = firstFailurePoint ?? i;
          continue;
        }
      }

      details.push(`Block ${i}: verified`);
    }

    // Check for index gaps
    const gaps = this.detectGaps(chain);
    if (gaps.length > 0) {
      for (const gap of gaps) {
        details.push(`Gap detected: ${gap.message}`);
      }
      hasFailure = true;
    }

    const tampering = this.detectTampering(chain);

    let integrityStatus: IntegrityStatus = "intact";
    if (tampering.length > 0) {
      integrityStatus = "tampered";
    } else if (gaps.length > 0) {
      integrityStatus = "gaps-detected";
    } else if (hasFailure) {
      integrityStatus = "tampered";
    }

    const report: VerificationReport = {
      valid: !hasFailure,
      chainLength: entries.length,
      integrityStatus,
      details,
    };
    if (firstFailurePoint !== undefined) {
      report.firstFailurePoint = firstFailurePoint;
    }
    return report;
  }

  /**
   * Detect index gaps in the chain.
   * A gap occurs when block indices are not sequential (0, 1, 2, ...).
   */
  detectGaps<T>(chain: HashChain<T>): GapReport[] {
    const entries = chain.getAllEntries();
    const gaps: GapReport[] = [];

    for (let i = 0; i < entries.length; i++) {
      const block = entries[i]!;
      if (block.index !== i) {
        gaps.push({
          expectedIndex: i,
          expectedPreviousHash: i > 0 ? entries[i - 1]!.hash : GENESIS_PREV_HASH,
          message: `Expected block at index ${i}, found index ${block.index}`,
        });
      }
    }

    return gaps;
  }

  /**
   * Detect hash tampering in the chain.
   * A tamper is when a block's stored hash doesn't match its recomputed hash.
   */
  detectTampering<T>(chain: HashChain<T>): TamperReport[] {
    const entries = chain.getAllEntries();
    const tampers: TamperReport[] = [];

    for (let i = 0; i < entries.length; i++) {
      const block = entries[i]!;
      const expectedHash = this.computeBlockHash(block);

      if (block.hash !== expectedHash) {
        tampers.push({
          blockIndex: i,
          expectedHash,
          actualHash: block.hash,
          message: `Block ${i} hash mismatch: data or metadata was modified`,
        });
      }
    }

    return tampers;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Static API — matches spec interface
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Verify a HashChain<T> from genesis to head.
   * Returns gaps (link-break indices) and tampered (hash-mismatch indices).
   */
  static verifyHashChain<T>(chain: HashChain<T>): VerificationResult {
    const entries = chain.getAllEntries();
    const verifiedAt = new Date().toISOString();

    if (entries.length === 0) {
      return {
        valid: true,
        blockCount: 0,
        genesisHash: "",
        headHash: "",
        gaps: [],
        tampered: [],
        verifiedAt,
      };
    }

    const tampered: number[] = [];
    const gaps: number[] = [];

    for (let i = 0; i < entries.length; i++) {
      const block = entries[i]!;
      const recomputed = sha256(
        stableJSON({
          index: block.index,
          timestamp: block.timestamp,
          data: block.data,
          previousHash: block.previousHash,
        }),
      );
      if (block.hash !== recomputed) {
        tampered.push(i);
      }

      if (i === 0) {
        if (block.previousHash !== GENESIS_PREV_HASH) gaps.push(i);
      } else {
        const prev = entries[i - 1]!;
        if (block.previousHash !== prev.hash) gaps.push(i);
      }
    }

    return {
      valid: tampered.length === 0 && gaps.length === 0,
      blockCount: entries.length,
      genesisHash: entries[0]!.hash,
      headHash: entries[entries.length - 1]!.hash,
      gaps,
      tampered,
      verifiedAt,
    };
  }

  /**
   * Verify a ReceiptChain — check merkle root validity and all proofs.
   */
  static verifyReceiptChain(chain: ReceiptChain): ReceiptChainVerification {
    const verifiedAt = new Date().toISOString();
    const receipts = chain.getAllReceipts();
    const proofValidations: Array<{ receiptId: string; valid: boolean }> = [];

    let merkleRootValid = true;
    for (let i = 0; i < receipts.length; i++) {
      const receipt = receipts[i]!;
      const valid = chain.verify(i);
      proofValidations.push({ receiptId: receipt.receiptId, valid });
      if (!valid) merkleRootValid = false;
    }

    return {
      valid: merkleRootValid,
      receiptCount: receipts.length,
      merkleRootValid,
      proofValidations,
      verifiedAt,
    };
  }

  /**
   * Verify an EvidenceBundle — check bundle hash matches evidence payload.
   */
  static verifyBundle(bundle: EvidenceBundleData): { valid: boolean; reason?: string } {
    const expected = hashDict(bundle.evidence);
    if (bundle.hash !== expected) {
      return {
        valid: false,
        reason: `Bundle hash mismatch: expected ${expected.slice(0, 16)}..., got ${bundle.hash.slice(0, 16)}...`,
      };
    }
    return { valid: true };
  }

  /**
   * Verify a CertificationSeal — check seal hash integrity.
   * Validates the sealHash field against the seal's own fields.
   */
  static verifySeal(seal: CertificationSeal): { valid: boolean; reason?: string } {
    const expectedSealHash = sha256(
      `${seal.sealId}:${seal.timestamp}:${seal.sessionId}:${seal.evidenceRootHash}:${seal.configHash}:${seal.metricsHash}`,
    );
    if (seal.sealHash !== expectedSealHash) {
      return {
        valid: false,
        reason: `Seal hash mismatch: stored hash does not match recomputed hash from seal fields`,
      };
    }
    return { valid: true };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Recompute a block's hash using stableJSON for determinism.
   * Must match the HashChain._computeHash algorithm exactly.
   */
  private computeBlockHash<T>(block: HashChainBlock<T>): string {
    return sha256(
      stableJSON({
        index: block.index,
        timestamp: block.timestamp,
        data: block.data,
        previousHash: block.previousHash,
      }),
    );
  }
}
