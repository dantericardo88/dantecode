import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { GitAutomationStore } from "./automation-store.js";
import { createAutoPR } from "./auto-pr-engine.js";

describe("createAutoPR", () => {
  it("builds the gh command, returns the parsed URL, and persists the run", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-pr-"));
    const calls: string[][] = [];

    try {
      const result = await createAutoPR("Automation PR", "Body", {
        cwd: tmpDir,
        base: "main",
        draft: true,
        labels: ["automation"],
        changesetFiles: [".changeset/auto.md"],
        runner: async (args) => {
          calls.push(args);
          if (args[0] === "--version") {
            return { stdout: "gh version 2.0.0", stderr: "" };
          }
          return {
            stdout: "https://github.com/example/repo/pull/42\n",
            stderr: "",
          };
        },
      });

      expect(result.success).toBe(true);
      expect(result.prUrl).toBe("https://github.com/example/repo/pull/42");
      expect(calls[1]).toEqual([
        "pr",
        "create",
        "--title",
        "Automation PR",
        "--body",
        "Body",
        "--base",
        "main",
        "--draft",
        "--label",
        "automation",
      ]);

      const records = await new GitAutomationStore(tmpDir).listAutoPullRequests();
      expect(records).toHaveLength(1);
      expect(records[0]?.prUrl).toBe("https://github.com/example/repo/pull/42");
      expect(records[0]?.changesetFiles).toEqual([".changeset/auto.md"]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
