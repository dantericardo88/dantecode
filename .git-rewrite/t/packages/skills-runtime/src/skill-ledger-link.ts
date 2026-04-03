import type { SkillReceipt } from "./skill-receipt.js";

export interface LedgerLink {
  receiptId: string;
  runId: string;
  chainRef?: string; // Reference to evidence chain hash or path
  linkedAt: string;
}

/**
 * Link a skill receipt to an evidence chain entry.
 * The chain integration is optional — if no chain is provided, returns a standalone link.
 */
export function linkToEvidenceChain(receipt: SkillReceipt, chainRef?: string): LedgerLink {
  return {
    receiptId: receipt.receiptId,
    runId: receipt.runId,
    chainRef,
    linkedAt: new Date().toISOString(),
  };
}
