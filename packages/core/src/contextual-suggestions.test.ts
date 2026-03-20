import { describe, it, expect } from "vitest";
import { ContextualSuggestions, contextualSuggestions } from "./contextual-suggestions.js";

describe("ContextualSuggestions", () => {
  const cs = new ContextualSuggestions();

  // 1. low PDSE triggers autoforge
  it("suggests /autoforge when PDSE score < 0.7", () => {
    const results = cs.suggest({ pdseScore: 0.5, pipelineState: "idle" });
    expect(results.some((s) => s.command === "/autoforge")).toBe(true);
  });

  // 2. typecheck error triggers /verify
  it("suggests /verify for TypeScript errors", () => {
    const results = cs.suggest({ activeErrors: ["TS2345: type mismatch"] });
    expect(results.some((s) => s.command === "/verify")).toBe(true);
  });

  // 3. test failure triggers /debug
  it("suggests /debug for test failures", () => {
    const results = cs.suggest({ activeErrors: ["AssertionError: expected true"] });
    expect(results.some((s) => s.command === "/debug")).toBe(true);
  });

  // 4. pipeline complete suggests /verify + /ship
  it("suggests /verify and /ship when pipeline is complete", () => {
    const results = cs.suggest({ pipelineState: "complete" });
    const commands = results.map((s) => s.command);
    expect(commands).toContain("/verify");
    expect(commands).toContain("/ship");
  });

  // 5. high context triggers /compact
  it("suggests /compact when context > 75%", () => {
    const results = cs.suggest({ contextPercent: 82 });
    expect(results.some((s) => s.command === "/compact")).toBe(true);
  });

  // 6. context at 74% does NOT trigger /compact
  it("does NOT suggest /compact when context <= 75%", () => {
    const results = cs.suggest({ contextPercent: 74 });
    expect(results.some((s) => s.command === "/compact")).toBe(false);
  });

  // 7. uncommitted changes suggests /commit
  it("suggests /commit for uncommitted changes (idle pipeline)", () => {
    const results = cs.suggest({ hasUncommittedChanges: true, pipelineState: "idle" });
    expect(results.some((s) => s.command === "/commit")).toBe(true);
  });

  // 8. running pipeline does NOT suggest /commit
  it("does NOT suggest /commit while pipeline is running", () => {
    const results = cs.suggest({ hasUncommittedChanges: true, pipelineState: "running" });
    expect(results.some((s) => s.command === "/commit")).toBe(false);
  });

  // 9. first message suggests /review
  it("suggests /review for first message with no recent commands", () => {
    const results = cs.suggest({ isFirstMessage: true, recentCommands: [] });
    expect(results.some((s) => s.command === "/review")).toBe(true);
  });

  // 10. no duplicates
  it("returns no duplicate commands", () => {
    const results = cs.suggest({
      pdseScore: 0.4,
      pipelineState: "complete",
      contextPercent: 80,
      hasUncommittedChanges: true,
    });
    const cmds = results.map((s) => s.command);
    expect(cmds.length).toBe(new Set(cmds).size);
  });

  // 11. respects maxSuggestions
  it("respects maxSuggestions option", () => {
    const limited = new ContextualSuggestions({ maxSuggestions: 2 });
    const results = limited.suggest({
      pdseScore: 0.4,
      pipelineState: "complete",
      contextPercent: 80,
      hasUncommittedChanges: true,
      isFirstMessage: true,
    });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  // 12. high priority first
  it("returns high-priority suggestions before low-priority", () => {
    const results = cs.suggest({ pdseScore: 0.4, pipelineState: "idle" });
    if (results.length >= 2) {
      const priorities = results.map((s) => s.priority);
      const highIdx = priorities.indexOf("high");
      const lowIdx = priorities.lastIndexOf("low");
      if (highIdx !== -1 && lowIdx !== -1) {
        expect(highIdx).toBeLessThan(lowIdx);
      }
    }
  });

  // 13. topSuggestion returns first result
  it("topSuggestion() returns the first suggestion", () => {
    const top = cs.topSuggestion({ pdseScore: 0.5, pipelineState: "idle" });
    expect(top).not.toBeNull();
    expect(top!.command).toBe("/autoforge");
  });

  // 14. topSuggestion returns null when truly no triggers fire
  it("topSuggestion() returns null when no suggestion rules apply", () => {
    // pipeline_idle rule requires !isFirstMessage — set isFirstMessage to skip it
    // Pass pipelineState undefined so no pipeline rule fires; no errors/edits either
    const top = cs.topSuggestion({
      pdseScore: 0.95,
      contextPercent: 20,
      hasUncommittedChanges: false,
      isFirstMessage: false,
    });
    expect(top).toBeNull();
  });

  // 15. detectTriggers lists active triggers
  it("detectTriggers() lists high_context and low_pdse when both apply", () => {
    const triggers = cs.detectTriggers({ pdseScore: 0.5, contextPercent: 85 });
    expect(triggers).toContain("low_pdse");
    expect(triggers).toContain("high_context");
  });

  // 16. format returns non-empty string
  it("format() returns non-empty string for non-empty suggestions", () => {
    const suggestions = cs.suggest({ pdseScore: 0.5 });
    const out = cs.format(suggestions, { colors: false });
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("Suggested next steps");
  });

  // 17. format returns empty string for empty suggestions
  it("format() returns empty string for empty suggestions array", () => {
    expect(cs.format([], { colors: false })).toBe("");
  });

  // 18. format with colors=false has no ANSI
  it("format() with colors=false has no ANSI codes", () => {
    const sug = cs.suggest({ pdseScore: 0.4 });
    const out = cs.format(sug, { colors: false });
    expect(out).not.toContain("\x1b[");
  });

  // 19. file_edited trigger
  it("suggests /verify when TypeScript files were edited", () => {
    const results = cs.suggest({
      editedFilePaths: ["src/foo.ts"],
      pipelineState: "idle",
    });
    expect(results.some((s) => s.command === "/verify")).toBe(true);
  });

  // 20. singleton export works
  it("contextualSuggestions singleton is a ContextualSuggestions instance", () => {
    expect(contextualSuggestions).toBeInstanceOf(ContextualSuggestions);
  });
});
