import { describe, it, expect } from "vitest";
import { ChainExporter } from "../chain-exporter.js";
import { HashChain } from "../hash-chain.js";
import { createReceipt, ReceiptChain } from "../receipt.js";
import { createEvidenceBundle } from "../evidence-bundle.js";
import { EvidenceSealer } from "../evidence-sealer.js";
import { sha256 } from "../types.js";
import { EvidenceType } from "../types.js";

const exporter = new ChainExporter();

function makeChain(): HashChain<{ event: string }> {
  const chain = new HashChain<{ event: string }>({ event: "genesis" });
  chain.append({ event: "step1" });
  chain.append({ event: "step2" });
  return chain;
}

describe("ChainExporter", () => {
  it("toJSON produces valid JSON with verification signature", () => {
    const chain = makeChain();
    const jsonStr = exporter.toJSON(chain);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.format).toBe("evidence-chain-json");
    expect(parsed.verificationSignature).toHaveLength(64);
    expect(parsed.chain).toHaveLength(3);
    expect(parsed.length).toBe(3);
  });

  it("toJSONL has correct line count (header + blocks)", () => {
    const chain = makeChain();
    const jsonl = exporter.toJSONL(chain);
    const lines = jsonl.split("\n");

    expect(lines.length).toBe(4); // 1 header + 3 blocks

    // Header line is valid JSON with signature
    const header = JSON.parse(lines[0]!);
    expect(header.format).toBe("evidence-chain-jsonl");
    expect(header.chainLength).toBe(3);
    expect(header.verificationSignature).toHaveLength(64);

    // Each block line is valid JSON
    for (let i = 1; i < lines.length; i++) {
      const block = JSON.parse(lines[i]!);
      expect(block.index).toBe(i - 1);
      expect(block.hash).toHaveLength(64);
    }
  });

  it("toMarkdown has proper headers and table", () => {
    const chain = makeChain();
    const md = exporter.toMarkdown(chain, "Test Audit Report");

    expect(md).toContain("# Test Audit Report");
    expect(md).toContain("**Chain Length:** 3 blocks");
    expect(md).toContain("**Integrity:** VERIFIED");
    expect(md).toContain("**Verification Signature:**");
    expect(md).toContain("| Index | Timestamp | Hash (first 16) | Prev Hash (first 16) |");
    expect(md).toContain("## Block Details");
    expect(md).toContain("### Block 0");
    expect(md).toContain("### Block 2");
    expect(md).toContain("```json");
  });

  it("verification signature is a valid SHA-256 hash", () => {
    const chain = makeChain();
    const jsonStr = exporter.toJSON(chain);
    const parsed = JSON.parse(jsonStr);
    const sig = parsed.verificationSignature as string;

    expect(sig).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(sig)).toBe(true);
  });

  it("verifyJSONExport validates signature correctness", () => {
    const chain = makeChain();
    const jsonStr = exporter.toJSON(chain);

    expect(exporter.verifyJSONExport(jsonStr)).toBe(true);

    // Tamper with the content
    const tampered = jsonStr.replace('"genesis"', '"hacked"');
    expect(exporter.verifyJSONExport(tampered)).toBe(false);
  });

  it("toMarkdown uses default title when none provided", () => {
    const chain = new HashChain({ init: true });
    const md = exporter.toMarkdown(chain);
    expect(md).toContain("# Evidence Chain Audit Report");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Static method tests
// ────────────────────────────────────────────────────────────────────────────

describe("ChainExporter.exportHashChain (static)", () => {
  it("JSON format produces valid JSON string with all blocks", () => {
    const chain = makeChain();
    const result = ChainExporter.exportHashChain(chain, { format: "json" });

    const parsed = JSON.parse(result);
    expect(parsed.chain).toHaveLength(3);
    expect(parsed.length).toBe(3);
    expect(parsed.format).toBe("evidence-chain-json");
  });

  it("JSONL format has one JSON object per line", () => {
    const chain = makeChain();
    const result = ChainExporter.exportHashChain(chain, { format: "jsonl" });

    const lines = result.split("\n");
    expect(lines.length).toBe(4); // 1 header + 3 blocks
    const header = JSON.parse(lines[0]!);
    expect(header.format).toBe("evidence-chain-jsonl");
    expect(header.chainLength).toBe(3);
    // Each block line is valid JSON
    for (let i = 1; i <= 3; i++) {
      expect(() => JSON.parse(lines[i]!)).not.toThrow();
    }
  });

  it("markdown format contains '# Evidence Chain Export'", () => {
    const chain = makeChain();
    const result = ChainExporter.exportHashChain(chain, { format: "markdown" });

    expect(result).toContain("# Evidence Chain Export");
    expect(result).toContain("**Blocks**: 3");
    expect(result).toContain("## Block 0 (Genesis)");
    expect(result).toContain("## Block 1");
  });

  it("includeHashes=false omits hash fields from JSONL", () => {
    const chain = makeChain();
    const result = ChainExporter.exportHashChain(chain, { format: "jsonl", includeHashes: false });

    const lines = result.split("\n");
    for (let i = 1; i < lines.length; i++) {
      const block = JSON.parse(lines[i]!);
      expect(block.hash).toBeUndefined();
      expect(block.previousHash).toBeUndefined();
    }
  });

  it("JSON format with prettyPrint=false produces compact JSON", () => {
    const chain = makeChain();
    const result = ChainExporter.exportHashChain(chain, { format: "json", prettyPrint: false });

    // compact JSON should not have newlines
    expect(result).not.toContain("\n");
    const parsed = JSON.parse(result);
    expect(parsed.chain).toHaveLength(3);
  });
});

describe("ChainExporter.exportReceiptChain (static)", () => {
  it("JSON export has all receipts", () => {
    const chain = new ReceiptChain();
    chain.append(createReceipt({ correlationId: "c1", actor: "agent", action: "read:foo.ts", beforeState: "a", afterState: "b" }));
    chain.append(createReceipt({ correlationId: "c1", actor: "agent", action: "write:bar.ts", beforeState: "c", afterState: "d" }));

    const result = ChainExporter.exportReceiptChain(chain, { format: "json" });
    const parsed = JSON.parse(result);

    expect(parsed.receipts).toHaveLength(2);
    expect(parsed.count).toBe(2);
    expect(parsed.merkleRoot).toHaveLength(64);
    expect(parsed.format).toBe("receipt-chain-json");
  });

  it("JSONL export has header + receipt lines", () => {
    const chain = new ReceiptChain();
    chain.append(createReceipt({ correlationId: "c2", actor: "tool", action: "bash:ls", beforeState: "x", afterState: "y" }));

    const result = ChainExporter.exportReceiptChain(chain, { format: "jsonl" });
    const lines = result.split("\n");

    expect(lines.length).toBe(2);
    const header = JSON.parse(lines[0]!);
    expect(header.format).toBe("receipt-chain-jsonl");
    expect(header.count).toBe(1);
  });

  it("markdown export contains receipt ID heading", () => {
    const chain = new ReceiptChain();
    chain.append(createReceipt({ correlationId: "c3", actor: "agent", action: "verify", beforeState: "s1", afterState: "s2" }));

    const result = ChainExporter.exportReceiptChain(chain, { format: "markdown" });
    expect(result).toContain("# Receipt Chain Export");
    expect(result).toContain("## Receipt:");
  });
});

describe("ChainExporter.exportBundle (static)", () => {
  it("markdown export has bundle ID", () => {
    const bundle = createEvidenceBundle({
      runId: "run-42",
      seq: 0,
      organ: "audit",
      eventType: EvidenceType.TOOL_RESULT,
      evidence: { status: "ok" },
      prevHash: "0".repeat(64),
    });

    const result = ChainExporter.exportBundle(bundle, { format: "markdown" });

    expect(result).toContain("# Evidence Bundle Export");
    expect(result).toContain(`**Bundle ID**: ${bundle.bundleId}`);
    expect(result).toContain("## Evidence Payload");
  });

  it("JSON export round-trips bundle data", () => {
    const bundle = createEvidenceBundle({
      runId: "run-99",
      seq: 1,
      organ: "core",
      eventType: EvidenceType.FILE_WRITE,
      evidence: { path: "src/main.ts", size: 1024 },
      prevHash: "0".repeat(64),
    });

    const result = ChainExporter.exportBundle(bundle, { format: "json" });
    const parsed = JSON.parse(result);

    expect(parsed.bundleId).toBe(bundle.bundleId);
    expect(parsed.evidence).toEqual(bundle.evidence);
  });
});

describe("ChainExporter.exportSeal (static)", () => {
  it("always exports as JSON with seal fields", () => {
    const sealer = new EvidenceSealer();
    const seal = sealer.createSeal({
      sessionId: "sess-001",
      evidenceRootHash: sha256("root"),
      config: { model: "claude" },
      metrics: [{ score: 100 }],
      eventCount: 42,
    });

    const result = ChainExporter.exportSeal(seal);
    const parsed = JSON.parse(result);

    expect(parsed.sealId).toBe(seal.sealId);
    expect(parsed.sealHash).toBe(seal.sealHash);
    expect(parsed.sessionId).toBe(seal.sessionId);
    expect(parsed.eventCount).toBe(42);
  });
});
