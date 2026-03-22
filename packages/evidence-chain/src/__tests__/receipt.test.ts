import { describe, it, expect } from "vitest";
import { createReceipt, ReceiptChain } from "../receipt.js";
import { sha256 } from "../types.js";

describe("createReceipt", () => {
  it("computes correct receiptHash", () => {
    const receipt = createReceipt({
      correlationId: "session-1",
      actor: "file-writer",
      action: "file_write:src/auth.ts",
      beforeState: "before content",
      afterState: "after content",
    });
    const expectedReceiptHash = sha256(
      `${receipt.receiptId}:${receipt.correlationId}:${receipt.actor}:${receipt.action}:${receipt.beforeHash}:${receipt.afterHash}`,
    );
    expect(receipt.receiptHash).toBe(expectedReceiptHash);
  });
});

describe("ReceiptChain", () => {
  it("append returns incrementing indices", () => {
    const chain = new ReceiptChain();
    const r1 = createReceipt({
      correlationId: "s1",
      actor: "a",
      action: "write",
      beforeState: "x",
      afterState: "y",
    });
    const r2 = createReceipt({
      correlationId: "s1",
      actor: "a",
      action: "write",
      beforeState: "y",
      afterState: "z",
    });
    expect(chain.append(r1)).toBe(0);
    expect(chain.append(r2)).toBe(1);
  });

  it("getReceipt returns correct receipt by index", () => {
    const chain = new ReceiptChain();
    const receipt = createReceipt({
      correlationId: "s2",
      actor: "b",
      action: "delete",
      beforeState: { file: "x" },
      afterState: {},
    });
    chain.append(receipt);
    expect(chain.getReceipt(0)).toEqual(receipt);
  });

  it("getProof returns valid Merkle proof for receipt", () => {
    const chain = new ReceiptChain();
    for (let i = 0; i < 4; i++) {
      chain.append(
        createReceipt({
          correlationId: "s3",
          actor: "c",
          action: `op${i}`,
          beforeState: `before${i}`,
          afterState: `after${i}`,
        }),
      );
    }
    const proof = chain.getProof(2);
    expect(Array.isArray(proof)).toBe(true);
    expect(proof.length).toBeGreaterThan(0);
  });

  it("verify returns true for valid receipt", () => {
    const chain = new ReceiptChain();
    for (let i = 0; i < 4; i++) {
      chain.append(
        createReceipt({
          correlationId: "s4",
          actor: "d",
          action: `op${i}`,
          beforeState: `b${i}`,
          afterState: `a${i}`,
        }),
      );
    }
    for (let i = 0; i < 4; i++) {
      expect(chain.verify(i)).toBe(true);
    }
  });

  it("100 receipts: merkleRoot is deterministic", () => {
    const makeChain = () => {
      const c = new ReceiptChain();
      for (let i = 0; i < 100; i++) {
        c.append(
          createReceipt({
            correlationId: "s5",
            actor: "e",
            action: `op${i}`,
            beforeState: `b${i}`,
            afterState: `a${i}`,
          }),
        );
      }
      return c;
    };
    // NOTE: receipts have random UUIDs, so two independent chains won't match.
    // This test verifies the root is stable for the same receipts.
    const chain = makeChain();
    const exported = chain.exportToJSON();
    const chain2 = ReceiptChain.fromJSON(exported);
    expect(chain2.merkleRoot).toBe(chain.merkleRoot);
  });

  it("exportToJSON → fromJSON roundtrip works", () => {
    const chain = new ReceiptChain();
    for (let i = 0; i < 5; i++) {
      chain.append(
        createReceipt({
          correlationId: "s6",
          actor: "f",
          action: `op${i}`,
          beforeState: `b${i}`,
          afterState: `a${i}`,
        }),
      );
    }
    const exported = chain.exportToJSON();
    const restored = ReceiptChain.fromJSON(exported);
    expect(restored.size).toBe(chain.size);
    expect(restored.merkleRoot).toBe(chain.merkleRoot);
    expect(restored.getAllReceipts()).toEqual(chain.getAllReceipts());
  });

  it("fromJSON with tampered merkleRoot rejects", () => {
    const chain = new ReceiptChain();
    chain.append(
      createReceipt({
        correlationId: "s7",
        actor: "g",
        action: "write",
        beforeState: "x",
        afterState: "y",
      }),
    );
    const exported = chain.exportToJSON();
    exported.merkleRoot = "0".repeat(64);
    expect(() => ReceiptChain.fromJSON(exported)).toThrow();
  });

  it("fromJSON() rejects when receipt field (actor) is tampered — receiptHash not updated", () => {
    const chain = new ReceiptChain();
    chain.append(
      createReceipt({
        correlationId: "s-tamper1",
        actor: "original-actor",
        action: "write",
        beforeState: "x",
        afterState: "y",
      }),
    );
    const exported = chain.exportToJSON();
    // Mutate actor but leave receiptHash pointing to the original un-tampered fields
    exported.receipts[0]!.actor = "tampered-actor";
    // Re-derive check: sha256(tampered fields) ≠ original receiptHash → throws
    expect(() => ReceiptChain.fromJSON(exported)).toThrow(/tampered content/);
  });

  it("fromJSON() rejects when afterHash is tampered with a forged receiptHash (Merkle root catches it)", () => {
    const chain = new ReceiptChain();
    chain.append(
      createReceipt({
        correlationId: "s-tamper2",
        actor: "a",
        action: "op",
        beforeState: "before",
        afterState: "after",
      }),
    );
    const exported = chain.exportToJSON();
    const original = exported.receipts[0]!;
    // Attacker forges afterHash AND recomputes receiptHash so the per-receipt check passes
    const newAfterHash = sha256("TAMPERED");
    const forgedReceiptHash = sha256(
      `${original.receiptId}:${original.correlationId}:${original.actor}:${original.action}:${original.beforeHash}:${newAfterHash}`,
    );
    exported.receipts[0] = { ...original, afterHash: newAfterHash, receiptHash: forgedReceiptHash };
    // Per-receipt check passes, but Merkle tree rebuilds with forged leaf → root mismatch → throws
    expect(() => ReceiptChain.fromJSON(exported)).toThrow(/merkleRoot mismatch/);
  });
});
