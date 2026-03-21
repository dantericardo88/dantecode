import { sha256 } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MerkleProofStep {
  direction: "left" | "right";
  siblingHash: string;
}

// ---------------------------------------------------------------------------
// MerkleTree
// ---------------------------------------------------------------------------

/**
 * Binary Merkle tree backed by SHA-256.
 * - Empty tree root: sha256("empty-merkle-root")
 * - Odd leaf count: duplicate last leaf
 * - Pair hashing: sha256(left + right)
 * - Root recomputed on every addLeaf()
 */
export class MerkleTree {
  private leaves: string[] = [];
  private _root: string;

  constructor() {
    this._root = sha256("empty-merkle-root");
  }

  /** Add a leaf (data hash). Returns leaf index. */
  addLeaf(dataHash: string): number {
    const index = this.leaves.length;
    this.leaves.push(dataHash);
    this._root = this._computeRoot(this.leaves);
    return index;
  }

  /** Current Merkle root. Recomputed on every addLeaf(). */
  get root(): string {
    return this._root;
  }

  /** Number of leaves. */
  get size(): number {
    return this.leaves.length;
  }

  /** Get the Merkle proof for a leaf at the given index. */
  getProof(index: number): MerkleProofStep[] {
    if (index < 0 || index >= this.leaves.length) {
      throw new RangeError(`Leaf index ${index} out of range [0, ${this.leaves.length})`);
    }
    const proof: MerkleProofStep[] = [];
    let layer = [...this.leaves];
    // Pre-apply odd-duplication to mirror _computeRoot — ensures single-leaf
    // trees produce a self-pairing sibling step, matching the sha256(leaf+leaf) root.
    if (layer.length % 2 !== 0) {
      layer.push(layer[layer.length - 1]!);
    }
    let idx = index;

    while (layer.length > 1) {
      if (layer.length % 2 !== 0) {
        layer.push(layer[layer.length - 1]!);
      }
      const siblingIdx = idx % 2 === 0 ? idx + 1 : idx - 1;
      const sibling = layer[siblingIdx]!;
      proof.push({
        direction: idx % 2 === 0 ? "right" : "left",
        siblingHash: sibling,
      });
      layer = this._buildNextLayer(layer);
      idx = Math.floor(idx / 2);
    }

    return proof;
  }

  /**
   * Verify a proof against a root hash.
   * Static — works offline without the tree.
   */
  static verifyProof(
    leafHash: string,
    proof: MerkleProofStep[],
    expectedRoot: string,
  ): boolean {
    let current = leafHash;
    for (const step of proof) {
      if (step.direction === "right") {
        current = sha256(current + step.siblingHash);
      } else {
        current = sha256(step.siblingHash + current);
      }
    }
    return current === expectedRoot;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _computeRoot(leaves: string[]): string {
    if (leaves.length === 0) return sha256("empty-merkle-root");
    let layer = [...leaves];
    // Per PRD §4.3: odd leaf count duplicates the last leaf to make it even.
    // Pre-applied here so single-leaf trees are self-paired: root = sha256(leaf+leaf).
    if (layer.length % 2 !== 0) {
      layer.push(layer[layer.length - 1]!);
    }
    while (layer.length > 1) {
      if (layer.length % 2 !== 0) {
        layer.push(layer[layer.length - 1]!);
      }
      layer = this._buildNextLayer(layer);
    }
    return layer[0]!;
  }

  private _buildNextLayer(layer: string[]): string[] {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(sha256(layer[i]! + layer[i + 1]!));
    }
    return next;
  }
}
