// ============================================================================
// @dantecode/evidence-chain — Chain Exporter
// Exports hash chains to JSON, JSONL, and Markdown formats with
// verification signature headers for audit trails.
// ============================================================================

import type { HashChain } from "./hash-chain.js";
import { sha256, stableJSON } from "./types.js";

// ────────────────────────────────────────────────────────────────────────────
// Exporter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Exports hash chains to multiple formats for audit trails and reporting.
 *
 * - **JSON**: Human-readable formatted JSON with verification signature.
 * - **JSONL**: One JSON object per line (machine-processable, streaming).
 * - **Markdown**: Audit report with header, summary table, and block details.
 *
 * All exports include a SHA-256 verification signature of the content
 * for tamper detection during transit/storage.
 */
export class ChainExporter {
  /**
   * Export chain to human-readable JSON with a verification signature header.
   * Returns a valid JSON string.
   */
  toJSON<T>(chain: HashChain<T>): string {
    const exported = chain.exportToJSON();
    const body = {
      format: "evidence-chain-json",
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      ...exported,
    };
    const content = JSON.stringify(body, null, 2);
    const signature = sha256(content);
    const envelope = {
      verificationSignature: signature,
      ...body,
    };
    return JSON.stringify(envelope, null, 2);
  }

  /**
   * Export chain to JSONL format (one JSON object per line).
   * First line is a header with metadata and verification signature.
   * Each subsequent line is a single chain block.
   */
  toJSONL<T>(chain: HashChain<T>): string {
    const entries = chain.getAllEntries();
    const lines: string[] = [];

    // Collect block lines first so we can compute signature
    const blockLines = entries.map((block) => stableJSON(block));
    const blocksContent = blockLines.join("\n");
    const signature = sha256(blocksContent);

    // Header line
    const header = {
      format: "evidence-chain-jsonl",
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      chainLength: entries.length,
      verificationSignature: signature,
    };
    lines.push(JSON.stringify(header));

    // Block lines
    for (const blockLine of blockLines) {
      lines.push(blockLine);
    }

    return lines.join("\n");
  }

  /**
   * Export chain to Markdown audit report format.
   * Includes title, summary, verification signature, and a block table.
   */
  toMarkdown<T>(chain: HashChain<T>, title?: string): string {
    const entries = chain.getAllEntries();
    const reportTitle = title ?? "Evidence Chain Audit Report";
    const exportedAt = new Date().toISOString();

    // Compute verification signature of all block hashes
    const hashContent = entries.map((b) => b.hash).join(":");
    const signature = sha256(hashContent);

    const lines: string[] = [];

    // Title and metadata
    lines.push(`# ${reportTitle}`);
    lines.push("");
    lines.push(`**Exported:** ${exportedAt}`);
    lines.push(`**Chain Length:** ${entries.length} blocks`);
    lines.push(`**Head Hash:** ${entries.length > 0 ? chain.headHash : "N/A"}`);
    lines.push(`**Integrity:** ${chain.verifyIntegrity() ? "VERIFIED" : "FAILED"}`);
    lines.push(`**Verification Signature:** \`${signature}\``);
    lines.push("");

    // Summary table
    lines.push("## Block Summary");
    lines.push("");
    lines.push("| Index | Timestamp | Hash (first 16) | Prev Hash (first 16) |");
    lines.push("|-------|-----------|------------------|----------------------|");

    for (const block of entries) {
      lines.push(
        `| ${block.index} | ${block.timestamp} | \`${block.hash.slice(0, 16)}\` | \`${block.previousHash.slice(0, 16)}\` |`,
      );
    }

    lines.push("");

    // Block details
    if (entries.length > 0) {
      lines.push("## Block Details");
      lines.push("");

      for (const block of entries) {
        lines.push(`### Block ${block.index}`);
        lines.push("");
        lines.push(`- **Timestamp:** ${block.timestamp}`);
        lines.push(`- **Hash:** \`${block.hash}\``);
        lines.push(`- **Previous Hash:** \`${block.previousHash}\``);
        lines.push(`- **Data:**`);
        lines.push("");
        lines.push("```json");
        lines.push(JSON.stringify(block.data, null, 2));
        lines.push("```");
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * Compute a verification signature for exported content.
   * Can be used independently to verify any exported string.
   */
  computeSignature(content: string): string {
    return sha256(content);
  }

  /**
   * Verify that an exported JSON string matches its embedded signature.
   */
  verifyJSONExport(jsonStr: string): boolean {
    try {
      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      const storedSignature = parsed["verificationSignature"] as string;
      if (!storedSignature) return false;

      // Remove the signature and recompute
      const { verificationSignature: _sig, ...body } = parsed;
      const content = JSON.stringify(body, null, 2);
      const recomputed = sha256(content);
      return storedSignature === recomputed;
    } catch {
      return false;
    }
  }
}
