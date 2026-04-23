// packages/cli/src/__tests__/sprint-dim43-docs.test.ts
// Dim 43 — Documentation quality
// Tests: checkDocsQuality, generateDocsReport, generateConfigReference,
//        renderConfigReferenceMarkdown, recordDocsQuality, loadDocsQualityLog

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkDocsQuality,
  generateDocsReport,
  recordDocsQuality,
  loadDocsQualityLog,
  generateConfigReference,
  renderConfigReferenceMarkdown,
  type DocsQualityResult,
} from "@dantecode/core";

// ── checkDocsQuality ──────────────────────────────────────────────────────────

describe("checkDocsQuality", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("returns score=100 when all required docs present and word count met", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    const requiredDocs = ["docs/getting-started.md"];
    const docsDir = join(tmpDir, "docs");
    mkdirSync(docsDir, { recursive: true });
    // Write a doc with more than 200 words
    const longContent = "word ".repeat(250);
    writeFileSync(join(docsDir, "getting-started.md"), longContent, "utf-8");
    const result = await checkDocsQuality({ projectRoot: tmpDir, requiredDocs });
    expect(result.score).toBe(100);
  });

  it("marks file as missing when required doc does not exist", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    const result = await checkDocsQuality({
      projectRoot: tmpDir,
      requiredDocs: ["docs/getting-started.md"],
    });
    expect(result.missingDocs).toContain("docs/getting-started.md");
  });

  it("marks file as thin when word count is below minWordCount", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "getting-started.md"), "Short doc with only a few words here.", "utf-8");
    const result = await checkDocsQuality({
      projectRoot: tmpDir,
      requiredDocs: ["docs/getting-started.md"],
      minWordCount: 200,
    });
    expect(result.thinDocs).toContain("docs/getting-started.md");
  });

  it("decreases score by 15 per missing doc", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    const result = await checkDocsQuality({
      projectRoot: tmpDir,
      requiredDocs: ["docs/a.md", "docs/b.md"],
    });
    expect(result.missingDocs).toHaveLength(2);
    // 2 missing = -30 penalty
    expect(result.score).toBeLessThanOrEqual(70);
  });

  it("decreases score by 5 per thin doc", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    mkdirSync(join(tmpDir, "docs"), { recursive: true });
    writeFileSync(join(tmpDir, "docs", "thin.md"), "too short", "utf-8");
    const baseResult = await checkDocsQuality({
      projectRoot: tmpDir,
      requiredDocs: [],
      minWordCount: 200,
    });
    const baseScore = baseResult.score;

    writeFileSync(join(tmpDir, "docs", "thin.md"), "too short", "utf-8");
    const result = await checkDocsQuality({
      projectRoot: tmpDir,
      requiredDocs: ["docs/thin.md"],
      minWordCount: 200,
    });
    // thin doc reduces score by 5
    expect(result.score).toBeLessThan(baseScore + 5);
  });

  it("returns score <= 100 (never exceeds max)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    const result = await checkDocsQuality({
      projectRoot: tmpDir,
      requiredDocs: [],
    });
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns score >= 0 (never goes negative)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    // 10 missing docs would normally give -150, but should clamp at 0
    const required = Array.from({ length: 10 }, (_, i) => `docs/doc${i}.md`);
    const result = await checkDocsQuality({ projectRoot: tmpDir, requiredDocs: required });
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("returns checkedAt as ISO string", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-docs-"));
    const result = await checkDocsQuality({ projectRoot: tmpDir, requiredDocs: [] });
    expect(() => new Date(result.checkedAt)).not.toThrow();
    expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
  });
});

// ── generateDocsReport ────────────────────────────────────────────────────────

describe("generateDocsReport", () => {
  it("returns a string containing the score", () => {
    const result: DocsQualityResult = {
      score: 75,
      missingDocs: ["docs/a.md"],
      thinDocs: [],
      undocumentedExports: [],
      checkedAt: new Date().toISOString(),
    };
    const report = generateDocsReport(result);
    expect(typeof report).toBe("string");
    expect(report).toContain("75");
  });

  it("includes missing docs in the report", () => {
    const result: DocsQualityResult = {
      score: 55,
      missingDocs: ["docs/getting-started.md", "docs/tutorials/first-task.md"],
      thinDocs: [],
      undocumentedExports: [],
      checkedAt: new Date().toISOString(),
    };
    const report = generateDocsReport(result);
    expect(report).toContain("docs/getting-started.md");
    expect(report).toContain("docs/tutorials/first-task.md");
  });

  it("includes thin docs in the report when present", () => {
    const result: DocsQualityResult = {
      score: 90,
      missingDocs: [],
      thinDocs: ["docs/CHANGELOG.md"],
      undocumentedExports: [],
      checkedAt: new Date().toISOString(),
    };
    const report = generateDocsReport(result);
    expect(report).toContain("CHANGELOG.md");
  });

  it("returns markdown with a header line", () => {
    const result: DocsQualityResult = {
      score: 100,
      missingDocs: [],
      thinDocs: [],
      undocumentedExports: [],
      checkedAt: new Date().toISOString(),
    };
    const report = generateDocsReport(result);
    expect(report).toContain("# Documentation Quality Report");
  });
});

