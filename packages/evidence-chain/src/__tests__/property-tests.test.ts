import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { stableJSON, sha256, hashDict } from "../types.js";
import { HashChain } from "../hash-chain.js";
import { MerkleTree } from "../merkle-tree.js";

// ---------------------------------------------------------------------------
// Arbitraries — reusable generators
// ---------------------------------------------------------------------------

/**
 * Alphabetical-only key generator. Avoids integer-like keys ("0", "1", etc.)
 * because V8 reorders integer-indexed properties before string properties,
 * which means Object.keys() after JSON.parse() won't match .sort() order.
 */
const alphaKey = fc.stringMatching(/^[a-z]{1,10}$/);

/** Arbitrary JSON-safe object (no undefined, no functions, no symbols). */
const jsonObject = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.float({ noNaN: true, noDefaultInfinity: true }),
  ),
  { minKeys: 1, maxKeys: 10 },
);

/** Arbitrary nested JSON-safe object with alpha-only keys (for sort verification). */
const alphaNestedJsonObject = fc.dictionary(
  alphaKey,
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.dictionary(alphaKey, fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)), {
      minKeys: 1,
      maxKeys: 5,
    }),
    fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
      maxLength: 5,
    }),
  ),
  { minKeys: 1, maxKeys: 8 },
);

/** Arbitrary nested JSON-safe object (up to 2 levels deep). */
const nestedJsonObject = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 10 }),
  fc.oneof(
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    jsonObject,
    fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()), {
      maxLength: 5,
    }),
  ),
  { minKeys: 1, maxKeys: 8 },
);

/** 64-char lowercase hex string (sha256 output format). */
const hexHash64 = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));

// ---------------------------------------------------------------------------
// 1. stableJSON determinism
// ---------------------------------------------------------------------------

