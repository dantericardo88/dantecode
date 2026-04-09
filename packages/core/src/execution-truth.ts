import type { CompletionFailureReason, CompletionGateResult, ExecutionLedger, ToolExecutionRecord } from "./execution-integrity.js";

export interface ExecutionTruthPayload {
  mode: ExecutionLedger["mode"];
  provider: string;
  model: string;
  changedFiles: string[];
  mutationCount: number;
  validationCount: number;
  gateStatus: "passed" | "failed";
  reasonCode?: CompletionFailureReason;
  lastVerifiedAt: string;
  // M8: Extended fields for full reconstruction
  roundCount: number;
  totalToolCalls: number;
  requestType: string;
  promptPreview: string; // first 500 chars of the user prompt
  sessionId: string;
  timestamp: string;
}

export const EXECUTION_TRUTH_RELATIVE_PATH = ".dantecode/execution-truth/latest.json";
export const EXECUTION_TRUTH_DIR = ".dantecode/execution-integrity";

/**
 * Summarize a tool call for persistence — strip large args to keep payload small.
 */
function summarizeToolCall(tc: ToolExecutionRecord): Record<string, unknown> {
  const argsSummary: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(tc.arguments)) {
    if (typeof val === "string" && val.length > 200) {
      argsSummary[key] = val.slice(0, 200) + "...";
    } else {
      argsSummary[key] = val;
    }
  }
  return {
    toolName: tc.toolName,
    toolClass: tc.toolClass,
    calledAt: tc.calledAt,
    arguments: argsSummary,
    success: tc.result.success,
    error: tc.result.error,
    executionDuration: tc.executionDuration,
  };
}

/**
 * Persist the full execution evidence bundle for a session.
 * Writes 6 files — enough to reconstruct what the agent did, claimed, and proved.
 */
export async function persistExecutionEvidenceBundle(
  projectRoot: string,
  ledger: ExecutionLedger,
  payload: ExecutionTruthPayload,
  options?: {
    gateResult?: CompletionGateResult;
    fileState?: Map<string, { contentHash: string | "mtime_only"; mtime: number; readInSession: boolean }>;
  },
): Promise<void> {
  const { join } = await import("node:path");
  const { mkdir, writeFile } = await import("node:fs/promises");

  // Session-scoped directory
  const targetDir = join(projectRoot, EXECUTION_TRUTH_DIR, payload.sessionId || "default");
  await mkdir(targetDir, { recursive: true });

  // Also write to the legacy flat path for backward compat
  const legacyDir = join(projectRoot, EXECUTION_TRUTH_DIR);
  await mkdir(legacyDir, { recursive: true });

  // 1. summary.json — session metadata + gate status
  const summaryJson = JSON.stringify(payload, null, 2);
  await writeFile(join(targetDir, "summary.json"), summaryJson, "utf-8");
  await writeFile(join(legacyDir, "summary.json"), summaryJson, "utf-8");

  // 2. mutations.json — MutationRecord[] with before/after hashes
  await writeFile(
    join(targetDir, "mutations.json"),
    JSON.stringify(ledger.mutations, null, 2),
    "utf-8",
  );

  // 3. validations.json — ValidationRecord[] (NEW in M8)
  await writeFile(
    join(targetDir, "validations.json"),
    JSON.stringify(ledger.validations, null, 2),
    "utf-8",
  );

  // 4. tool-calls.json — summarized ToolExecutionRecord[] (NEW in M8)
  await writeFile(
    join(targetDir, "tool-calls.json"),
    JSON.stringify(ledger.toolCalls.map(summarizeToolCall), null, 2),
    "utf-8",
  );

  // 5. gate-results.json — full CompletionGateResult or ledger completion status
  const gateData = options?.gateResult ?? ledger.completionStatus;
  await writeFile(
    join(targetDir, "gate-results.json"),
    JSON.stringify(gateData, null, 2),
    "utf-8",
  );

  // 6. read-files.json — files read during session with timestamps + content hashes (NEW in M8)
  const readFilesData: Record<string, unknown>[] = [];
  if (options?.fileState) {
    for (const [filePath, state] of options.fileState.entries()) {
      if (state.readInSession) {
        readFilesData.push({
          filePath,
          contentHash: state.contentHash,
          mtime: state.mtime,
        });
      }
    }
  } else {
    // Fallback: just list the read files from the ledger
    for (const filePath of ledger.readFiles) {
      readFilesData.push({ filePath });
    }
  }
  await writeFile(
    join(targetDir, "read-files.json"),
    JSON.stringify(readFilesData, null, 2),
    "utf-8",
  );
}
