import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAuditCommand } from "./audit.js";

// Mock @dantecode/debug-trail
vi.mock("@dantecode/debug-trail", () => ({
  ExportEngine: vi.fn().mockImplementation(() => ({
    exportSession: vi.fn().mockResolvedValue({
      path: "/tmp/output.json",
      eventCount: 42,
      completenessScore: 0.95,
    }),
  })),
}));

// Mock @dantecode/core logger
vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  };
});

describe("runAuditCommand", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    vi.clearAllMocks();
  });

  it("shows help when no subcommand provided", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAuditCommand([], "/project");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("dantecode audit"));
  });

  it("export subcommand succeeds with valid args", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAuditCommand(
      ["export", "json", "/tmp/out.json", "--session", "sess_abc"],
      "/project",
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Audit Export Complete"));
  });

  it("export subcommand exits when format is missing", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await runAuditCommand(["export"], "/project").catch(() => {});
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("export subcommand exits when invalid format is given", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    await runAuditCommand(
      ["export", "xml", "/tmp/out.xml", "--session", "sess_abc"],
      "/project",
    ).catch(() => {});
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
