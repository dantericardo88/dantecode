// ============================================================================
// @dantecode/cli — cost-history command tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { costHistoryCommand } from "./cost-history.js";
import type { CostHistoryEntry } from "./cost-history.js";

// Mock fs modules
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const mockReadFile = vi.mocked(readFile);
const mockExistsSync = vi.mocked(existsSync);

const SAMPLE_ENTRIES: CostHistoryEntry[] = [
  {
    date: "2026-04-01",
    sessionId: "sess-aaa111",
    inputTokens: 1200,
    outputTokens: 400,
    cost: 0.0096,
    model: "claude-sonnet-4-6",
    tier: "medium",
    taskSummary: "Refactor auth module",
  },
  {
    date: "2026-04-02",
    sessionId: "sess-bbb222",
    inputTokens: 300,
    outputTokens: 100,
    cost: 0.00215,
    model: "claude-haiku-4-5-20251001",
    tier: "low",
    taskSummary: "Write unit tests",
  },
  {
    date: "2026-04-03",
    sessionId: "sess-ccc333",
    inputTokens: 5000,
    outputTokens: 2000,
    cost: 0.045,
    model: "claude-sonnet-4-6",
    tier: "high",
    taskSummary: "Full stack feature",
  },
];

function toJsonl(entries: CostHistoryEntry[]): string {
  return entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("costHistoryCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns summary stats when no JSONL entries exist", async () => {
    mockExistsSync.mockReturnValue(false);
    const result = await costHistoryCommand("", "/project");
    expect(result).toContain("No cost history recorded");
  });

  it("reads JSONL and computes summary stats", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(toJsonl(SAMPLE_ENTRIES) as never);
    const result = await costHistoryCommand("", "/project");
    expect(result).toContain("Sessions:");
    expect(result).toContain("Total:");
    expect(result).toContain("Avg:");
    // 3 sessions with non-zero cost
    expect(result).toContain("3");
  });

  it("formats table when --last N is provided", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(toJsonl(SAMPLE_ENTRIES) as never);
    const result = await costHistoryCommand("--last 2", "/project");
    // Table header cols should appear
    expect(result).toContain("Date");
    expect(result).toContain("Session");
    expect(result).toContain("Cost");
    // Should also include the summary
    expect(result).toContain("Sessions:");
  });

  it("exports CSV with correct header when --export csv is passed", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(toJsonl(SAMPLE_ENTRIES) as never);
    const result = await costHistoryCommand("--export csv", "/project");
    // CSV header
    expect(result.split("\n")[0]).toBe(
      "date,sessionId,inputTokens,outputTokens,cost,model,tier,taskSummary",
    );
    // One data row per entry
    const dataLines = result
      .split("\n")
      .slice(1)
      .filter((l) => l.trim().length > 0);
    expect(dataLines).toHaveLength(3);
    expect(dataLines[0]).toContain("2026-04-01");
    expect(dataLines[0]).toContain("sess-aaa111");
  });

  it("counts Haiku/low-tier sessions in summary percentage", async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue(toJsonl(SAMPLE_ENTRIES) as never);
    const result = await costHistoryCommand("", "/project");
    // 1 of 3 sessions is haiku/low tier → 33%
    expect(result).toContain("1/3");
  });
});
