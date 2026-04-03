import { describe, it, expect, vi, beforeEach } from "vitest";
import { UpliftOrchestrator } from "./uplift-orchestrator";

// ---------------------------------------------------------------------------
// Mock git-engine to avoid real git dependency in worktree tests
// ---------------------------------------------------------------------------

const mockCreateWorktree = vi.fn();
const mockRemoveWorktree = vi.fn();

vi.mock("@dantecode/git-engine", async () => {
  const actual = await vi.importActual<object>("@dantecode/git-engine");
  return {
    ...actual,
    createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
    removeWorktree: (...args: unknown[]) => mockRemoveWorktree(...args),
  };
});

// Mock web-research to avoid real HTTP calls
vi.mock("@dantecode/web-research", () => ({
  ResearchPipeline: class MockResearchPipeline {
    async run(objective: string) {
      return {
        evidenceBundle: {
          content: `Research result for: ${objective}`,
          citations: [],
          metadata: { query: objective },
        },
      };
    }
  },
}));

describe("UpliftOrchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWorktree.mockReturnValue({
      directory: "/tmp/test-worktree",
      branch: "subagent/test-id",
    });
    mockRemoveWorktree.mockReturnValue(undefined);
  });

  it("should coordinate a research and subtask flow", async () => {
    const orchestrator = new UpliftOrchestrator({ projectRoot: "/tmp/project" });

    const evidence = await orchestrator.runResearchTask("Search for uplift patterns");
    expect(typeof evidence.content).toBe("string");
    expect(Array.isArray(evidence.citations)).toBe(true);
    expect(evidence.metadata).toBeDefined();

    expect(typeof orchestrator.executeSubTask).toBe("function");
    expect(typeof orchestrator.listSubAgents).toBe("function");
  });

  it("executeSubTask calls agentRunner when provided and returns its result", async () => {
    const agentRunner = vi.fn().mockResolvedValue("Agent completed the task successfully");

    const orchestrator = new UpliftOrchestrator({
      projectRoot: "/tmp/project",
      agentRunner,
    });

    const result = await orchestrator.executeSubTask("mcp-root", "developer", "Build feature X");

    expect(agentRunner).toHaveBeenCalledOnce();
    expect(agentRunner).toHaveBeenCalledWith("developer", "Build feature X", "/tmp/test-worktree");
    expect(result).toBe("Agent completed the task successfully");
  });

  it("executeSubTask rejects when agentRunner is absent", async () => {
    const orchestrator = new UpliftOrchestrator({ projectRoot: "/tmp/project" });

    await expect(
      orchestrator.executeSubTask("mcp-root", "developer", "Build feature Y"),
    ).rejects.toThrow("No agent runner configured for role: developer");
  });

  it("executeSubTask marks instance as failed when agentRunner throws", async () => {
    const agentRunner = vi.fn().mockRejectedValue(new Error("Runner crashed"));

    const orchestrator = new UpliftOrchestrator({
      projectRoot: "/tmp/project",
      agentRunner,
    });

    const result = await orchestrator.executeSubTask("mcp-root", "developer", "Build feature Z");

    expect(result).toMatch(/failed/i);
    expect(result).toContain("Runner crashed");

    // Instance should be in failed state
    const agents = orchestrator.listSubAgents();
    const agent = agents.find((a) => a.role === "developer");
    expect(agent?.status).toBe("failed");
  });
});
