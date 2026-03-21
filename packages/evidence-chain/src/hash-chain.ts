import { sha256, stableJSON } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HashChainBlock<T> {
  index: number;
  timestamp: string; // ISO-8601
  data: T;
  previousHash: string; // "0".repeat(64) for genesis
  hash: string; // SHA-256 of {index, timestamp, data, previousHash}
}

export interface HashChainExport<T> {
  metadata: Record<string, unknown>;
  chain: HashChainBlock<T>[];
  verified: boolean;
  length: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class HashChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HashChainError";
  }
}

// ---------------------------------------------------------------------------
// HashChain
// ---------------------------------------------------------------------------

/**
 * Append-only, SHA-256 linked sequence of blocks.
 * Each block links to the previous block's hash.
 * Genesis block links to null hash ("0".repeat(64)).
 * Any modification to any block invalidates all subsequent hashes.
 */
export class HashChain<T = Record<string, unknown>> {
  private blocks: HashChainBlock<T>[] = [];
  private _metadata: Record<string, unknown>;

  constructor(genesisData: T, metadata: Record<string, unknown> = {}) {
    this._metadata = { ...metadata };
    const genesis = this._buildBlock(0, genesisData, "0".repeat(64));
    this.blocks.push(genesis);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Append a new immutable entry.
   * Verifies chain integrity BEFORE appending.
   * Throws HashChainError if chain is compromised.
   * Returns the new block's hash.
   */
  append(data: T): string {
    if (!this.verifyIntegrity()) {
      throw new HashChainError("Chain integrity check failed — cannot append to compromised chain");
    }
    const prev = this.blocks[this.blocks.length - 1]!;
    const block = this._buildBlock(this.blocks.length, data, prev.hash);
    this.blocks.push(block);
    return block.hash;
  }

  /**
   * Verify the entire chain hasn't been tampered with.
   * Check 1: Each block's hash matches recalculated hash.
   * Check 2: Each block's previousHash matches actual previous block's hash.
   */
  verifyIntegrity(): boolean {
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i]!;
      const expectedHash = this._computeHash(
        block.index,
        block.timestamp,
        block.data,
        block.previousHash,
      );
      if (block.hash !== expectedHash) return false;
      if (i === 0) {
        if (block.previousHash !== "0".repeat(64)) return false;
      } else {
        const prev = this.blocks[i - 1]!;
        if (block.previousHash !== prev.hash) return false;
      }
    }
    return true;
  }

  /** Get entry at specific index. Returns null if out of range. */
  getEntry(index: number): HashChainBlock<T> | null {
    return this.blocks[index] ?? null;
  }

  /** Get the most recent entry. */
  getLatest(): HashChainBlock<T> {
    return this.blocks[this.blocks.length - 1]!;
  }

  /** Get all entries (read-only copy). */
  getAllEntries(): HashChainBlock<T>[] {
    return [...this.blocks];
  }

  /** Find entries matching a predicate. */
  findEntries(predicate: (entry: HashChainBlock<T>) => boolean): HashChainBlock<T>[] {
    return this.blocks.filter(predicate);
  }

  /** Export chain to serializable JSON. */
  exportToJSON(): HashChainExport<T> {
    return {
      metadata: { ...this._metadata },
      chain: this.blocks.map((b) => ({ ...b })),
      verified: this.verifyIntegrity(),
      length: this.blocks.length,
    };
  }

  /**
   * Reconstruct chain from exported JSON.
   * Throws HashChainError if integrity check fails.
   */
  static fromJSON<T>(data: HashChainExport<T>): HashChain<T> {
    const chain = new HashChain<T>(data.chain[0]!.data, data.metadata);
    // Replace the auto-generated genesis with the imported blocks
    chain.blocks = data.chain.map((b) => ({ ...b }));
    if (!chain.verifyIntegrity()) {
      throw new HashChainError(
        "Imported chain failed integrity verification — data may be tampered",
      );
    }
    return chain;
  }

  get length(): number {
    return this.blocks.length;
  }

  get headHash(): string {
    return this.blocks[this.blocks.length - 1]!.hash;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _computeHash(index: number, timestamp: string, data: T, previousHash: string): string {
    return sha256(stableJSON({ index, timestamp, data, previousHash }));
  }

  private _buildBlock(index: number, data: T, previousHash: string): HashChainBlock<T> {
    const timestamp = new Date().toISOString();
    const hash = this._computeHash(index, timestamp, data, previousHash);
    return { index, timestamp, data, previousHash, hash };
  }
}
