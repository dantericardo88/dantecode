import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_CONFIG,
  evaluateAgentToolAccess,
  normalizeAgentConfig,
} from "./agent-config.js";

describe("agent config normalization", () => {
  it("defaults new VS Code sessions to canonical apply mode", () => {
    expect(DEFAULT_AGENT_CONFIG.agentMode).toBe("apply");
  });

  it("migrates legacy build and CLI aliases to canonical modes", () => {
    expect(normalizeAgentConfig({ agentMode: "build" as never }).agentMode).toBe("apply");
    expect(normalizeAgentConfig({ agentMode: "default" as never }).agentMode).toBe("review");
    expect(normalizeAgentConfig({ agentMode: "auto-edit" as never }).agentMode).toBe("apply");
  });
});

describe("agent tool access", () => {
  it("denies mutation tools in plan mode", () => {
    const config = normalizeAgentConfig({ agentMode: "plan" });

    expect(evaluateAgentToolAccess(config, "Read")).toMatchObject({ decision: "allow" });
    expect(evaluateAgentToolAccess(config, "Write")).toMatchObject({ decision: "deny" });
  });

  it("requires confirmation when a matching permission is set to ask", () => {
    const config = normalizeAgentConfig({
      permissions: { ...DEFAULT_AGENT_CONFIG.permissions, edit: "ask" },
    });

    expect(evaluateAgentToolAccess(config, "Write")).toMatchObject({ decision: "ask" });
  });

  it("denies all tools when global tool permission is deny", () => {
    const config = normalizeAgentConfig({
      permissions: { ...DEFAULT_AGENT_CONFIG.permissions, tools: "deny" },
    });

    expect(evaluateAgentToolAccess(config, "Read")).toMatchObject({ decision: "deny" });
    expect(evaluateAgentToolAccess(config, "Bash")).toMatchObject({ decision: "deny" });
  });
});
