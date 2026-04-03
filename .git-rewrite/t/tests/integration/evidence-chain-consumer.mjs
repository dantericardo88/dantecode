#!/usr/bin/env node
/**
 * Pass 2.1 — evidence-chain standalone consumer test
 * Tests that @dantecode/evidence-chain works when consumed as a real dependency.
 * Run via: node tests/integration/evidence-chain-consumer.mjs
 */

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const distPath = resolve(repoRoot, "packages/evidence-chain/dist/index.js");
const {
  HashChain,
  MerkleTree,
  ReceiptChain,
  createReceipt,
  createEvidenceBundle,
  verifyBundle,
  EvidenceSealer,
  EvidenceType,
  sha256,
} = await import(pathToFileURL(distPath).href);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

// ─── Test 1: HashChain — genesis + 99 appends = 100 total blocks ─────────────
console.log("\n[2.1.1] HashChain — genesis + 99 appends (100 total), verify integrity");
{
  // Constructor requires genesisData; starts at length=1
  const chain = new HashChain({ event: "genesis", value: 0 }, { source: "consumer-test" });
  for (let i = 1; i < 100; i++) {
    chain.append({ event: `step-${i}`, value: i * 7 });
  }
  assert(chain.length === 100, "HashChain has 100 total blocks (genesis + 99 appends)");
  assert(chain.verifyIntegrity(), "HashChain verifyIntegrity() passes");

  const exported = chain.exportToJSON();
  assert(exported.length === 100, "exportToJSON() reports length:100");
  assert(exported.verified === true, "exportToJSON() reports verified:true");
  assert(Array.isArray(exported.chain), "exportToJSON() has chain array");

  // Genesis block
  assert(
    exported.chain[0].previousHash === "0".repeat(64),
    "Genesis block previousHash is 64 zeros",
  );
  assert(exported.chain[99].hash.length === 64, "Last block hash is 64 hex chars");
  assert(chain.headHash.length === 64, "headHash is 64 hex chars");

  // Round-trip import
  const restored = HashChain.fromJSON(exported);
  assert(restored.length === 100, "fromJSON() restores 100 blocks");
  assert(restored.verifyIntegrity(), "Restored chain verifyIntegrity() passes");
}

// ─── Test 2: MerkleTree — 50 leaves, proof verification ────────────────────
console.log("\n[2.1.2] MerkleTree — 50 leaves, proof for leaf 25");
{
  const tree = new MerkleTree();
  const leafHashes = [];
  for (let i = 0; i < 50; i++) {
    const h = sha256(`leaf-data-${i}-value`);
    leafHashes.push(h);
    tree.addLeaf(h);
  }

  assert(tree.size === 50, "MerkleTree has 50 leaves");
  assert(tree.root.length === 64, "MerkleTree root is 64 hex chars");

  const proof = tree.getProof(25);
  assert(Array.isArray(proof), "getProof(25) returns an array");

  const isValid = MerkleTree.verifyProof(leafHashes[25], proof, tree.root);
  assert(isValid, "Proof for leaf 25 verifies correctly against root");

  // Tamper test — wrong leaf hash
  const isTampered = MerkleTree.verifyProof(sha256("tampered-data"), proof, tree.root);
  assert(!isTampered, "Tampered leaf fails Merkle proof verification");

  // Edge case: single leaf
  const singleTree = new MerkleTree();
  const singleHash = sha256("only-leaf");
  singleTree.addLeaf(singleHash);
  const singleProof = singleTree.getProof(0);
  const singleValid = MerkleTree.verifyProof(singleHash, singleProof, singleTree.root);
  assert(singleValid, "Single-leaf MerkleTree proof verifies correctly");
}

