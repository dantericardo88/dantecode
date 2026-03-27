import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SkillPolicy } from "./skill-run-context.js";
import type { SkillEvidenceHashes, SkillRunResult } from "./skill-run-result.js";
import type { FileReceipt } from "./run-skill.js";

export interface SkillReceipt {
  receiptVersion: number;
  receiptId: string;
  runId: string;
  skillName: string;
  sourceType: string;
  state: string;
  verificationOutcome: string;
  verificationSummary?: string;
  filesTouched: string[]; // Successful files only
  commandsRun: string[];
  issuedAt: string;
  failureReason?: string;
  receiptRef?: string;
  policySnapshot?: SkillPolicy;
  evidenceHashes: SkillEvidenceHashes;
  artifactRefs?: string[];
  ledgerRef?: string;
  fileReceipts?: FileReceipt[]; // Detailed file-by-file closure
}

export interface SkillReceiptOptions {
  policySnapshot?: SkillPolicy;
  verificationSummary?: string;
  receiptRef?: string;
  artifactRefs?: string[];
  ledgerRef?: string;
  fileReceipts?: FileReceipt[];
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildEvidenceHashes(
  result: SkillRunResult,
  verificationSummary?: string,
): SkillEvidenceHashes {
  return {
    commands: result.commandsRun.map((command) => hashValue(command)),
    files: result.filesTouched.map((filePath) => hashValue(filePath)),
    verification: verificationSummary ? hashValue(verificationSummary) : undefined,
  };
}

/**
 * Emit a tamper-evident receipt for a skill run.
 * Throws SKILL-007 if result is in an unfinished state (no runId).
 */
export function emitSkillReceipt(
  result: SkillRunResult,
  options: SkillReceiptOptions = {},
): SkillReceipt {
  if (!result.runId) {
    throw new Error("SKILL-007: cannot emit receipt â€” runId missing");
  }

  const verificationSummary = options.verificationSummary ?? result.verificationSummary;
  const receiptId = `rcpt_${result.runId}_${Date.now().toString(16)}`;

  return {
    receiptVersion: 2,
    receiptId,
    runId: result.runId,
    skillName: result.skillName,
    sourceType: result.sourceType,
    state: result.state,
    verificationOutcome: result.verificationOutcome,
    verificationSummary,
    filesTouched: [...result.filesTouched],
    commandsRun: [...result.commandsRun],
    issuedAt: new Date().toISOString(),
    failureReason: result.failureReason,
    receiptRef: options.receiptRef ?? result.receiptRef,
    policySnapshot: options.policySnapshot ?? result.policySnapshot,
    evidenceHashes: result.evidenceHashes ?? buildEvidenceHashes(result, verificationSummary),
    artifactRefs: options.artifactRefs ?? result.artifactRefs,
    ledgerRef: options.ledgerRef ?? result.ledgerRef,
    fileReceipts: options.fileReceipts,
  };
}

export async function persistSkillReceipt(
  result: SkillRunResult,
  projectRoot: string,
  options: SkillReceiptOptions = {},
): Promise<SkillReceipt> {
  const receiptDir = join(projectRoot, ".dantecode", "receipts", "skills");
  const receiptRef =
    options.receiptRef ?? result.receiptRef ?? join(receiptDir, `${result.runId}.json`);

  await mkdir(dirname(receiptRef), { recursive: true });

  const receipt = emitSkillReceipt(
    {
      ...result,
      receiptRef,
      verificationSummary: options.verificationSummary ?? result.verificationSummary,
      policySnapshot: options.policySnapshot ?? result.policySnapshot,
      artifactRefs: options.artifactRefs ?? result.artifactRefs,
      ledgerRef: options.ledgerRef ?? result.ledgerRef,
    },
    {
      ...options,
      receiptRef,
    },
  );

  await writeFile(receiptRef, `${JSON.stringify(receipt, null, 2)}\n`, "utf-8");
  return receipt;
}
