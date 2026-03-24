// ============================================================================
// @dantecode/core — Completion Verifier
// Filesystem-only task completion verification — no LLM, no hallucination.
// ============================================================================

import { stat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RunReportEntry } from "./run-report.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CompletionVerdict = "complete" | "partial" | "failed";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface CompletionExpectation {
  expectedFiles?: string[];
  expectedPatterns?: Array<{ file: string; pattern: string }>;
  expectedTests?: string[];
  intentDescription?: string;
}

export interface CompletionCheckResult {
  file: string;
  exists: boolean;
  hasContent: boolean;
  lines?: number;
}

export interface PatternCheckResult {
  file: string;
  pattern: string;
  found: boolean;
}

export interface CompletionVerification {
  verdict: CompletionVerdict;
  confidence: ConfidenceLevel;
  passed: string[];
  failed: string[];
  uncertain: string[];
  fileChecks: CompletionCheckResult[];
  patternChecks: PatternCheckResult[];
  summary: string;
}

// ─── Internal Helpers ───────────────────────────────────────────────────────

async function checkFile(root: string, filePath: string): Promise<CompletionCheckResult> {
  try {
    const info = await stat(resolve(root, filePath));
    if (!info.isFile()) return { file: filePath, exists: false, hasContent: false };
    const content = await readFile(resolve(root, filePath), "utf-8");
    return { file: filePath, exists: true, hasContent: content.trim().length > 0, lines: content.split("\n").length };
  } catch {
    return { file: filePath, exists: false, hasContent: false };
  }
}

async function checkPattern(root: string, file: string, pattern: string): Promise<PatternCheckResult> {
  try {
    const content = await readFile(resolve(root, file), "utf-8");
    return { file, pattern, found: new RegExp(pattern).test(content) };
  } catch {
    return { file, pattern, found: false };
  }
}

function computeConfidence(total: number, passCount: number): ConfidenceLevel {
  if (total < 2) return "low";
  const ratio = passCount / total;
  if (ratio > 0.8) return "high";
  if (ratio >= 0.5) return "medium";
  return "low";
}

function computeVerdict(total: number, passCount: number, failCount: number): CompletionVerdict {
  if (total === 0) return "failed";
  if (failCount === 0) return "complete";
  if (passCount > 0) return "partial";
  return "failed";
}

function buildSummary(passed: string[], failed: string[], confidence: ConfidenceLevel): string {
  const total = passed.length + failed.length;
  if (total === 0) return "Low confidence — insufficient evidence to verify completion.";
  const parts: string[] = [`${passed.length}/${total} checks passed.`];
  if (failed.length > 0) {
    const items = failed.map((f) => { const m = f.match(/:\s*(.+)$/); return m ? m[1]! : f; });
    parts.push(`${failed.length} failed: ${items.join(", ")}.`);
  }
  parts.push(`Confidence: ${confidence}.`);
  return parts.join(" ");
}

// ─── Main Verification ──────────────────────────────────────────────────────

export async function verifyCompletion(
  projectRoot: string,
  expectations: CompletionExpectation,
): Promise<CompletionVerification> {
  const passed: string[] = [];
  const failed: string[] = [];
  const uncertain: string[] = [];
  const fileChecks: CompletionCheckResult[] = [];
  const patternChecks: PatternCheckResult[] = [];

  const hasConcrete =
    (expectations.expectedFiles?.length ?? 0) > 0 ||
    (expectations.expectedPatterns?.length ?? 0) > 0 ||
    (expectations.expectedTests?.length ?? 0) > 0;

  if (!hasConcrete) {
    if (expectations.intentDescription) uncertain.push(expectations.intentDescription);
    return {
      verdict: "failed", confidence: "low", passed, failed, uncertain,
      fileChecks, patternChecks,
      summary: "Low confidence — insufficient evidence to verify completion.",
    };
  }

  // Check expected files
  if (expectations.expectedFiles) {
    for (const fp of expectations.expectedFiles) {
      const r = await checkFile(projectRoot, fp);
      fileChecks.push(r);
      if (r.exists && r.hasContent) passed.push(`File exists: ${fp}`);
      else if (r.exists) failed.push(`File empty: ${fp}`);
      else failed.push(`File missing: ${fp}`);
    }
  }

  // Check expected patterns
  if (expectations.expectedPatterns) {
    for (const { file, pattern } of expectations.expectedPatterns) {
      const r = await checkPattern(projectRoot, file, pattern);
      patternChecks.push(r);
      if (r.found) passed.push(`Pattern found in ${file}: ${pattern}`);
      else failed.push(`Pattern not found in ${file}: ${pattern}`);
    }
  }

  // Check expected test files
  if (expectations.expectedTests) {
    for (const tf of expectations.expectedTests) {
      const r = await checkFile(projectRoot, tf);
      fileChecks.push(r);
      if (r.exists && r.hasContent) passed.push(`Test file exists: ${tf}`);
      else failed.push(`Test file missing: ${tf}`);
    }
  }

  if (expectations.intentDescription) uncertain.push(expectations.intentDescription);

  const total = passed.length + failed.length;
  const verdict = computeVerdict(total, passed.length, failed.length);
  const confidence = computeConfidence(total, passed.length);

  return { verdict, confidence, passed, failed, uncertain, fileChecks, patternChecks,
    summary: buildSummary(passed, failed, confidence) };
}

// ─── Derive Expectations ────────────────────────────────────────────────────

export function deriveExpectations(entry: RunReportEntry): CompletionExpectation {
  const expectedFiles: string[] = [];
  for (const c of entry.filesCreated) expectedFiles.push(c.path);
  for (const m of entry.filesModified) expectedFiles.push(m.path);
  return {
    expectedFiles: expectedFiles.length > 0 ? expectedFiles : undefined,
    intentDescription: entry.summary || undefined,
  };
}

// ─── Summarize Verification ─────────────────────────────────────────────────

export function summarizeVerification(verification: CompletionVerification): string {
  if (verification.confidence === "low" && verification.passed.length === 0) {
    return "Low confidence — insufficient evidence to verify completion.";
  }
  const parts: string[] = [];

  const filesPassed = verification.fileChecks.filter((f) => f.exists && f.hasContent).length;
  const totalFiles = verification.fileChecks.length;
  if (totalFiles > 0) parts.push(`${filesPassed}/${totalFiles} expected files found.`);

  const missing = verification.fileChecks.filter((f) => !f.exists).map((f) => f.file);
  if (missing.length > 0) {
    parts.push(`${missing.length} file${missing.length > 1 ? "s" : ""} missing: ${missing.join(", ")}.`);
  }

  const patsPassed = verification.patternChecks.filter((p) => p.found).length;
  const totalPats = verification.patternChecks.length;
  if (totalPats > 0) parts.push(`${patsPassed}/${totalPats} pattern checks passed.`);

  parts.push(`Confidence: ${verification.confidence}.`);
  if (verification.confidence === "low") {
    parts.push("Low confidence — insufficient evidence to verify completion.");
  }
  return parts.join(" ");
}
