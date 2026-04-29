import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runRegressionCommand } from "../regression-command.js";

describe("regression command", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "dante-regression-"));
    tempDirs.push(dir);
    return dir;
  }

  it("writes JSON and markdown evidence for a passing score-claim gate", async () => {
    const cwd = tempProject();
    const writes: string[] = [];
    const code = await runRegressionCommand(
      ["gate", "--profile", "score-claim", "--format", "json", "--evidence", "--threshold", "90"],
      {
        cwd,
        execSyncFn: (command) => {
          writes.push(command);
          return `ok: ${command}`;
        },
        now: () => new Date("2026-04-29T12:00:00.000Z"),
        writeOutput: () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(writes).toContain("npm run typecheck");
    expect(existsSync(join(cwd, ".danteforge", "evidence", "regression-prevention-dim34.json"))).toBe(true);
    expect(existsSync(join(cwd, ".danteforge", "evidence", "regression-prevention-dim34.md"))).toBe(true);
    const evidence = JSON.parse(
      readFileSync(join(cwd, ".danteforge", "evidence", "regression-prevention-dim34.json"), "utf-8"),
    );
    expect(evidence.pass).toBe(true);
    expect(evidence.proof.scoreClaimsBlocked).toBe(true);
  });

  it("exits non-zero on blocking failures", async () => {
    const cwd = tempProject();
    const code = await runRegressionCommand(["gate", "--profile", "release", "--format", "json"], {
      cwd,
      execSyncFn: (command) => {
        if (command.includes("lint")) {
          throw new Error("ESLint: no-unused-vars");
        }
        return "ok";
      },
      now: () => new Date("2026-04-29T12:00:00.000Z"),
      writeOutput: () => undefined,
    });

    expect(code).toBe(1);
  });

  it("renders markdown with status, failure class, waiver, and next action", async () => {
    const cwd = tempProject();
    let output = "";
    await runRegressionCommand(["gate", "--profile", "release", "--format", "markdown"], {
      cwd,
      execSyncFn: () => {
        throw new Error("Vitest hook timed out after 15000ms");
      },
      now: () => new Date("2026-04-29T12:00:00.000Z"),
      writeOutput: (text) => {
        output += text;
      },
    });

    expect(output).toContain("| test |");
    expect(output).toContain("flaky");
    expect(output).toContain("Waiver");
    expect(output).toContain("Next action");
  });

  it("fails when threshold is above the computed score", async () => {
    const cwd = tempProject();
    const code = await runRegressionCommand(["gate", "--profile", "release", "--threshold", "101"], {
      cwd,
      execSyncFn: () => "ok",
      now: () => new Date("2026-04-29T12:00:00.000Z"),
      writeOutput: () => undefined,
    });

    expect(code).toBe(1);
  });
});
