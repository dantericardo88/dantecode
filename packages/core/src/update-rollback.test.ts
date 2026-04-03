import { describe, it, expect, vi } from "vitest";
import { UpdateRollback } from "./update-rollback.js";
import type { UpdateRollbackIO } from "./update-rollback.js";

const NOW = 1_700_000_000_000;

function makeIO(overrides: Partial<UpdateRollbackIO> = {}): UpdateRollbackIO {
  const files = new Map<string, string>();
  return {
    readFile: vi.fn((path: string) => files.get(path) ?? null),
    writeFile: vi.fn((path: string, content: string) => {
      files.set(path, content);
    }),
    exec: vi.fn(() => ({ exitCode: 0, stdout: "ok", stderr: "" })),
    ...overrides,
  };
}

describe("UpdateRollback", () => {
  it("snapshot captures config files and package versions", () => {
    const io = makeIO();
    (io.readFile as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === "/config/a.json") return '{"key":"val"}';
      if (path === "/config/b.yaml") return "key: val";
      return null;
    });

    const rollback = new UpdateRollback(io, { nowFn: () => NOW });
    const snap = rollback.snapshot(
      "1.2.3",
      ["/config/a.json", "/config/b.yaml", "/config/missing.txt"],
      { "@dantecode/core": "1.0.0", "@dantecode/cli": "2.0.0" },
    );

    expect(snap.version).toBe("1.2.3");
    expect(snap.configPaths).toEqual(["/config/a.json", "/config/b.yaml"]);
    expect(snap.configContents.get("/config/a.json")).toBe('{"key":"val"}');
    expect(snap.packageVersions["@dantecode/core"]).toBe("1.0.0");
    expect(snap.timestamp).toBe(NOW);
  });

  it("healthCheck detects command failures", () => {
    const io = makeIO();
    (io.exec as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ exitCode: 0, stdout: "pass", stderr: "" })
      .mockReturnValueOnce({ exitCode: 1, stdout: "", stderr: "build error" });

    const rollback = new UpdateRollback(io);
    const result = rollback.healthCheck({
      commands: ["npm run build", "npm test"],
    });

    expect(result.passed).toBe(false);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]).toContain("npm test");
    expect(result.failures[0]).toContain("build error");
  });

  it("healthCheck passes when all commands succeed", () => {
    const io = makeIO();
    const rollback = new UpdateRollback(io);
    const result = rollback.healthCheck({
      commands: ["npm run build", "npm test", "npm run typecheck"],
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rollback restores config files from snapshot", () => {
    const files = new Map<string, string>();
    const io: UpdateRollbackIO = {
      readFile: (path) => files.get(path) ?? null,
      writeFile: vi.fn((path: string, content: string) => {
        files.set(path, content);
      }),
      exec: vi.fn(() => ({ exitCode: 0, stdout: "", stderr: "" })),
    };

    files.set("/config/a.json", '{"original":true}');
    const rollback = new UpdateRollback(io, { nowFn: () => NOW });

    // Snapshot the original state
    const snap = rollback.snapshot("1.0.0", ["/config/a.json"], {});

    // Simulate update changing the file
    files.set("/config/a.json", '{"updated":true}');

    // Rollback
    rollback.rollback(snap);

    // writeFile should be called with original content
    expect(io.writeFile).toHaveBeenCalledWith("/config/a.json", '{"original":true}');
  });

  it("recordInEvidenceChain logs actions", () => {
    const io = makeIO();
    const rollback = new UpdateRollback(io, { nowFn: () => NOW });

    rollback.recordInEvidenceChain("snapshot", { version: "1.0.0" });
    rollback.recordInEvidenceChain("rollback", { reason: "health check failed" });

    const log = rollback.getEvidenceLog();
    expect(log.length).toBe(2);
    expect(log[0]!.action).toBe("snapshot");
    expect(log[1]!.action).toBe("rollback");
    expect(log[0]!.timestamp).toBe(NOW);
  });
});