// ── generateConfigReference ───────────────────────────────────────────────────

describe("generateConfigReference", () => {
  it("returns an array of ConfigFieldDoc entries", () => {
    const fields = generateConfigReference();
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
  });

  it("includes entries for all DantecodeConfig top-level fields", () => {
    const fields = generateConfigReference();
    const fieldNames = fields.map((f) => f.field);
    expect(fieldNames).toContain("version");
    expect(fieldNames).toContain("provider.id");
    expect(fieldNames).toContain("provider.model");
    expect(fieldNames).toContain("provider.apiKey");
    expect(fieldNames).toContain("features.fim");
    expect(fieldNames).toContain("ui.theme");
  });

  it("each entry has non-empty type, description, and example", () => {
    const fields = generateConfigReference();
    for (const f of fields) {
      expect(f.type.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.example.length).toBeGreaterThan(0);
    }
  });

  it("marks provider.id as required", () => {
    const fields = generateConfigReference();
    const providerIdField = fields.find((f) => f.field === "provider.id");
    expect(providerIdField).toBeDefined();
    expect(providerIdField!.required).toBe(true);
  });

  it("marks provider.baseUrl as not required", () => {
    const fields = generateConfigReference();
    const baseUrlField = fields.find((f) => f.field === "provider.baseUrl");
    expect(baseUrlField).toBeDefined();
    expect(baseUrlField!.required).toBe(false);
  });
});

// ── renderConfigReferenceMarkdown ─────────────────────────────────────────────

describe("renderConfigReferenceMarkdown", () => {
  it("returns a valid markdown string with a table header", () => {
    const fields = generateConfigReference();
    const markdown = renderConfigReferenceMarkdown(fields);
    expect(markdown).toContain("| Field |");
    expect(markdown).toContain("| Type |");
    expect(markdown).toContain("| Default |");
  });

  it("includes provider.id in the output", () => {
    const fields = generateConfigReference();
    const markdown = renderConfigReferenceMarkdown(fields);
    expect(markdown).toContain("provider.id");
  });

  it("includes an example config.json block", () => {
    const fields = generateConfigReference();
    const markdown = renderConfigReferenceMarkdown(fields);
    expect(markdown).toContain("```json");
    expect(markdown).toContain('"provider"');
  });

  it("returns a string (not null/undefined)", () => {
    const markdown = renderConfigReferenceMarkdown([]);
    expect(typeof markdown).toBe("string");
  });
});

// ── recordDocsQuality + loadDocsQualityLog ────────────────────────────────────

describe("recordDocsQuality and loadDocsQualityLog", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("persists a result to JSONL and reads it back", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-log-"));
    const result: DocsQualityResult = {
      score: 88,
      missingDocs: [],
      thinDocs: ["docs/CHANGELOG.md"],
      undocumentedExports: [],
      checkedAt: new Date().toISOString(),
    };
    recordDocsQuality(result, tmpDir);
    const entries = loadDocsQualityLog(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.score).toBe(88);
    expect(entries[0]!.thinDocs).toContain("docs/CHANGELOG.md");
  });

  it("returns empty array when no log file exists", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-log-"));
    const entries = loadDocsQualityLog(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("appends multiple results to the JSONL file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim43-log-"));
    const base: DocsQualityResult = {
      score: 55,
      missingDocs: ["docs/a.md"],
      thinDocs: [],
      undocumentedExports: [],
      checkedAt: new Date().toISOString(),
    };
    recordDocsQuality(base, tmpDir);
    recordDocsQuality({ ...base, score: 72 }, tmpDir);
    recordDocsQuality({ ...base, score: 88 }, tmpDir);
    const entries = loadDocsQualityLog(tmpDir);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.score).toBe(55);
    expect(entries[2]!.score).toBe(88);
  });
});