// ─── Test 3: ReceiptChain — 20 receipts ────────────────────────────────────
console.log("\n[2.1.3] ReceiptChain — 20 receipts, export/import round-trip");
{
  const chain = new ReceiptChain();
  for (let i = 0; i < 20; i++) {
    const receipt = createReceipt({
      correlationId: `corr-${i}`,
      actor: `agent-${i % 3}`,
      action: i % 2 === 0 ? "file:write" : "tool:execute",
      beforeState: { step: i, phase: "before" },
      afterState: { step: i, phase: "after", success: true },
    });
    chain.append(receipt);
  }

  assert(chain.size === 20, "ReceiptChain has 20 receipts");
  assert(chain.merkleRoot.length === 64, "ReceiptChain merkleRoot is 64 hex chars");
  assert(chain.verify(0), "verify(0) passes for first receipt");
  assert(chain.verify(19), "verify(19) passes for last receipt");

  // Export/import round-trip
  const exported = chain.exportToJSON();
  assert(exported.receipts.length === 20, "exportToJSON() has 20 receipts");
  assert(exported.merkleRoot === chain.merkleRoot, "Exported merkleRoot matches chain root");

  const restored = ReceiptChain.fromJSON(exported);
  assert(restored.size === 20, "fromJSON() restores 20 receipts");
  assert(restored.merkleRoot === chain.merkleRoot, "Restored merkleRoot matches original");
}

// ─── Test 4: EvidenceBundle + tamper detection ──────────────────────────────
console.log("\n[2.1.4] EvidenceBundle — create, verify, tamper detection");
{
  const evidencePayload = {
    filePath: "/src/auth.ts",
    bytesWritten: 2048,
    checksum: sha256("file-content-here"),
  };

  const bundle = createEvidenceBundle({
    runId: "run-consumer-test-001",
    seq: 1,
    organ: "file-writer",
    eventType: EvidenceType.FILE_WRITE,
    evidence: evidencePayload,
    prevHash: "0".repeat(64),
    metadata: { test: true },
  });

  assert(typeof bundle.bundleId === "string", "Bundle has bundleId");
  assert(bundle.bundleId.startsWith("ev_"), "bundleId starts with ev_");
  assert(typeof bundle.hash === "string", "Bundle has hash");
  assert(bundle.hash.length === 64, "Bundle hash is 64 hex chars");
  assert(bundle.runId === "run-consumer-test-001", "Bundle has correct runId");
  assert(bundle.eventType === EvidenceType.FILE_WRITE, "Bundle has correct eventType");

  const isValid = verifyBundle(bundle);
  assert(isValid, "verifyBundle(bundle) returns true for untampered bundle");

  // Tamper: mutate the hash
  const tampered = { ...bundle, hash: "0".repeat(64) };
  const tamperedValid = verifyBundle(tampered);
  assert(!tamperedValid, "Tampered bundle (wrong hash) fails verifyBundle()");
}

// ─── Test 5: EvidenceSealer ────────────────────────────────────────────────
console.log("\n[2.1.5] EvidenceSealer — createSeal and verifySeal");
{
  const sealer = new EvidenceSealer();

  const config = { model: "claude-sonnet-4-6", temperature: 0.7 };
  const metrics = [{ id: "faithfulness", score: 0.95 }];

  const seal = sealer.createSeal({
    sessionId: "seal-test-session",
    evidenceRootHash: "c".repeat(64),
    config,
    metrics,
    eventCount: 42,
  });

  assert(typeof seal.sealId === "string", "Seal has sealId");
  assert(seal.sealId.startsWith("DC-SEAL-"), "sealId starts with DC-SEAL-");
  assert(seal.sealHash.length === 64, "Seal hash is 64 hex chars");
  assert(seal.sessionId === "seal-test-session", "Seal has correct sessionId");
  assert(seal.eventCount === 42, "Seal has correct eventCount");

  const isValid = sealer.verifySeal(seal, config, metrics);
  assert(isValid, "verifySeal() passes with original config + metrics");

  // Tamper: use different config for verification
  const wrongConfig = { model: "gpt-4", temperature: 1.0 };
  const tamperedValid = sealer.verifySeal(seal, wrongConfig, metrics);
  assert(!tamperedValid, "verifySeal() fails with wrong config");
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`evidence-chain consumer test: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log("PASS — evidence-chain works as standalone consumer");
}
