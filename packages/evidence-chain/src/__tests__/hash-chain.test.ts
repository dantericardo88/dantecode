import { describe, it, expect } from "vitest";
import { HashChain, HashChainError } from "../hash-chain.js";

describe("HashChain", () => {
  it("genesis block has index 0 and previousHash is 64 zeros", () => {
    const chain = new HashChain({ value: "genesis" });
    const genesis = chain.getEntry(0)!;
    expect(genesis.index).toBe(0);
    expect(genesis.previousHash).toBe("0".repeat(64));
    expect(genesis.hash).toHaveLength(64);
  });

  it("appended block has index 1 and previousHash matches genesis hash", () => {
    const chain = new HashChain({ value: "genesis" });
    const genesisHash = chain.headHash;
    chain.append({ value: "block1" });
    const block1 = chain.getEntry(1)!;
    expect(block1.index).toBe(1);
    expect(block1.previousHash).toBe(genesisHash);
  });

  it("multi-append: 100 blocks all have unique hashes", () => {
    const chain = new HashChain({ n: 0 });
    for (let i = 1; i <= 99; i++) chain.append({ n: i });
    const entries = chain.getAllEntries();
    const hashes = entries.map((e) => e.hash);
    const unique = new Set(hashes);
    expect(unique.size).toBe(100);
  });

  it("verifyIntegrity returns true on untouched chain", () => {
    const chain = new HashChain({ value: "start" });
    chain.append({ value: "a" });
    chain.append({ value: "b" });
    expect(chain.verifyIntegrity()).toBe(true);
  });

  it("tamper: modify data of block #5 — verifyIntegrity returns false", () => {
    const chain = new HashChain({ n: 0 });
    for (let i = 1; i <= 9; i++) chain.append({ n: i });
    const tampered = chain.exportToJSON();
    tampered.chain[5] = { ...tampered.chain[5]!, data: { n: 999 } as unknown as { n: number } };
    // Rebuild with tampered data but keep original hashes (so integrity check catches it)
    const rebuilt = new HashChain<{ n: number }>({ n: 0 });
    rebuilt["blocks"] = tampered.chain;
    expect(rebuilt.verifyIntegrity()).toBe(false);
  });

  it("tamper: modify hash of block #5 — verifyIntegrity returns false", () => {
    const chain = new HashChain({ n: 0 });
    for (let i = 1; i <= 9; i++) chain.append({ n: i });
    const exported = chain.exportToJSON();
    exported.chain[5]!.hash = "a".repeat(64);
    const rebuilt = new HashChain<{ n: number }>({ n: 0 });
    rebuilt["blocks"] = exported.chain;
    expect(rebuilt.verifyIntegrity()).toBe(false);
  });

  it("append on tampered chain throws HashChainError", () => {
    const chain = new HashChain({ n: 0 });
    for (let i = 1; i <= 4; i++) chain.append({ n: i });
    chain["blocks"][2]!.hash = "b".repeat(64);
    expect(() => chain.append({ n: 99 })).toThrow(HashChainError);
  });

  it("exportToJSON → fromJSON roundtrip produces identical chain", () => {
    const chain = new HashChain({ x: 1 }, { sessionId: "abc" });
    chain.append({ x: 2 });
    chain.append({ x: 3 });
    const exported = chain.exportToJSON();
    const restored = HashChain.fromJSON(exported);
    expect(restored.length).toBe(chain.length);
    expect(restored.headHash).toBe(chain.headHash);
    expect(restored.getAllEntries()).toEqual(chain.getAllEntries());
  });

  it("fromJSON on tampered export throws error", () => {
    const chain = new HashChain({ v: 1 });
    chain.append({ v: 2 });
    const exported = chain.exportToJSON();
    exported.chain[1]!.hash = "c".repeat(64);
    expect(() => HashChain.fromJSON(exported)).toThrow(HashChainError);
  });

  it("findEntries returns correct subset", () => {
    const chain = new HashChain({ n: 0 });
    for (let i = 1; i <= 9; i++) chain.append({ n: i });
    const evens = chain.findEntries((b) => (b.data as { n: number }).n % 2 === 0);
    expect(evens.map((b) => (b.data as { n: number }).n)).toEqual([0, 2, 4, 6, 8]);
  });

  it("getEntry out of range returns null", () => {
    const chain = new HashChain({ v: 1 });
    expect(chain.getEntry(999)).toBeNull();
    expect(chain.getEntry(-1)).toBeNull();
  });

  it("headHash matches last block hash", () => {
    const chain = new HashChain({ v: 1 });
    chain.append({ v: 2 });
    chain.append({ v: 3 });
    const all = chain.getAllEntries();
    expect(chain.headHash).toBe(all[all.length - 1]!.hash);
  });
});