describe("stableJSON — property-based", () => {
  it("is deterministic: stableJSON(obj) === stableJSON(deepClone(obj))", () => {
    fc.assert(
      fc.property(nestedJsonObject, (obj) => {
        const clone = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
        expect(stableJSON(obj)).toBe(stableJSON(clone));
      }),
      { numRuns: 200 },
    );
  });

  it("produces sorted keys at every level", () => {
    fc.assert(
      fc.property(alphaNestedJsonObject, (obj) => {
        const serialized = stableJSON(obj);
        const parsed = JSON.parse(serialized) as Record<string, unknown>;
        assertKeysSorted(parsed);
      }),
      { numRuns: 200 },
    );
  });

  it("is identical regardless of key insertion order", () => {
    // stableJSON contract: callers must provide unique keys per object.
    // We normalise duplicate keys (last-write-wins via Map) before building
    // objA/objB so the comparison is meaningful and deterministic.
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.string({ minLength: 1, maxLength: 10 }), fc.oneof(fc.string(), fc.integer())),
          { minLength: 2, maxLength: 8 },
        ),
        (entries) => {
          // Deduplicate: last occurrence wins for both orderings
          const unique = new Map<string, unknown>(entries);
          fc.pre(unique.size >= 2); // need ≥2 distinct keys to test ordering
          const uniqueEntries = [...unique.entries()];

          const objA: Record<string, unknown> = {};
          for (const [k, v] of uniqueEntries) objA[k] = v;

          const objB: Record<string, unknown> = {};
          for (const [k, v] of [...uniqueEntries].reverse()) objB[k] = v;

          expect(stableJSON(objA)).toBe(stableJSON(objB));
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2. sha256 determinism + format
// ---------------------------------------------------------------------------

describe("sha256 — property-based", () => {
  it("is deterministic: sha256(str) === sha256(str)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (str) => {
        expect(sha256(str)).toBe(sha256(str));
      }),
      { numRuns: 300 },
    );
  });

  it("always returns a 64-character lowercase hex string", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (str) => {
        const hash = sha256(str);
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 300 },
    );
  });

  it("different inputs produce different hashes (collision resistance)", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (a, b) => {
          fc.pre(a !== b);
          expect(sha256(a)).not.toBe(sha256(b));
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 3. hashDict determinism
// ---------------------------------------------------------------------------

describe("hashDict — property-based", () => {
  it("is deterministic for any object", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        expect(hashDict(obj)).toBe(hashDict(obj));
      }),
      { numRuns: 200 },
    );
  });

  it("is key-order-independent", () => {
    // hashDict contract: callers must provide unique keys per object.
    // We normalise duplicate keys (last-write-wins via Map) before building
    // objA/objB so the comparison is meaningful and deterministic.
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.string({ minLength: 1, maxLength: 10 }), fc.oneof(fc.string(), fc.integer())),
          { minLength: 2, maxLength: 8 },
        ),
        (entries) => {
          // Deduplicate: last occurrence wins for both orderings
          const unique = new Map<string, unknown>(entries);
          fc.pre(unique.size >= 2); // need ≥2 distinct keys to test ordering
          const uniqueEntries = [...unique.entries()];

          const objA: Record<string, unknown> = {};
          for (const [k, v] of uniqueEntries) objA[k] = v;

          const objB: Record<string, unknown> = {};
          for (const [k, v] of [...uniqueEntries].reverse()) objB[k] = v;

          expect(hashDict(objA)).toBe(hashDict(objB));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("returns 64-char hex", () => {
    fc.assert(
      fc.property(jsonObject, (obj) => {
        const hash = hashDict(obj);
        expect(hash).toHaveLength(64);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
      }),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 4. HashChain integrity
// ---------------------------------------------------------------------------

describe("HashChain — property-based", () => {
  it("verify() returns true after appending n random blocks", () => {
    fc.assert(
      fc.property(fc.array(jsonObject, { minLength: 0, maxLength: 20 }), (blocks) => {
        const chain = new HashChain<Record<string, unknown>>({ genesis: true });
        for (const block of blocks) {
          chain.append(block);
        }
        expect(chain.verifyIntegrity()).toBe(true);
        expect(chain.length).toBe(blocks.length + 1); // +1 for genesis
      }),
      { numRuns: 50 },
    );
  });

  it("detects tampering: modifying a block data causes verify to fail", () => {
    fc.assert(
      fc.property(
        fc.array(jsonObject, { minLength: 1, maxLength: 10 }),
        fc.nat(),
        (blocks, tamperSeed) => {
          const chain = new HashChain<Record<string, unknown>>({ genesis: true });
          for (const block of blocks) {
            chain.append(block);
          }
          expect(chain.verifyIntegrity()).toBe(true);

          // Tamper with a random block
          const entries = chain.getAllEntries();
          const tamperIdx = tamperSeed % entries.length;
          // Directly mutate the internal block data (break encapsulation for testing)
          (entries[tamperIdx]! as { data: unknown }).data = {
            tampered: true,
            seed: tamperSeed,
          };

          // getAllEntries returns copies, so we need to reach into the chain
          // The chain returns copies, so tampering the copy won't affect integrity.
          // Instead, export → tamper → fromJSON should fail.
          const exported = chain.exportToJSON();
          (exported.chain[tamperIdx]! as { data: unknown }).data = { tampered: true };
          // Recalculating from tampered export should throw
          expect(() => HashChain.fromJSON(exported)).toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it("chain length equals genesis + appended blocks", () => {
    fc.assert(
      fc.property(fc.nat({ max: 30 }), (n) => {
        const chain = new HashChain({ n: 0 });
        for (let i = 1; i <= n; i++) chain.append({ n: i });
        expect(chain.length).toBe(n + 1);
      }),
      { numRuns: 50 },
    );
  });

  it("headHash changes after every append", () => {
    fc.assert(
      fc.property(fc.array(jsonObject, { minLength: 1, maxLength: 15 }), (blocks) => {
        const chain = new HashChain<Record<string, unknown>>({ genesis: true });
        const hashes = new Set<string>();
        hashes.add(chain.headHash);
        for (const block of blocks) {
          chain.append(block);
          hashes.add(chain.headHash);
        }
        // Each append should produce a unique head hash
        expect(hashes.size).toBe(blocks.length + 1);
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. MerkleTree proof validity
// ---------------------------------------------------------------------------

describe("MerkleTree — property-based", () => {
  it("proof is valid for every leaf in the tree", () => {
    fc.assert(
      fc.property(
        fc.array(hexHash64, {
          minLength: 1,
          maxLength: 16,
        }),
        (leafHashes) => {
          const tree = new MerkleTree();
          for (const h of leafHashes) {
            tree.addLeaf(h);
          }

          for (let i = 0; i < leafHashes.length; i++) {
            const proof = tree.getProof(i);
            const valid = MerkleTree.verifyProof(leafHashes[i]!, proof, tree.root);
            expect(valid).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("proof fails with wrong leaf hash", () => {
    fc.assert(
      fc.property(
        fc.array(hexHash64, {
          minLength: 2,
          maxLength: 12,
        }),
        fc.nat(),
        (leafHashes, seed) => {
          const tree = new MerkleTree();
          for (const h of leafHashes) tree.addLeaf(h);

          const idx = seed % leafHashes.length;
          const proof = tree.getProof(idx);
          // Use a wrong leaf hash
          const wrongHash = sha256("wrong-leaf-" + seed);
          fc.pre(wrongHash !== leafHashes[idx]!);
          const valid = MerkleTree.verifyProof(wrongHash, proof, tree.root);
          expect(valid).toBe(false);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("root changes when a new leaf is added", () => {
    fc.assert(
      fc.property(
        fc.array(hexHash64, {
          minLength: 1,
          maxLength: 12,
        }),
        (leafHashes) => {
          const tree = new MerkleTree();
          const roots = new Set<string>();
          roots.add(tree.root); // empty root
          for (const h of leafHashes) {
            tree.addLeaf(h);
            roots.add(tree.root);
          }
          // Each state should have a unique root
          expect(roots.size).toBe(leafHashes.length + 1);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("size tracks the number of leaves added", () => {
    fc.assert(
      fc.property(
        fc.array(hexHash64, {
          maxLength: 20,
        }),
        (leafHashes) => {
          const tree = new MerkleTree();
          for (const h of leafHashes) tree.addLeaf(h);
          expect(tree.size).toBe(leafHashes.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Helper: assert keys are sorted recursively
// ---------------------------------------------------------------------------

function assertKeysSorted(obj: unknown): void {
  if (obj === null || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) assertKeysSorted(item);
    return;
  }
  const keys = Object.keys(obj as Record<string, unknown>);
  const sorted = [...keys].sort();
  expect(keys).toEqual(sorted);
  for (const key of keys) {
    assertKeysSorted((obj as Record<string, unknown>)[key]);
  }
}
