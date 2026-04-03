import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { GitAutomationStore } from "./automation-store.js";
import { runLocalWorkflow } from "./local-workflow-runner.js";

describe("LocalWorkflowRunner", () => {
  it("runs matrix jobs and injects the event payload file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-test-"));
    const workflowPath = path.join(tmpDir, "ci.yml");

    try {
      fs.writeFileSync(
        workflowPath,
        [
          "name: CI",
          "jobs:",
          "  build:",
          "    strategy:",
          "      matrix:",
          "        node: [18, 20]",
          "    steps:",
          "      - name: Echo event",
          "        if: github.event_name == 'push'",
          "        run: node -e \"console.log(process.env.GITHUB_EVENT_NAME + ':' + process.env.MATRIX_NODE)\"",
          "      - name: Read payload",
          "        run: node -e \"const fs=require('fs'); const payload=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8')); console.log(payload.ref)\"",
          "",
        ].join("\n"),
        "utf-8",
      );

      const result = await runLocalWorkflow(
        "ci.yml",
        { eventName: "push", ref: "refs/heads/main" },
        { cwd: tmpDir },
      );

      expect(result.success).toBe(true);
      expect(result.jobs).toHaveLength(2);
      expect(result.jobs[0]?.steps[0]?.output).toContain("push:18");
      expect(result.jobs[1]?.steps[0]?.output).toContain("push:20");
      expect(result.jobs[0]?.steps[1]?.output).toContain("refs/heads/main");
      expect(result.eventPayloadPath).toBeDefined();
      expect(fs.existsSync(result.eventPayloadPath!)).toBe(true);

      const persistedRuns = await new GitAutomationStore(tmpDir).listWorkflowRuns();
      expect(persistedRuns).toHaveLength(1);
      expect(persistedRuns[0]?.workflowName).toBe("CI");
      expect(persistedRuns[0]?.success).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
