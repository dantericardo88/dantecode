// @dantecode/evidence-chain — Public API
// Cryptographic primitives for tamper-evident audit trails.
// Open-source (MIT) — zero dependencies beyond node:crypto.

// Foundation
export { sha256, hashDict, stableJSON, EvidenceType } from "./types.js";

// HashChain
export { HashChain, HashChainError } from "./hash-chain.js";
export type { HashChainBlock, HashChainExport } from "./hash-chain.js";

// MerkleTree
export { MerkleTree } from "./merkle-tree.js";
export type { MerkleProofStep } from "./merkle-tree.js";

// Receipt + ReceiptChain (Merkle-backed, PRD spec)
export { createReceipt, ReceiptChain } from "./receipt.js";
export type { Receipt } from "./receipt.js";

// EvidenceBundle
export { createEvidenceBundle, verifyBundle } from "./evidence-bundle.js";
export type { EvidenceBundleData } from "./evidence-bundle.js";

// EvidenceSealer
export { EvidenceSealer } from "./evidence-sealer.js";
export type { CertificationSeal } from "./evidence-sealer.js";

// ChainVerifier
export { ChainVerifier } from "./chain-verifier.js";
export type {
  IntegrityStatus,
  VerificationReport,
  GapReport,
  TamperReport,
  VerificationResult,
  ReceiptChainVerification,
} from "./chain-verifier.js";

// ChainExporter
export { ChainExporter } from "./chain-exporter.js";
export type { ExportOptions } from "./chain-exporter.js";
