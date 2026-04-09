// ============================================================================
// @dantecode/cli — pdse-report command tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { pdseReportCommand } from "./pdse-report.js";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { readFile, readdir, stat } from "node:fs/promises";

const mockReadFile = vi.mocked(readFile);
const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);

function makeSessionFile(
  id: string,
  pdseScore: number | null,
  taskDescription: string,
  durationMs?: number,
  cost?: number,
) {
  return JSON.stringify({
    id,
    pdseScore,
    title: taskDescription,
    durationMs: durationMs ?? null,
    totalCostUsd: cost ?? null,
    updatedAt: "2026-04-03T12:00:00.000Z",
  });
}

describe("pdseReportCommand", () => {
  let stdoutOutput: string;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutOutput = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdoutOutput += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    });
  });

  it("prints a message when no sessions directory exists", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    await pdseReportCommand([], "/project");
    expect(stdoutOutput).toContain("No session history found");
  });

  it("reads session files and renders PDSE scores", async () => {
    mockReaddir.mockResolvedValue(["sess-abc.json"] as never);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() } as never);
    mockReadFile.mockResolvedValue(
      makeSessionFile("sess-abc", 92, "Fix auth bug", 3500, 0.0045) as never,
    );
    await pdseReportCommand([], "/project");
    expect(stdoutOutput).toContain("PDSE Session Report");
    expect(stdoutOutput).toContain("sess-abc");
    expect(stdoutOutput).toContain("92");
  });

  it("renders session with correct duration and cost format", async () => {
    mockReaddir.mockResolvedValue(["sess-dur.json"] as never);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() } as never);
    mockReadFile.mockResolvedValue(
      makeSessionFile("sess-dur", 78, "Refactor API", 75_000, 0.0123) as never,
    );
    await pdseReportCommand([], "/project");
    // 75000ms = 1m 15s
    expect(stdoutOutput).toMatch(/1m\s+15s/);
    expect(stdoutOutput).toContain("$0.0123");
  });

  it("exports CSV with correct columns when --export csv is passed", async () => {
    mockReaddir.mockResolvedValue(["sess-x.json"] as never);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() } as never);
    mockReadFile.mockResolvedValue(
      makeSessionFile("sess-x", 88, "CSV test task", 1000, 0.001) as never,
    );
    await pdseReportCommand(["--export", "csv"], "/project");
    const lines = stdoutOutput.split("\n").filter((l) => l.trim());
    expect(lines[0]).toBe("id,pdseScore,taskDescription,durationMs,cost,updatedAt");
    expect(lines[1]).toContain("sess-x");
    expect(lines[1]).toContain("88.0");
    expect(lines[1]).toContain("CSV test task");
  });

  it("shows average PDSE and passing count in summary", async () => {
    mockReaddir.mockResolvedValue([
      "s1.json",
      "s2.json",
    ] as never);
    mockStat.mockResolvedValue({ mtimeMs: Date.now() } as never);
    mockReadFile
      .mockResolvedValueOnce(makeSessionFile("s1", 90, "task A") as never)
      .mockResolvedValueOnce(makeSessionFile("s2", 70, "task B") as never);
    await pdseReportCommand([], "/project");
    // avg = 80, 1/2 passing (≥85)
    expect(stdoutOutput).toContain("80.0");
    // ANSI codes split "1" and "/2" — check the stable suffix instead
    expect(stdoutOutput).toContain("passing (≥85)");
  });
});
