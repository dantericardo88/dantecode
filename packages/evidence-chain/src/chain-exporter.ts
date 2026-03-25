// ============================================================================
// @dantecode/evidence-chain — Chain Exporter
// Exports hash chains to JSON, JSONL, and Markdown formats with
// verification signature headers for audit trails.
// ============================================================================

import type { HashChain } from "./hash-chain.js";
import { sha256, stableJSON } from "./types.js";
import type { ReceiptChain } from "./receipt.js";
import type { EvidenceBundleData } from "./evidence-bundle.js";
import type { CertificationSeal } from "./evidence-sealer.js";

// ────────────────────────────────────────────────────────────────────────────
// Export Options
// ────────────────────────────────────────────────────────────────────────────

export interface ExportOptions {
  format: "json" | "jsonl" | "markdown";
  /** Include hashes in export output. Default: true. */
  includeHashes?: boolean;
  /** Pretty-print output (json/markdown). Default: true for json/md. */
  prettyPrint?: boolean;
}

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

  // ──────────────────────────────────────────────────────────────────────────
  // Static API — matches spec interface
  // ──────────────────────────────────────────────────────────────────────────

  /** Export a HashChain to the specified format. */
  static exportHashChain<T>(chain: HashChain<T>, options: ExportOptions): string {
    const includeHashes = options.includeHashes !== false;
    const entries = chain.getAllEntries();

    if (options.format === "json") {
      const blocks = includeHashes
        ? entries
        : entries.map(({ hash: _h, previousHash: _p, ...rest }) => rest);
      const prettyPrint = options.prettyPrint !== false;
      const exported = {
        format: "evidence-chain-json",
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        metadata: chain.exportToJSON().metadata,
        chain: blocks,
        length: entries.length,
        verified: chain.verifyIntegrity(),
      };
      return prettyPrint ? JSON.stringify(exported, null, 2) : JSON.stringify(exported);
    }

    if (options.format === "jsonl") {
      const lines: string[] = [];
      const header = {
        format: "evidence-chain-jsonl",
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        chainLength: entries.length,
      };
      lines.push(JSON.stringify(header));
      for (const block of entries) {
        const b = includeHashes ? block : (({ hash: _h, previousHash: _p, ...rest }) => rest)(block);
        lines.push(stableJSON(b));
      }
      return lines.join("\n");
    }

    // markdown
    const prettyPrint = options.prettyPrint !== false;
    if (!prettyPrint) {
      // compact markdown — still produce valid markdown
    }
    const lines: string[] = [];
    lines.push("# Evidence Chain Export");
    lines.push("");
    lines.push(`**Blocks**: ${entries.length}`);
    if (entries.length > 0 && includeHashes) {
      lines.push(`**Genesis**: ${entries[0]!.hash}`);
      lines.push(`**Head**: ${entries[entries.length - 1]!.hash}`);
    }
    lines.push("");
    for (const block of entries) {
      const label = block.index === 0 ? `## Block 0 (Genesis)` : `## Block ${block.index}`;
      lines.push(label);
      lines.push(`- Index: ${block.index}`);
      if (includeHashes) {
        lines.push(`- Hash: ${block.hash}`);
        lines.push(`- Previous: ${block.previousHash}`);
      }
      lines.push(`- Data: ${JSON.stringify(block.data)}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  /** Export a ReceiptChain to the specified format. */
  static exportReceiptChain(chain: ReceiptChain, options: ExportOptions): string {
    const receipts = chain.getAllReceipts();
    const exported = chain.exportToJSON();
    const includeHashes = options.includeHashes !== false;

    if (options.format === "json") {
      const prettyPrint = options.prettyPrint !== false;
      const body = {
        format: "receipt-chain-json",
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        merkleRoot: exported.merkleRoot,
        receipts: includeHashes ? receipts : receipts.map(({ receiptHash: _rh, ...rest }) => rest),
        count: receipts.length,
      };
      return prettyPrint ? JSON.stringify(body, null, 2) : JSON.stringify(body);
    }

    if (options.format === "jsonl") {
      const lines: string[] = [];
      const header = {
        format: "receipt-chain-jsonl",
        version: "1.0.0",
        exportedAt: new Date().toISOString(),
        count: receipts.length,
        merkleRoot: exported.merkleRoot,
      };
      lines.push(JSON.stringify(header));
      for (const receipt of receipts) {
        const r = includeHashes ? receipt : (({ receiptHash: _rh, ...rest }) => rest)(receipt);
        lines.push(stableJSON(r));
      }
      return lines.join("\n");
    }

    // markdown
    const lines: string[] = [];
    lines.push("# Receipt Chain Export");
    lines.push("");
    lines.push(`**Receipts**: ${receipts.length}`);
    if (includeHashes) lines.push(`**Merkle Root**: ${exported.merkleRoot}`);
    lines.push("");
    for (const receipt of receipts) {
      lines.push(`## Receipt: ${receipt.receiptId}`);
      lines.push(`- Actor: ${receipt.actor}`);
      lines.push(`- Action: ${receipt.action}`);
      lines.push(`- Correlation: ${receipt.correlationId}`);
      lines.push(`- Timestamp: ${receipt.timestamp}`);
      if (includeHashes) {
        lines.push(`- Before: ${receipt.beforeHash}`);
        lines.push(`- After: ${receipt.afterHash}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  /** Export an EvidenceBundle to the specified format. */
  static exportBundle(bundle: EvidenceBundleData, options: ExportOptions): string {
    const includeHashes = options.includeHashes !== false;

    if (options.format === "json") {
      const prettyPrint = options.prettyPrint !== false;
      const body = includeHashes ? bundle : (({ hash: _h, prevHash: _p, ...rest }) => rest)(bundle);
      return prettyPrint ? JSON.stringify(body, null, 2) : JSON.stringify(body);
    }

    if (options.format === "jsonl") {
      return stableJSON(bundle);
    }

    // markdown
    const lines: string[] = [];
    lines.push("# Evidence Bundle Export");
    lines.push("");
    lines.push(`**Bundle ID**: ${bundle.bundleId}`);
    lines.push(`**Run ID**: ${bundle.runId}`);
    lines.push(`**Organ**: ${bundle.organ}`);
    lines.push(`**Event Type**: ${bundle.eventType}`);
    lines.push(`**Seq**: ${bundle.seq}`);
    lines.push(`**Timestamp**: ${bundle.timestamp}`);
    if (includeHashes) {
      lines.push(`**Hash**: ${bundle.hash}`);
      lines.push(`**Prev Hash**: ${bundle.prevHash}`);
    }
    lines.push("");
    lines.push("## Evidence Payload");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(bundle.evidence, null, 2));
    lines.push("```");
    lines.push("");
    return lines.join("\n");
  }

  /**
   * Export a CertificationSeal to JSON.
   * Seals are always exported as JSON (not markdown) because they are
   * machine-verifiable cryptographic artifacts.
   */
  static exportSeal(seal: CertificationSeal): string {
    return JSON.stringify(seal, null, 2);
  }
}
