// ============================================================================
// packages/vscode/src/__tests__/architect-editor-orchestrator.test.ts
// Tests for ArchitectEditorOrchestrator — two-pass multi-file edit planning.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ArchitectEditorOrchestrator, type ArchitectPlan } from "../architect-editor-orchestrator.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_PLAN_JSON: ArchitectPlan = {
  overallApproach: "Update the authentication flow",
  files: [
    { path: "src/auth.ts", intent: "Add JWT validation" },
    { path: "src/middleware.ts", intent: "Wire auth middleware" },
  ],
};

function makeMockCall(response: string) {
  return vi.fn().mockResolvedValue(response);
}

function makeGetContent(contentMap: Record<string, string> = {}) {
  return vi.fn(async (p: string) => contentMap[p] ?? "");
}

// ── plan() ────────────────────────────────────────────────────────────────────

describe("ArchitectEditorOrchestrator.plan()", () => {
  it("calls modelCall with the JSON-only architect prompt suffix", async () => {
    const modelCall = makeMockCall(JSON.stringify(VALID_PLAN_JSON));
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    await orch.plan("add auth", "You are a coding assistant.");

    expect(modelCall).toHaveBeenCalledOnce();
    const [systemArg] = modelCall.mock.calls[0]!;
    expect(systemArg).toContain("ARCHITECT MODE");
    expect(systemArg).toContain("JSON only");
  });

  it("parses valid JSON into an ArchitectPlan", async () => {
    const modelCall = makeMockCall(JSON.stringify(VALID_PLAN_JSON));
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    const plan = await orch.plan("add auth", "");

    expect(plan.overallApproach).toBe("Update the authentication flow");
    expect(plan.files).toHaveLength(2);
    expect(plan.files[0]?.path).toBe("src/auth.ts");
  });

  it("extracts JSON even when wrapped in markdown code fences", async () => {
    const modelCall = makeMockCall(
      `Here is the plan:\n\`\`\`json\n${JSON.stringify(VALID_PLAN_JSON)}\n\`\`\``,
    );
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    const plan = await orch.plan("add auth", "");
    expect(plan.files).toHaveLength(2);
  });

  it("throws when the response contains no JSON object", async () => {
    const modelCall = makeMockCall("I cannot help with that.");
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    await expect(orch.plan("add auth", "")).rejects.toThrow(/no JSON/);
  });
});

// ── edit() ────────────────────────────────────────────────────────────────────

describe("ArchitectEditorOrchestrator.edit()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls modelCall once per file in the plan", async () => {
    const modelCall = makeMockCall("<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE");
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    await orch.edit(VALID_PLAN_JSON, "add auth");

    expect(modelCall).toHaveBeenCalledTimes(2);
  });

  it("calls getFileContent with the correct path per file", async () => {
    const getContent = makeGetContent({ "src/auth.ts": "const x = 1;" });
    const modelCall = makeMockCall("response");
    const orch = new ArchitectEditorOrchestrator(modelCall, getContent);

    await orch.edit(VALID_PLAN_JSON, "add auth");

    expect(getContent).toHaveBeenCalledWith("src/auth.ts");
    expect(getContent).toHaveBeenCalledWith("src/middleware.ts");
  });

  it("returns a Map with one entry per plan file", async () => {
    const modelCall = makeMockCall("block output");
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    const result = await orch.edit(VALID_PLAN_JSON, "add auth");

    expect(result.size).toBe(2);
    expect(result.has("src/auth.ts")).toBe(true);
    expect(result.has("src/middleware.ts")).toBe(true);
  });

  it("deduplicates files with the same path (last intent wins)", async () => {
    const modelCall = makeMockCall("block output");
    const getContent = makeGetContent();
    const orch = new ArchitectEditorOrchestrator(modelCall, getContent);

    const dupPlan: ArchitectPlan = {
      overallApproach: "test",
      files: [
        { path: "src/auth.ts", intent: "first intent" },
        { path: "src/auth.ts", intent: "second intent" },
      ],
    };

    const result = await orch.edit(dupPlan, "test");

    // Only one call per unique path
    expect(modelCall).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(1);
  });

  it("handles empty files array — returns empty Map", async () => {
    const modelCall = makeMockCall("block output");
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    const emptyPlan: ArchitectPlan = { overallApproach: "nothing", files: [] };
    const result = await orch.edit(emptyPlan, "noop");

    expect(result.size).toBe(0);
    expect(modelCall).not.toHaveBeenCalled();
  });

  it("full round-trip: plan with 2 files → edit → both responses in Map", async () => {
    const responses = [
      "<<<<<<< SEARCH\nold auth\n=======\nnew auth\n>>>>>>> REPLACE",
      "<<<<<<< SEARCH\nold middleware\n=======\nnew middleware\n>>>>>>> REPLACE",
    ];
    let callCount = 0;
    const modelCall = vi.fn(async () => responses[callCount++] ?? "");
    const orch = new ArchitectEditorOrchestrator(modelCall, makeGetContent());

    const result = await orch.edit(VALID_PLAN_JSON, "add auth");

    expect(result.size).toBe(2);
    expect(result.get("src/auth.ts")).toContain("SEARCH");
    expect(result.get("src/middleware.ts")).toContain("SEARCH");
  });
});
