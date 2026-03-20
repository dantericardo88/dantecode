import { describe, expect, it } from "vitest";
import { ToolScheduler } from "./tool-scheduler.js";

describe("Background SubAgent prerequisites", () => {
  it("does not satisfy downstream dependencies while the sub-agent is still running in background mode", async () => {
    const scheduler = new ToolScheduler(undefined, { verifyAfterExecution: false }, {
      policies: [
        { tool: "SubAgent", executionClass: "agent" },
        { tool: "Write", executionClass: "file_write", dependsOn: ["SubAgent"] },
      ],
    });
    const executed: string[] = [];

    const results = await scheduler.executeBatch(
      [
        {
          id: "call-subagent-bg",
          toolName: "SubAgent",
          input: { prompt: "Inspect auth flow", background: true },
        },
        {
          id: "call-write-after-bg",
          toolName: "Write",
          input: { file_path: "src/app.ts", content: "export const ready = true;" },
        },
      ],
      {
        requestId: "req-subagent-bg",
        execute: async (call) => {
          executed.push(call.toolName);
          return {
            content:
              call.toolName === "SubAgent"
                ? 'Background task started: bg-123. Use SubAgent with prompt "status bg-123" to check progress.'
                : `${call.toolName} ok`,
            isError: false,
          };
        },
      },
    );

    expect(executed).toEqual(["SubAgent"]);
    expect(results.map((result) => result.record.status)).toEqual(["success", "blocked_by_dependency"]);
    expect(results[1]!.blockedReason).toContain("SubAgent");
  });

  it("allows downstream dependencies after a synchronous sub-agent completes", async () => {
    const scheduler = new ToolScheduler(undefined, { verifyAfterExecution: false }, {
      policies: [
        { tool: "SubAgent", executionClass: "agent" },
        { tool: "Write", executionClass: "file_write", dependsOn: ["SubAgent"] },
      ],
    });
    const executed: string[] = [];

    const results = await scheduler.executeBatch(
      [
        {
          id: "call-subagent-sync",
          toolName: "SubAgent",
          input: { prompt: "Inspect auth flow", background: false },
        },
        {
          id: "call-write-after-sync",
          toolName: "Write",
          input: { file_path: "src/app.ts", content: "export const ready = true;" },
        },
      ],
      {
        requestId: "req-subagent-sync",
        execute: async (call) => {
          executed.push(call.toolName);
          return {
            content: `${call.toolName} ok`,
            isError: false,
          };
        },
      },
    );

    expect(executed).toEqual(["SubAgent", "Write"]);
    expect(results.map((result) => result.record.status)).toEqual(["success", "success"]);
  });
});
