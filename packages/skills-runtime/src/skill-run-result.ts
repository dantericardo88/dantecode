export type SkillRunState = "proposed" | "applied" | "verified" | "failed" | "partial";

export interface SkillRunResult {
  runId: string; // Unique identifier e.g. "sr_" + 8 random hex chars
  skillName: string;
  sourceType: string;
  mode: string;
  state: SkillRunState;
  filesTouched: string[]; // Absolute paths of files written/read
  commandsRun: string[]; // Commands executed (empty for instruction-only skills)
  verificationOutcome: "pass" | "fail" | "skipped" | "partial";
  plainLanguageSummary: string; // Human-readable, non-technical description
  failureReason?: string; // SKILL-XXX code + description if state === "failed"
  startedAt: string; // ISO timestamp
  completedAt: string; // ISO timestamp
  receiptRef?: string; // Path to receipt file or receipt hash
}

export function makeRunId(): string {
  // Generate a unique run ID: "sr_" + 8 random hex chars
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `sr_${hex}`;
}

// Guard: no success summary without applied state
export function assertAppliedBeforeSuccess(result: SkillRunResult): void {
  if (
    result.plainLanguageSummary.toLowerCase().includes("success") &&
    result.state !== "applied" &&
    result.state !== "verified"
  ) {
    throw new Error(
      `SKILL-010: cannot claim success — state is "${result.state}", not "applied" or "verified"`,
    );
  }
}
