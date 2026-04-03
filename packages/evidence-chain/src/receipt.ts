import { randomUUID } from "node:crypto";
import { sha256, hashDict } from "./types.js";
import { MerkleTree, type MerkleProofStep } from "./merkle-tree.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Receipt {
  receiptId: string; // UUID v4
  correlationId: string; // Links to session/run
  actor: string; // Tool, model, or system component
  action: string; // e.g. "file_write:src/auth.ts"
  beforeHash: string; // SHA-256 of state before operation
  afterHash: string; // SHA-256 of state after operation
  receiptHash: string; // SHA-256 of "{receiptId}:{correlationId}:{actor}:{action}:{beforeHash}:{afterHash}"
  timestamp: string; // ISO-8601
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Create a Receipt capturing before/after state of an operation. */
export function createReceipt(params: {
  correlationId: string;
  actor: string;
  action: string;
  beforeState: Record<string, unknown> | string;
  afterState: Record<string, unknown> | string;
}): Receipt {
  const { correlationId, actor, action, beforeState, afterState } = params;
  const receiptId = randomUUID();
  const timestamp = new Date().toISOString();

  const beforeHash = typeof beforeState === "string" ? sha256(beforeState) : hashDict(beforeState);
  const afterHash = typeof afterState === "string" ? sha256(afterState) : hashDict(afterState);

  const receiptHash = sha256(
    `${receiptId}:${correlationId}:${actor}:${action}:${beforeHash}:${afterHash}`,
  );

  return { receiptId, correlationId, actor, action, beforeHash, afterHash, receiptHash, timestamp };
}

// ---------------------------------------------------------------------------
// ReceiptChain
// ---------------------------------------------------------------------------

/**
 * Append-only chain of Receipts backed by a MerkleTree.
 * Each receipt's receiptHash is the Merkle leaf hash.
 */
export class ReceiptChain {
  private receipts: Receipt[] = [];
  private tree: MerkleTree = new MerkleTree();

  /** Append a receipt. Returns its Merkle leaf index. */
  append(receipt: Receipt): number {
    const index = this.tree.addLeaf(receipt.receiptHash);
    this.receipts.push(receipt);
    return index;
  }

  /** Get receipt at index. */
  getReceipt(index: number): Receipt {
    const r = this.receipts[index];
    if (r === undefined) throw new RangeError(`No receipt at index ${index}`);
    return r;
  }

  /** Get Merkle proof for receipt at index. */
  getProof(index: number): MerkleProofStep[] {
    return this.tree.getProof(index);
  }

  /** Verify receipt at index against current Merkle root. */
  verify(index: number): boolean {
    const receipt = this.receipts[index];
    if (receipt === undefined) return false;
    const proof = this.tree.getProof(index);
    return MerkleTree.verifyProof(receipt.receiptHash, proof, this.tree.root);
  }

  /** Current Merkle root covering all receipts. */
  get merkleRoot(): string {
    return this.tree.root;
  }

  get size(): number {
    return this.receipts.length;
  }

  /** All receipts (read-only). */
  getAllReceipts(): Receipt[] {
    return [...this.receipts];
  }

  /** Export chain to JSON. */
  exportToJSON(): { receipts: Receipt[]; merkleRoot: string } {
    return {
      receipts: [...this.receipts],
      merkleRoot: this.tree.root,
    };
  }

  /** Import and verify.
   *
   * Security: re-derives each receipt's `receiptHash` from its fields before
   * appending — prevents an attacker from mutating receipt content and forging
   * a consistent Merkle tree that would otherwise pass the root check.
   */
  static fromJSON(data: { receipts: Receipt[]; merkleRoot: string }): ReceiptChain {
    const chain = new ReceiptChain();
    for (const receipt of data.receipts) {
      // Re-derive receiptHash from canonical fields to detect content tampering.
      // An attacker who changes `actor`, `action`, `beforeHash`, or `afterHash`
      // cannot produce a valid receiptHash without knowing the original values.
      const expectedHash = sha256(
        `${receipt.receiptId}:${receipt.correlationId}:${receipt.actor}:${receipt.action}:${receipt.beforeHash}:${receipt.afterHash}`,
      );
      if (receipt.receiptHash !== expectedHash) {
        throw new Error(
          `ReceiptChain import failed: receipt ${receipt.receiptId} has tampered content (receiptHash mismatch)`,
        );
      }
      chain.append(receipt);
    }
    if (chain.merkleRoot !== data.merkleRoot) {
      throw new Error(
        `ReceiptChain import failed: merkleRoot mismatch. Expected ${data.merkleRoot}, got ${chain.merkleRoot}`,
      );
    }
    return chain;
  }
}
