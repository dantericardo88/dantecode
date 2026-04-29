import { describe, expect, it } from "vitest";
import { routeSlashCommand, type ReplState } from "../slash-commands.js";

function makeState(): ReplState {
  return {
    session: {
      id: "test-session",
      projectRoot: "/project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      activeFiles: [],
    } as unknown as ReplState["session"],
    state: {
      model: { default: "test-model", fallback: [], taskOverrides: {} },
      autoforge: { maxIterations: 3, gstackCommands: [] },
      pdse: { threshold: 80 },
    } as unknown as ReplState["state"],
    projectRoot: "/project",
    verbose: false,
    enableGit: true,
    enableSandbox: false,
    silent: false,
    lastEditFile: null,
    lastEditContent: null,
    recentToolCalls: [],
    pendingAgentPrompt: null,
    activeAbortController: null,
    sandboxBridge: null,
    mcpClient: null,
    activeSkill: null,
    waveState: null,
  };
}

describe("/autoresearch", () => {
  it("queues the focused self-improvement research pipeline for dimension 48", async () => {
    const state = makeState();
    const output = await routeSlashCommand(
      "/autoresearch dim48 accessibility_inclusive_ux --target 9 --max-cycles 20",
      state,
    );

    expect(output).toContain("Autoresearch Pipeline activated");
    expect(state.pendingAgentPrompt).toContain("accessibility_inclusive_ux");
    expect(state.pendingAgentPrompt).toContain("/oss");
    expect(state.pendingAgentPrompt).toContain("/oss-harvest");
    expect(state.pendingAgentPrompt).toContain("/party");
    expect(state.pendingAgentPrompt).toContain("target score: 9");
  });
});
