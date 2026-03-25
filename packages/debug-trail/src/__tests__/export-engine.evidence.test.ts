// ============================================================================
// @dantecode/debug-trail — ExportEngine Evidence Integration Tests
// Covers evidence chain embedding, seal generation, and legacy (no-logger) export.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { AuditLogger } from "../audit-logger.js";
import { ExportEngine } from "../export-engine.js";

describe("ExportEngine — Evidence Integration", () => {
  let storageRoot: string;
  let sessionId: string;
  let logger: AuditLogger;
  let engine: ExportEngine;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "dt-export-evidence-"));
    sessionId = `sess_export_${Date.now()}`;
    logger = new AuditLogger({ config: { storageRoot }, sessionId });
    await logger.init();
    engine = new ExportEngine({ storageRoot });
  });

  it("exportSession with logger option includes evidence section in JSON output", async () => {
    await logger.logToolCall("exportTool", { phase: "test" });
    await logger.logFileWrite("/tmp/export-test.ts");
    await logger.flush({ endSession: false });

    const outputPath = join(storageRoot, `${sessionId}-evidence.json`);
    await engine.exportSession(sessionId, {
      format: "json",
      logger,
      outputPath,
    });

    const raw = await readFile(outputPath, "utf8");
    const doc = JSON.parse(raw);

    // Must include an evidence section
    expect(doc).toHaveProperty("evidence");
    expect(doc.evidence).toHaveProperty("chain");
    expect(doc.evidence).toHaveProperty("receipts");
    expect(doc.evidence).toHaveProperty("merkleRoot");

    // The merkle root must be a valid 64-char hex string
    expect(doc.evidence.merkleRoot).toMatch(/^[0-9a-f]{64}$/i);

    // Chain is a HashChainExport object (contains .chain array of blocks)
    expect(typeof doc.evidence.chain).toBe("object");
    expect(Array.isArray(doc.evidence.chain.chain)).toBe(true);
    expect(doc.evidence.chain.chain.length).toBeGreaterThan(0);

    await rm(storageRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("exportSession with seal=true and sealConfig includes seal and verificationInstructions", async () => {
    await logger.logToolCall("sealExportTool", { run: 1 });
    await logger.logFileWrite("/tmp/seal-export.ts");
    await logger.flush({ endSession: false });

    const sealConfig = { model: "gpt-4", temperature: 0.0, maxTokens: 2048 };
    const outputPath = join(storageRoot, `${sessionId}-sealed.json`);

    await engine.exportSession(sessionId, {
      format: "json",
      logger,
      seal: true,
      sealConfig,
      sealMetrics: [{ tokensUsed: 300, latencyMs: 100 }],
      outputPath,
    });

    const raw = await readFile(outputPath, "utf8");
    const doc = JSON.parse(raw);

    // Must include a seal object
    expect(doc).toHaveProperty("seal");
    expect(doc.seal).toBeTruthy();

    // Must include verificationInstructions
    expect(doc).toHaveProperty("verificationInstructions");
    expect(Array.isArray(doc.verificationInstructions)).toBe(true);
    expect(doc.verificationInstructions.length).toBeGreaterThan(0);

    // Must also still include evidence chain
    expect(doc).toHaveProperty("evidence");

    await rm(storageRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("sealed export has a non-empty sealHash in the seal object", async () => {
    await logger.logModelDecision("gpt-4", "Decision for seal hash test");
    await logger.flush({ endSession: false });

    const sealConfig = { project: "dantecode", version: "1.0.0" };
    const outputPath = join(storageRoot, `${sessionId}-hash-check.json`);

    await engine.exportSession(sessionId, {
      format: "json",
      logger,
      seal: true,
      sealConfig,
      outputPath,
    });

    const raw = await readFile(outputPath, "utf8");
    const doc = JSON.parse(raw);

    expect(doc.seal).toHaveProperty("sealHash");
    // sealHash must be a 64-char hex string (sha256 output)
    expect(doc.seal.sealHash).toMatch(/^[0-9a-f]{64}$/i);
    // sealId must follow DC-SEAL- prefix convention
    expect(doc.seal.sealId).toMatch(/^DC-SEAL-/);
    // timestamp field (not sealedAt) must be present
    expect(doc.seal).toHaveProperty("timestamp");
    expect(doc.seal.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await rm(storageRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("exportSession without logger (legacy) does NOT include evidence section", async () => {
    // Log some events without referencing the evidence-chain logger
    await logger.logToolCall("legacyTool", { legacy: true });
    await logger.flush({ endSession: false });

    const outputPath = join(storageRoot, `${sessionId}-legacy.json`);

    // Export without passing logger → legacy path, no evidence embedding
    await engine.exportSession(sessionId, {
      format: "json",
      outputPath,
    });

    const raw = await readFile(outputPath, "utf8");
    const doc = JSON.parse(raw);

    // Evidence section must be absent when no logger is provided
    expect(doc).not.toHaveProperty("evidence");
    // seal must also be absent
    expect(doc).not.toHaveProperty("seal");

    // But core export fields must still be present
    expect(doc).toHaveProperty("sessionId");
    expect(doc).toHaveProperty("events");
    expect(doc).toHaveProperty("eventCount");

    await rm(storageRoot, { recursive: true, force: true }).catch(() => {});
  });
});
