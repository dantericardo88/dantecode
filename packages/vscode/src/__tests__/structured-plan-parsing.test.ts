// packages/vscode/src/__tests__/structured-plan-parsing.test.ts
// Sprint 30 — Dim 16: Structured JSON plan parsing (7→9)
// parsePlan now uses JSON-first parsing with regex fallback.
// buildPlanModeSystemPromptStructured requests JSON output from the model.
import { describe, it, expect } from "vitest";
import {
  parsePlan,
  buildPlanModeSystemPrompt,
  buildPlanModeSystemPromptStructured,
} from "@dantecode/core";

// ─── JSON-first parsing ───────────────────────────────────────────────────────

describe("parsePlan — JSON-first path", () => {
  it("parses a raw JSON object with steps array", () => {
    const json = JSON.stringify({
      goal: "Add auth middleware",
      steps: [
        { description: "Create auth.ts file", risk: "medium", affectedFiles: ["src/auth.ts"], requiresTool: false },
        { description: "Add route guard to app.ts", risk: "low", affectedFiles: ["src/app.ts"], requiresTool: false },
      ],
    });
    const plan = parsePlan(json, "Add auth");
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.description).toBe("Create auth.ts file");
    expect(plan.steps[0]?.risk).toBe("medium");
    expect(plan.steps[0]?.affectedFiles).toContain("src/auth.ts");
  });

  it("parses JSON from a ```json fenced block", () => {
    const text = `Here is the plan:\n\`\`\`json\n${JSON.stringify({
      goal: "Refactor API",
      steps: [{ description: "Extract service layer", risk: "low", affectedFiles: ["src/service.ts"] }],
    })}\n\`\`\``;
    const plan = parsePlan(text, "Refactor API");
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.description).toContain("service layer");
  });

  it("uses JSON goal field when present", () => {
    const json = JSON.stringify({
      goal: "JSON goal overrides caller goal",
      steps: [{ description: "Do something", risk: "low" }],
    });
    const plan = parsePlan(json, "caller goal");
    expect(plan.goal).toBe("JSON goal overrides caller goal");
  });

  it("filters out steps with description shorter than 5 chars", () => {
    const json = JSON.stringify({
      steps: [
        { description: "ok", risk: "low" },
        { description: "This is a valid step description", risk: "low" },
      ],
    });
    const plan = parsePlan(json, "test");
    expect(plan.steps).toHaveLength(1);
  });

  it("infers risk from description when not specified in JSON", () => {
    const json = JSON.stringify({
      steps: [{ description: "delete old migration files" }],
    });
    const plan = parsePlan(json, "cleanup");
    expect(plan.steps[0]?.risk).toBe("high"); // "delete" → high risk
  });

  it("sets hasDestructiveSteps true when any step has risk=high", () => {
    const json = JSON.stringify({
      steps: [
        { description: "Read config", risk: "low" },
        { description: "Drop old table", risk: "high" },
      ],
    });
    const plan = parsePlan(json, "migrate");
    expect(plan.hasDestructiveSteps).toBe(true);
  });

  it("counts unique affectedFiles across steps for estimatedChangedFiles", () => {
    const json = JSON.stringify({
      steps: [
        { description: "Step A", affectedFiles: ["a.ts", "b.ts"] },
        { description: "Step B", affectedFiles: ["b.ts", "c.ts"] },
      ],
    });
    const plan = parsePlan(json, "count");
    expect(plan.estimatedChangedFiles).toBe(3); // a.ts, b.ts, c.ts — deduped
  });

  it("returns plan with id and createdAt", () => {
    const json = JSON.stringify({ steps: [{ description: "Do the thing", risk: "low" }] });
    const plan = parsePlan(json, "goal");
    expect(typeof plan.id).toBe("string");
    expect(plan.id.length).toBeGreaterThan(0);
    expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── Regex fallback path ──────────────────────────────────────────────────────

describe("parsePlan — regex fallback", () => {
  it("falls back to regex when text is not JSON", () => {
    const text = [
      "1. Create the auth module in `src/auth.ts`",
      "2. Add middleware to `src/app.ts`",
      "3. Delete legacy `src/old-auth.ts`",
    ].join("\n");
    const plan = parsePlan(text, "Modernize auth");
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0]?.description).toContain("auth module");
  });

  it("falls back to regex for bullet list format", () => {
    const text = "- Install dependencies\n- Update package.json\n- Run tests";
    const plan = parsePlan(text, "setup");
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it("returns empty steps for text with no parseable lines", () => {
    const plan = parsePlan("Just some freeform text without any list markers.", "goal");
    expect(plan.steps).toHaveLength(0);
  });
});

// ─── buildPlanModeSystemPromptStructured ──────────────────────────────────────

describe("buildPlanModeSystemPromptStructured", () => {
  it("returns a string containing the goal", () => {
    const prompt = buildPlanModeSystemPromptStructured("Add authentication");
    expect(prompt).toContain("Add authentication");
  });

  it("contains a ```json fenced block with steps schema", () => {
    const prompt = buildPlanModeSystemPromptStructured("refactor");
    expect(prompt).toContain("```json");
    expect(prompt).toContain('"steps"');
  });

  it("mentions risk levels: low, medium, high", () => {
    const prompt = buildPlanModeSystemPromptStructured("anything");
    expect(prompt).toMatch(/low.*medium.*high|low | medium | high/i);
  });

  it("instructs model NOT to start executing", () => {
    const prompt = buildPlanModeSystemPromptStructured("any goal");
    expect(prompt).toMatch(/do not start executing/i);
  });

  it("produces different output from legacy buildPlanModeSystemPrompt", () => {
    const structured = buildPlanModeSystemPromptStructured("goal");
    const legacy = buildPlanModeSystemPrompt("goal");
    expect(structured).not.toBe(legacy);
    expect(structured).toContain("Structured Output");
  });
});
