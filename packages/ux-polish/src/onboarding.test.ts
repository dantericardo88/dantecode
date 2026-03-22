/**
 * onboarding.test.ts — @dantecode/ux-polish
 * Tests for OnboardingWizard and OnboardingState.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { OnboardingWizard } from "./onboarding-wizard.js";
import { OnboardingState } from "./preferences/onboarding-state.js";
import { ThemeEngine } from "./theme-engine.js";
import type { OnboardingStep } from "./types.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

// ---------------------------------------------------------------------------
// OnboardingState tests
// ---------------------------------------------------------------------------

describe("OnboardingState", () => {
  let tmpDir: string;
  let state: OnboardingState;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dante-onboarding-test-"));
    state = new OnboardingState({ stateFilePath: path.join(tmpDir, "onboarding.json") });
  });

  it("starts not complete", () => {
    expect(state.isComplete()).toBe(false);
  });

  it("markStepComplete() marks a step done", () => {
    state.markStepComplete("env-check");
    expect(state.isStepComplete("env-check")).toBe(true);
    expect(state.getCompletedSteps()).toContain("env-check");
  });

  it("markStepSkipped() records skip", () => {
    state.markStepSkipped("config-init");
    expect(state.isStepSkipped("config-init")).toBe(true);
  });

  it("markComplete() sets completed=true with timestamp", () => {
    state.markComplete();
    expect(state.isComplete()).toBe(true);
    expect(state.getRecord().completedAt).toBeDefined();
  });

  it("reset() clears all state", () => {
    state.markStepComplete("env-check");
    state.markComplete();
    state.reset();
    expect(state.isComplete()).toBe(false);
    expect(state.getCompletedSteps()).toHaveLength(0);
  });

  it("persists and loads from file", () => {
    state.markStepComplete("api-key");
    state.markComplete();

    // Create new instance pointing to same file
    const state2 = new OnboardingState({ stateFilePath: path.join(tmpDir, "onboarding.json") });
    expect(state2.isComplete()).toBe(true);
    expect(state2.isStepComplete("api-key")).toBe(true);
  });

  it("completing a step removes it from skipped list", () => {
    state.markStepSkipped("config-init");
    expect(state.isStepSkipped("config-init")).toBe(true);
    state.markStepComplete("config-init");
    expect(state.isStepSkipped("config-init")).toBe(false);
    expect(state.isStepComplete("config-init")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// OnboardingWizard tests
// ---------------------------------------------------------------------------

describe("OnboardingWizard", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dante-wizard-test-"));
    process.env["DANTE_ONBOARDING_QUIET"] = "1";
  });

  const noColorTheme = new ThemeEngine({ colors: false });

  function makeWizard(
    stepRunner?: (s: OnboardingStep) => Promise<"completed" | "skipped" | "failed">,
  ) {
    return new OnboardingWizard({
      theme: noColorTheme,
      stepRunner,
      stateOptions: { stateFilePath: path.join(tmpDir, "onboarding.json") },
    });
  }

  it("auto-completes all steps and returns completed=true", async () => {
    const wizard = makeWizard(async () => "completed");
    const result = await wizard.run({ ci: false });
    expect(result.completed).toBe(true);
    expect(result.stepsCompleted.length).toBeGreaterThan(0);
  });

  it("returns completed=true after second run if already done", async () => {
    const wizard = makeWizard(async () => "completed");
    await wizard.run();
    const result2 = await wizard.run();
    expect(result2.completed).toBe(true);
  });

  it("force=true re-runs even when complete", async () => {
    const wizard = makeWizard(async () => "completed");
    await wizard.run();
    const result2 = await wizard.run({ force: true });
    expect(result2.completed).toBe(true);
  });

  it("skips skippable steps in CI mode", async () => {
    const wizard = makeWizard(async () => "completed");
    const result = await wizard.run({ ci: true });
    // Non-skippable steps complete; skippable ones are skipped
    expect(result.stepsCompleted.length).toBeGreaterThan(0);
  });

  it("stops and returns completed=false on step failure", async () => {
    let callCount = 0;
    const runner = async (_step: OnboardingStep): Promise<"completed" | "skipped" | "failed"> => {
      callCount++;
      return callCount === 1 ? "completed" : "failed";
    };
    const wizard = makeWizard(runner);
    const result = await wizard.run({ ci: false });
    expect(result.completed).toBe(false);
    expect(result.nextSuggestedStep).toBeTruthy();
  });

  it("uses custom steps when provided", async () => {
    const customSteps: OnboardingStep[] = [
      { id: "custom-1", title: "Custom Step", description: "Do something", skippable: false },
    ];
    const wizard = makeWizard(async () => "completed");
    const result = await wizard.run({ steps: customSteps });
    expect(result.stepsCompleted).toContain("custom-1");
  });

  it("isComplete() reflects state after run", async () => {
    const wizard = makeWizard(async () => "completed");
    expect(wizard.isComplete()).toBe(false);
    await wizard.run();
    expect(wizard.isComplete()).toBe(true);
  });

  it("reset() clears completion state", async () => {
    const wizard = makeWizard(async () => "completed");
    await wizard.run();
    wizard.reset();
    expect(wizard.isComplete()).toBe(false);
  });
});
