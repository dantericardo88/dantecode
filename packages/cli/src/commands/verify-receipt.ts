// ============================================================================
// @dantecode/cli — /verify-receipt command
// Reads a .dantecode/evidence/<receipt-id>.json and verifies the bundle hash.
// ============================================================================

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { verifyBundle } from "@dantecode/evidence-chain";
import type { EvidenceBundleData } from "@dantecode/evidence-chain";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  } catch {
    return iso;
  }
}

async function loadBundle(
  projectRoot: string,
  receiptId: string,
): Promise<EvidenceBundleData | null> {
  // Try exact path first
  const evidenceDir = join(projectRoot, ".dantecode", "evidence");

  // Direct lookup by id
  const directPath = join(evidenceDir, `${receiptId}.json`);
  try {
    const raw = await readFile(directPath, "utf-8");
    return JSON.parse(raw) as EvidenceBundleData;
  } catch {
    // Not found at direct path — try scanning the directory
  }

  // Scan directory for a file whose bundleId matches or whose name starts with receiptId
  try {
    const files = await readdir(evidenceDir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(evidenceDir, file), "utf-8");
        const data = JSON.parse(raw) as EvidenceBundleData;
        if (data.bundleId === receiptId || file.startsWith(receiptId)) {
          return data;
        }
      } catch {
        // skip invalid files
      }
    }
  } catch {
    // directory doesn't exist
  }

  return null;
}

export async function verifyReceiptCommand(
  args: string[],
  projectRoot: string,
): Promise<void> {
  const receiptId = args[0]?.trim();

  if (!receiptId) {
    process.stdout.write(
      `${RED}Usage: /verify-receipt <receipt-id>${RESET}\n` +
        `${DIM}Example: /verify-receipt ev_abc123def456${RESET}\n`,
    );
    return;
  }

  const bundle = await loadBundle(projectRoot, receiptId);

  if (!bundle) {
    process.stdout.write(
      `${RED}Receipt not found: ${receiptId}${RESET}\n` +
        `${DIM}Evidence files are stored in .dantecode/evidence/<id>.json${RESET}\n`,
    );
    return;
  }

  const valid = verifyBundle(bundle);

  if (valid) {
    const taskDescription =
      typeof bundle.evidence["taskDescription"] === "string"
        ? bundle.evidence["taskDescription"]
        : typeof bundle.evidence["task"] === "string"
          ? bundle.evidence["task"]
          : "(not specified)";

    const sessionId =
      typeof bundle.evidence["sessionId"] === "string"
        ? bundle.evidence["sessionId"]
        : bundle.runId;

    const evidenceFields = Object.keys(bundle.evidence).length;

    process.stdout.write(
      `${GREEN}${BOLD}✓ Receipt ${bundle.bundleId} valid${RESET}\n` +
        `  ${DIM}Task:     ${RESET} ${CYAN}"${taskDescription}"${RESET}\n` +
        `  ${DIM}Session:  ${RESET} ${sessionId}\n` +
        `  ${DIM}Completed:${RESET} ${formatTimestamp(bundle.timestamp)}\n` +
        `  ${DIM}Evidence: ${RESET} ${evidenceFields} field${evidenceFields !== 1 ? "s" : ""} — hash verified\n` +
        `  ${DIM}Merkle:   ${RESET} root=${bundle.hash.slice(0, 16)}...\n`,
    );
  } else {
    // Recompute to show expected vs actual
    const { hashDict } = await import("@dantecode/evidence-chain");
    const recomputed = hashDict(bundle.evidence);

    process.stdout.write(
      `${RED}${BOLD}✗ Receipt verification FAILED${RESET}\n` +
        `  Hash mismatch detected\n` +
        `  ${DIM}Expected:${RESET} ${recomputed.slice(0, 16)}...\n` +
        `  ${DIM}Got:     ${RESET} ${bundle.hash.slice(0, 16)}...\n`,
    );
  }
}
