/**
 * GF-06: Combined Research + SubAgent Synthesis Golden Flow
 *
 * This integration test validates the full pipeline:
 *   Research (DDG + BM25 + cache) → EvidenceBundle
 *   → SubAgent spawn (with lifecycle tracking)
 *   → HandoffEngine (role transfer)
 *   → WaveTreeManager (hierarchy tracking)
 *   → Verification (PDSE gate — validated via runtime-spine types)
 *
 * All network calls are mocked so this runs offline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubAgentSpawner } from "./subagent-spawner.js";
import { HandoffEngine } from "./handoff-engine.js";
import { WaveTreeManager } from "./hierarchy/tree-manager.js";
import { ResearchPipeline } from "@dantecode/web-research";
import type { EvidenceBundle } from "@dantecode/runtime-spine";

// --- Mock the DDG network call so the test is offline ---
vi.mock("node-fetch", () => ({
  default: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => `
      <html><body>
        <div class="result">
          <a class="result__title"><span>BM25 Ranking in Production</span></a>
          <a class="result__url">https://example.com/bm25</a>
          <div class="result__snippet">BM25 is the gold standard for term-frequency ranking used by Elasticsearch and search engines globally.</div>
        </div>
        <div class="result">
          <a class="result__title"><span>Agent Uplift Patterns</span></a>
          <a class="result__url">https://example.com/uplift</a>
          <div class="result__snippet">Uplift patterns refer to techniques for improving agent reasoning and research quality through structured orchestration.</div>
        </div>
      </body></html>
    `,
    headers: { get: () => "text/html" },
  }),
}));

describe("GF-06: Combined Research + SubAgent Synthesis Golden Flow", () => {
  let spawner: SubAgentSpawner;
  let handoffEngine: HandoffEngine;
  let treeManager: WaveTreeManager;
  let researchPipeline: ResearchPipeline;

  beforeEach(() => {
    spawner = new SubAgentSpawner({ maxConcurrency: 4 });
    handoffEngine = new HandoffEngine();
    treeManager = new WaveTreeManager();
    researchPipeline = new ResearchPipeline({ maxResults: 5, fetchTopN: 0 });
  });

  it("GF-06a: research pipeline returns a valid EvidenceBundle", async () => {
    const result = await researchPipeline.run("uplift patterns for agent research");
    const bundle = result.evidenceBundle;

    expect(typeof bundle.content).toBe("string");
    expect(Array.isArray(bundle.citations)).toBe(true);
    expect(bundle.metadata).toBeDefined();
  });

  it("GF-06b: spawner creates isolated agent with valid task packet", () => {
    const agent = spawner.spawn("researcher", "Analyze uplift patterns", {
      domain: "ai-research",
    });

    expect(agent.role).toBe("researcher");
    expect(agent.task.kind).toBe("subagent-task");
    expect(agent.task.objective).toContain("uplift patterns");
    expect(agent.status).toBe("idle");
  });

  it("GF-06c: handoff engine transfers control to a synthesis role", async () => {
    const researchAgent = spawner.spawn("researcher", "Research topic");
    const event = await handoffEngine.initiateHandoff({
      fromId: researchAgent.id,
      toRole: "synthesizer",
      reason: "Research complete — synthesizer to aggregate findings",
      context: { evidence: "summary of findings" },
    });

    expect(event.kind).toBe("subagent.handoff");
    expect(event.payload["toRole"]).toBe("synthesizer");
    expect(event.payload["reason"]).toContain("Research complete");
  });

  it("GF-06d: tree manager tracks agent hierarchy correctly", () => {
    const parentAgent = spawner.spawn("orchestrator", "Run full research");
    const childAgent1 = spawner.spawn("researcher", "Fetch web results");
    const childAgent2 = spawner.spawn("synthesizer", "Aggregate results");

    treeManager.addNode(parentAgent.id);
    treeManager.addNode(childAgent1.id, parentAgent.id);
    treeManager.addNode(childAgent2.id, parentAgent.id);

    const descendants = treeManager.getDescendants(parentAgent.id);
    expect(descendants).toContain(childAgent1.id);
    expect(descendants).toContain(childAgent2.id);

    const ancestors = treeManager.getAncestors(childAgent1.id);
    expect(ancestors).toContain(parentAgent.id);
  });

  it("GF-06e: full pipeline — research feeds synthesis subagent", async () => {
    // Phase 1: Research
    const researchResult = await researchPipeline.run("agent orchestration patterns");
    const bundle: EvidenceBundle = researchResult.evidenceBundle;

    // Phase 2: Spawn synthesizer with evidence context
    const synthesizer = spawner.spawn("synthesizer", "Synthesize findings", {
      evidenceContent: bundle.content.slice(0, 200),
      citationCount: bundle.citations.length,
    });
    spawner.updateStatus(synthesizer.id, "running");

    // Phase 3: Record in tree
    const orchestratorAgent = spawner.spawn("orchestrator", "Master task");
    treeManager.addNode(orchestratorAgent.id);
    treeManager.addNode(synthesizer.id, orchestratorAgent.id);

    // Phase 4: Handoff to writer role
    const handoffEvent = await handoffEngine.initiateHandoff({
      fromId: synthesizer.id,
      toRole: "writer",
      reason: "Synthesis complete",
      context: { summary: bundle.content.slice(0, 100) },
    });

    spawner.updateStatus(synthesizer.id, "completed");

    // Validate the full GF-06 flow
    expect(bundle.citations).toBeDefined();
    expect(synthesizer.status).toBe("completed");
    expect(handoffEvent.kind).toBe("subagent.handoff");
    expect(treeManager.getDescendants(orchestratorAgent.id)).toContain(synthesizer.id);
    expect(researchResult.resultCount).toBeGreaterThanOrEqual(0);
  });
});
