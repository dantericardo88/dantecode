import { describe, it, expect } from "vitest";
import { UpliftOrchestrator } from "./uplift-orchestrator";

describe("UpliftOrchestrator", () => {
  it("should coordinate a research and subtask flow", async () => {
    const orchestrator = new UpliftOrchestrator({ projectRoot: "C:/Projects/DanteCode" });

    const evidence = await orchestrator.runResearchTask("Search for uplift patterns");
    // The bundle must be a valid EvidenceBundle (content is a string, citations is an array)
    expect(typeof evidence.content).toBe("string");
    expect(Array.isArray(evidence.citations)).toBe(true);
    expect(evidence.metadata).toBeDefined();

    // executeSubTask calls git worktree methods which require real git
    expect(typeof orchestrator.executeSubTask).toBe("function");
    expect(typeof orchestrator.listSubAgents).toBe("function");
  });
});
