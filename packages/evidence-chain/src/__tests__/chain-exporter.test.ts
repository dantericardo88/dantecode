import { describe, it, expect } from "vitest";
import { ChainExporter } from "../chain-exporter.js";
import { HashChain } from "../hash-chain.js";

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
