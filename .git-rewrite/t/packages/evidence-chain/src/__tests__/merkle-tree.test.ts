import { describe, it, expect } from "vitest";
import { MerkleTree } from "../merkle-tree.js";
import { sha256 } from "../types.js";

describe("MerkleTree", () => {
  it("empty tree has deterministic root (sha256('empty-merkle-root'))", () => {
    const tree = new MerkleTree();
    expect(tree.root).toBe(sha256("empty-merkle-root"));
  });

  it("single leaf: root equals sha256(leaf + leaf) per PRD §4.3 (self-pairing)", () => {
    const tree = new MerkleTree();
    const leaf = sha256("data");
    tree.addLeaf(leaf);
    expect(tree.root).toBe(sha256(leaf + leaf));
  });

  it("two leaves: root equals sha256(leaf1 + leaf2)", () => {
    const tree = new MerkleTree();
    const l1 = sha256("a");
    const l2 = sha256("b");
    tree.addLeaf(l1);
    tree.addLeaf(l2);
    expect(tree.root).toBe(sha256(l1 + l2));
  });

  it("four leaves: correct binary tree root", () => {
    const tree = new MerkleTree();
    const leaves = ["a", "b", "c", "d"].map((v) => sha256(v));
    for (const leaf of leaves) tree.addLeaf(leaf);
    const [l1, l2, l3, l4] = leaves as [string, string, string, string];
    const expected = sha256(sha256(l1 + l2) + sha256(l3 + l4));
    expect(tree.root).toBe(expected);
  });

  it("odd count (3 leaves): last leaf duplicated, root correct", () => {
    const tree = new MerkleTree();
    const leaves = ["x", "y", "z"].map((v) => sha256(v));
    for (const leaf of leaves) tree.addLeaf(leaf);
    const [l1, l2, l3] = leaves as [string, string, string];
    // Layer 1: [sha256(l1+l2), sha256(l3+l3)]
    const expected = sha256(sha256(l1 + l2) + sha256(l3 + l3));
    expect(tree.root).toBe(expected);
  });

  it("getProof returns valid proof steps for leaf 0", () => {
    const tree = new MerkleTree();
    const leaves = ["p", "q"].map((v) => sha256(v));
    for (const leaf of leaves) tree.addLeaf(leaf);
    const proof = tree.getProof(0);
    expect(proof).toHaveLength(1);
    expect(proof[0]!.direction).toBe("right");
    expect(proof[0]!.siblingHash).toBe(leaves[1]);
  });

  it("verifyProof succeeds with valid proof", () => {
    const tree = new MerkleTree();
    const leaves = ["a", "b", "c", "d"].map((v) => sha256(v));
    for (const leaf of leaves) tree.addLeaf(leaf);
    for (let i = 0; i < leaves.length; i++) {
      const proof = tree.getProof(i);
      expect(MerkleTree.verifyProof(leaves[i]!, proof, tree.root)).toBe(true);
    }
  });

  it("verifyProof fails with tampered leaf hash", () => {
    const tree = new MerkleTree();
    const leaves = ["a", "b"].map((v) => sha256(v));
    for (const leaf of leaves) tree.addLeaf(leaf);
    const proof = tree.getProof(0);
    expect(MerkleTree.verifyProof("0".repeat(64), proof, tree.root)).toBe(false);
  });

  it("verifyProof fails with wrong root", () => {
    const tree = new MerkleTree();
    const leaf = sha256("test");
    tree.addLeaf(leaf);
    const proof = tree.getProof(0);
    expect(MerkleTree.verifyProof(leaf, proof, "wrong" + "0".repeat(59))).toBe(false);
  });

  it("large tree (1000 leaves): proof verification for leaf #500 succeeds", () => {
    const tree = new MerkleTree();
    const leaves: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const leaf = sha256(`leaf-${i}`);
      leaves.push(leaf);
      tree.addLeaf(leaf);
    }
    const proof = tree.getProof(500);
    expect(MerkleTree.verifyProof(leaves[500]!, proof, tree.root)).toBe(true);
  });

  it("size returns correct count", () => {
    const tree = new MerkleTree();
    expect(tree.size).toBe(0);
    tree.addLeaf(sha256("a"));
    expect(tree.size).toBe(1);
    tree.addLeaf(sha256("b"));
    expect(tree.size).toBe(2);
  });

  it("getProof() throws RangeError for out-of-range indices", () => {
    const tree = new MerkleTree();
    tree.addLeaf(sha256("a"));
    expect(() => tree.getProof(1)).toThrow(RangeError);
    expect(() => tree.getProof(-1)).toThrow(RangeError);
    const emptyTree = new MerkleTree();
    expect(() => emptyTree.getProof(0)).toThrow(RangeError);
  });

  it("single-leaf tree: getProof(0) + verifyProof roundtrip succeeds (EC-2 self-pairing)", () => {
    const tree = new MerkleTree();
    const leaf = sha256("solo");
    tree.addLeaf(leaf);
    // Root = sha256(leaf+leaf); proof has the self-pairing sibling
    const proof = tree.getProof(0);
    expect(proof).toHaveLength(1);
    expect(proof[0]!.direction).toBe("right");
    expect(proof[0]!.siblingHash).toBe(leaf);
    expect(MerkleTree.verifyProof(leaf, proof, tree.root)).toBe(true);
  });
});
