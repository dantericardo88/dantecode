import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeRunReport, reportFileName } from "./run-report-writer.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

describe("reportFileName", () => {
  it("replaces colons with dashes", () => {
    expect(reportFileName("2026-03-22T14:30:00Z")).toBe("run-2026-03-22T14-30-00Z.md");
  });

  it("strips milliseconds before Z", () => {
    expect(reportFileName("2026-03-22T14:30:00.123Z")).toBe("run-2026-03-22T14-30-00Z.md");
  });

  it("handles already-safe timestamps", () => {
    expect(reportFileName("2026-03-22T14-30-00Z")).toBe("run-2026-03-22T14-30-00Z.md");
  });
});

describe("writeRunReport", () => {
  const mockMkdir = vi.mocked(fs.mkdir);
  const mockWriteFile = vi.mocked(fs.writeFile);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates the reports directory and writes the file", async () => {
    const resultPath = await writeRunReport({
      projectRoot: "/test/project",
      markdown: "# Report",
      timestamp: "2026-03-22T14:30:00Z",
    });

    expect(mockMkdir).toHaveBeenCalledWith(
      path.join("/test/project", ".dantecode", "reports"),
      { recursive: true },
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      path.join("/test/project", ".dantecode", "reports", "run-2026-03-22T14-30-00Z.md"),
      "# Report",
      "utf-8",
    );
    expect(resultPath).toBe(
      path.join("/test/project", ".dantecode", "reports", "run-2026-03-22T14-30-00Z.md"),
    );
  });

  it("calls commitFn when autoCommit is true", async () => {
    const commitFn = vi.fn();
    const markdown = "| Status | Count |\n✅ COMPLETE\n| **Total** | **5** |";

    await writeRunReport({
      projectRoot: "/test/project",
      markdown,
      timestamp: "2026-03-22T14:30:00Z",
      autoCommit: true,
      commitFn,
    });

    expect(commitFn).toHaveBeenCalledTimes(1);
    expect(commitFn).toHaveBeenCalledWith(
      [path.join("/test/project", ".dantecode", "reports", "run-2026-03-22T14-30-00Z.md")],
      expect.stringContaining("dantecode: run report"),
      "/test/project",
    );
  });

  it("does not call commitFn when autoCommit is false", async () => {
    const commitFn = vi.fn();

    await writeRunReport({
      projectRoot: "/test/project",
      markdown: "# Report",
      timestamp: "2026-03-22T14:30:00Z",
      autoCommit: false,
      commitFn,
    });

    expect(commitFn).not.toHaveBeenCalled();
  });

  it("does not call commitFn when commitFn is not provided", async () => {
    await writeRunReport({
      projectRoot: "/test/project",
      markdown: "# Report",
      timestamp: "2026-03-22T14:30:00Z",
      autoCommit: true,
    });

    // Should not throw
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("swallows write errors gracefully", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("ENOSPC"));

    const resultPath = await writeRunReport({
      projectRoot: "/test/project",
      markdown: "# Report",
      timestamp: "2026-03-22T14:30:00Z",
    });

    // Should not throw, still returns the intended path
    expect(resultPath).toBe(
      path.join("/test/project", ".dantecode", "reports", "run-2026-03-22T14-30-00Z.md"),
    );
  });

  it("swallows mkdir errors gracefully", async () => {
    mockMkdir.mockRejectedValueOnce(new Error("EACCES"));

    const resultPath = await writeRunReport({
      projectRoot: "/test/project",
      markdown: "# Report",
      timestamp: "2026-03-22T14:30:00Z",
    });

    expect(resultPath).toBe(
      path.join("/test/project", ".dantecode", "reports", "run-2026-03-22T14-30-00Z.md"),
    );
  });
});
