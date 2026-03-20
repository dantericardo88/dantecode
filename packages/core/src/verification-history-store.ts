import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

const VERIFICATION_HISTORY_RELATIVE_PATH = ".danteforge/reports/verification-history.jsonl";

export type VerificationHistoryKind =
  | "verify_output"
  | "qa_suite"
  | "critic_debate"
  | "verification_rail";

export type VerificationHistorySource = "cli" | "mcp" | "agent";

export interface VerificationHistoryEntry {
  id: string;
  kind: VerificationHistoryKind;
  source: VerificationHistorySource;
  recordedAt: string;
  label: string;
  summary: string;
  sessionId?: string;
  passed?: boolean;
  pdseScore?: number;
  averageConfidence?: number;
  payload: Record<string, unknown>;
}

export interface VerificationHistoryFilter {
  kind?: VerificationHistoryKind;
  sessionId?: string;
  limit?: number;
}

export type VerificationHistoryEntryInput = Omit<VerificationHistoryEntry, "id" | "recordedAt"> & {
  recordedAt?: string;
};

export class VerificationHistoryStore {
  constructor(private readonly projectRoot: string) {}

  async append(input: VerificationHistoryEntryInput): Promise<VerificationHistoryEntry> {
    const entry: VerificationHistoryEntry = {
      id: randomUUID(),
      recordedAt: input.recordedAt ?? new Date().toISOString(),
      ...input,
    };

    const historyPath = this.getHistoryPath();
    await mkdir(dirname(historyPath), { recursive: true });
    await appendFile(historyPath, `${JSON.stringify(entry)}\n`, "utf-8");
    return entry;
  }

  async list(filter: VerificationHistoryFilter = {}): Promise<VerificationHistoryEntry[]> {
    const entries = await this.readEntries();
    let filtered = entries;

    if (filter.kind) {
      filtered = filtered.filter((entry) => entry.kind === filter.kind);
    }

    if (filter.sessionId) {
      filtered = filtered.filter((entry) => entry.sessionId === filter.sessionId);
    }

    filtered.sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());

    if (typeof filter.limit === "number" && filter.limit > 0) {
      return filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  private async readEntries(): Promise<VerificationHistoryEntry[]> {
    try {
      const raw = await readFile(this.getHistoryPath(), "utf-8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as VerificationHistoryEntry];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  private getHistoryPath(): string {
    return join(this.projectRoot, VERIFICATION_HISTORY_RELATIVE_PATH);
  }
}
