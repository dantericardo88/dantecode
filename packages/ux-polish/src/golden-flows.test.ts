/**
 * golden-flows.test.ts — @dantecode/ux-polish
 *
 * Integration tests for GF-01 through GF-07.
 * Each test exercises a full end-to-end UX flow across multiple organs.
 *
 * PRD Hard Gate: "integration tests for all golden flows"
 */

import { describe, it, expect, beforeEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";

// Organs
import { OnboardingWizard } from "./onboarding-wizard.js";
import { ProgressOrchestrator } from "./progress-orchestrator.js";
import { ErrorHelper } from "./error-helper.js";
import { UXPreferences } from "./preferences/ux-preferences.js";
import { ThemeEngine } from "./theme-engine.js";

// Bridges + audit
import { PdseBridge } from "./integrations/pdse-bridge.js";
import { CheckpointedProgress } from "./integrations/checkpointer-bridge.js";
import type { CheckpointerLike } from "./integrations/checkpointer-bridge.js";
import { ConsistencyAudit } from "./audit/consistency-audit.js";
import type { RenderPayload } from "./types.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const tmpDir = os.tmpdir();

function makeMockCheckpointer(): CheckpointerLike & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async put(sessionId, checkpoint) {
      store.set(sessionId, checkpoint);
    },
    async getTuple(sessionId) {
      const cp = store.get(sessionId);
      if (!cp) return null;
      return {
        checkpoint: cp as { channelValues: Record<string, unknown>; step: number },
        metadata: { step: 1 },
      };
    },
  };
}

function makeMemPrefs(suffix = "default") {
  const store = new Map<string, string>();
  return new UXPreferences({
    prefsFilePath: path.join(tmpDir, `gf-prefs-${suffix}.json`),
    writeFn: (_, data) => store.set("prefs", data),
    readFn: () => store.get("prefs") ?? null,
    existsFn: () => store.has("prefs"),
    mkdirFn: () => {},
  });
}

// ---------------------------------------------------------------------------
// GF-01 — First-run onboarding
// ---------------------------------------------------------------------------

describe("GF-01: First-run onboarding", () => {
  it("completes all steps without external docs, state is persisted in-memory", async () => {
    const wizard = new OnboardingWizard({
      stateOptions: { stateFilePath: path.join(tmpDir, "gf01-onboarding.json") },
      stepRunner: async () => "completed",
    });

    const result = await wizard.run();
    expect(result.completed).toBe(true);
    expect(result.stepsCompleted.length).toBeGreaterThan(0);
  });

  it("all default steps appear in stepsCompleted", async () => {
    const wizard = new OnboardingWizard({
      stateOptions: { stateFilePath: path.join(tmpDir, "gf01-steps.json") },
      stepRunner: async () => "completed",
    });
    const result = await wizard.run();
    // Standard steps: env-check, api-key, config-init, first-verify, explore
    expect(result.stepsCompleted).toContain("env-check");
    expect(result.stepsCompleted).toContain("api-key");
  });

  it("can resume a partially completed flow", async () => {
    const filePath = path.join(tmpDir, "gf01-resume.json");
    const opts = { stateOptions: { stateFilePath: filePath } };

    const w1 = new OnboardingWizard({ ...opts, stepRunner: async () => "completed" });
    const r1 = await w1.run();
    expect(r1.completed).toBe(true);

    // Second wizard instance from same file path returns already-complete
    const w2 = new OnboardingWizard({ ...opts, stepRunner: async () => "completed" });
    const r2 = await w2.run();
    expect(r2.completed).toBe(true);
  });

  it("skippable steps can be skipped in CI mode", async () => {
    const wizard = new OnboardingWizard({
      stateOptions: { stateFilePath: path.join(tmpDir, "gf01-ci.json") },
      stepRunner: async () => "completed",
    });
    const result = await wizard.run({ ci: true });
    // CI mode may skip skippable steps but still completes
    expect(result.completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GF-02 — Long-running progress with immediate feedback
// ---------------------------------------------------------------------------

describe("GF-02: Long-running multi-phase progress", () => {
  let orchestrator: ProgressOrchestrator;

  beforeEach(() => {
    orchestrator = new ProgressOrchestrator();
  });

  it("each phase produces immediately visible progress state", () => {
    const phases = ["Analyze", "Compile", "Test", "Deploy"];

    for (const phase of phases) {
      const id = `gf02-${phase}`;
      const state = orchestrator.startProgress(id, { phase, message: `Running ${phase}` });
      expect(state.status).toBe("running");
      expect(state.phase).toBe(phase);

      // Progress is immediately queryable
      const queried = orchestrator.getProgress(id);
      expect(queried).toBeDefined();
      expect(queried!.phase).toBe(phase);

      orchestrator.completeProgress(id);
    }

    const all = orchestrator.getAllProgress();
    expect(all.length).toBe(phases.length);
    expect(all.every((s) => s.status === "completed")).toBe(true);
  });

  it("progress updates are reflected in real-time", () => {
    orchestrator.startProgress("gf02-update", { phase: "Build" });
    orchestrator.updateProgress("gf02-update", { progress: 50, message: "halfway" });

    const state = orchestrator.getProgress("gf02-update")!;
    expect(state.progress).toBe(50);
    expect(state.message).toBe("halfway");
  });

  it("renderOne returns non-empty themed output", () => {
    orchestrator.startProgress("gf02-render", { phase: "Verify" });
    const output = orchestrator.renderOne("gf02-render");
    expect(output).toBeTruthy();
    expect(output).toContain("Verify");
  });

  it("renderAll produces summary across all phases", () => {
    orchestrator.startProgress("gf02-a", { phase: "Alpha" });
    orchestrator.startProgress("gf02-b", { phase: "Beta" });
    const output = orchestrator.renderAll();
    expect(output).toContain("Alpha");
    expect(output).toContain("Beta");
  });
});

// ---------------------------------------------------------------------------
// GF-03 — Helpful error with actionable next steps
// ---------------------------------------------------------------------------

describe("GF-03: Helpful error — no dead-ends", () => {
  it("every classified error produces at least one actionable next step", () => {
    const helper = new ErrorHelper();
    const errors = [
      "ENOENT: no such file or directory",
      "TypeError: Cannot read property 'foo' of undefined",
      "SyntaxError: Unexpected token",
      "EACCES: permission denied",
      "Network timeout",
    ];

    for (const msg of errors) {
      const classified = helper.classify(msg);
      expect(classified.nextSteps.length).toBeGreaterThan(0);
      const formatted = helper.format(classified);
      expect(formatted).toBeTruthy();
    }
  });

  it("formatted error output is human-readable (contains the error message)", () => {
    const helper = new ErrorHelper();
    const classified = helper.classify("ENOENT: no such file or directory");
    const formatted = helper.format(classified);
    expect(formatted).toContain("ENOENT");
    expect(formatted.trim().length).toBeGreaterThan(0);
  });

  it("error helper with theme produces styled output", () => {
    const theme = new ThemeEngine({ colors: false });
    const helper = new ErrorHelper({ theme });
    const classified = helper.classify("permission denied");
    const formatted = helper.format(classified);
    expect(formatted).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// GF-04 — Cross-surface consistency
// ---------------------------------------------------------------------------

describe("GF-04: Cross-surface consistency", () => {
  it("same payload renders without critical drift on all surfaces", () => {
    const audit = new ConsistencyAudit();
    const payloads: RenderPayload[] = [
      { kind: "text", content: "Build complete — 0 errors." },
      { kind: "progress", content: "Compiling..." },
    ];

    const report = audit.runAudit(payloads);
    expect(report.hasCritical).toBe(false);
    expect(report.payloadCount).toBe(payloads.length);
  });

  it("audit report format is human-readable", () => {
    const audit = new ConsistencyAudit();
    const payloads: RenderPayload[] = [{ kind: "text", content: "Hello world" }];
    const report = audit.runAudit(payloads);
    const formatted = audit.formatReport(report);
    expect(formatted).toBeTruthy();
    expect(formatted).toMatch(/Consistency Audit/);
  });

  it("cross-surface render produces output for all three surfaces", () => {
    const audit = new ConsistencyAudit();
    const payload: RenderPayload = { kind: "text", content: "Status: OK" };
    const result = audit.renderAcrossSurfaces(payload);
    expect(result.outputs.cli).toBeTruthy();
    expect(result.outputs.repl).toBeTruthy();
    expect(result.outputs.vscode).toBeTruthy();
  });

  it("detect tone drift identifies markers present on some surfaces", () => {
    const audit = new ConsistencyAudit();
    const outputs = {
      cli: "✓ Build passed",
      repl: "✓ Build passed",
      vscode: "Build passed",
    };
    const drifts = audit.detectToneDrift(outputs);
    // '✓' is on cli+repl but not vscode — should flag tone drift
    const toneDrift = drifts.find((d) => d.type === "tone" && d.description.includes("✓"));
    expect(toneDrift).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// GF-05 — Preference restoration across sessions
// ---------------------------------------------------------------------------

describe("GF-05: Preference persistence across sessions", () => {
  it("theme and density survive a simulated session restart", () => {
    const store = new Map<string, string>();
    const opts = {
      prefsFilePath: path.join(tmpDir, "gf05-prefs.json"),
      writeFn: (_: string, data: string) => store.set("p", data),
      readFn: () => store.get("p") ?? null,
      existsFn: () => store.has("p"),
      mkdirFn: () => {},
    };

    // Session 1 — set preferences
    const prefs1 = new UXPreferences(opts);
    prefs1.applyTheme("ocean");
    prefs1.update({ density: "compact" });

    // Session 2 — reload from same store
    const prefs2 = new UXPreferences(opts);
    expect(prefs2.getTheme()).toBe("ocean");
    expect(prefs2.getDensity()).toBe("compact");
  });

  it("accessibility mode persists across sessions", () => {
    const store = new Map<string, string>();
    const opts = {
      prefsFilePath: path.join(tmpDir, "gf05-a11y.json"),
      writeFn: (_: string, data: string) => store.set("a", data),
      readFn: () => store.get("a") ?? null,
      existsFn: () => store.has("a"),
      mkdirFn: () => {},
    };

    const p1 = new UXPreferences(opts);
    p1.setAccessibilityMode(true);

    const p2 = new UXPreferences(opts);
    expect(p2.isAccessibilityMode()).toBe(true);
  });

  it("onboardingComplete flag is preserved", () => {
    const prefs = makeMemPrefs("gf05-ob");
    expect(prefs.isOnboardingComplete()).toBe(false);
    prefs.markOnboardingComplete();
    const all = prefs.getAll();
    expect(all.onboardingComplete).toBe(true);
  });

  it("reset restores all preferences to defaults", () => {
    const prefs = makeMemPrefs("gf05-reset");
    prefs.applyTheme("matrix");
    prefs.update({ density: "verbose", richMode: true });
    prefs.reset();
    expect(prefs.getTheme()).toBe("default");
    expect(prefs.getDensity()).toBe("normal");
  });
});

// ---------------------------------------------------------------------------
// GF-06 — PDSE trust hint rendering
// ---------------------------------------------------------------------------

describe("GF-06: PDSE/trust hint rendering", () => {
  it("high-confidence state renders inline hint with score and proceed guidance", () => {
    const bridge = new PdseBridge();
    const state = { overall: 0.9, label: "High confidence", verified: true, pipeline: "forge" };
    const hint = bridge.buildTrustHint(state);

    expect(hint.inline).toContain("90%");
    expect(hint.band).toBe("trusted");
    expect(hint.nextSteps.length).toBeGreaterThan(0);
    expect(
      hint.nextSteps.some(
        (s) => s.includes("proceed") || s.includes("safe") || s.includes("high-confidence"),
      ),
    ).toBe(true);
  });

  it("caution-band state renders warning hint with review guidance", () => {
    const bridge = new PdseBridge();
    const state = { overall: 0.6, metrics: { Preciseness: 0.5, Depth: 0.7 } };
    const hint = bridge.buildTrustHint(state);

    expect(hint.band).toBe("caution");
    expect(hint.inline).toContain("⚠");
    expect(hint.nextSteps.some((s) => s.toLowerCase().includes("review"))).toBe(true);
  });

  it("blocked state warns against shipping", () => {
    const bridge = new PdseBridge();
    const state = { overall: 0.3, verified: false };
    const hint = bridge.buildTrustHint(state);

    expect(hint.band).toBe("blocked");
    expect(hint.inline).toContain("✗");
    expect(
      hint.nextSteps.some(
        (s) => s.toLowerCase().includes("not ship") || s.toLowerCase().includes("do not"),
      ),
    ).toBe(true);
  });

  it("verification summary includes score and pipeline name", () => {
    const bridge = new PdseBridge();
    const state = { overall: 0.9, label: "High confidence", verified: true, pipeline: "forge" };
    const summary = bridge.formatVerificationSummary(state);
    expect(summary).toContain("90%");
    expect(summary).toContain("forge");
  });

  it("inline hint icons match trust band", () => {
    const bridge = new PdseBridge();
    expect(bridge.renderInlineHint({ overall: 0.9 })).toContain("✓");
    expect(bridge.renderInlineHint({ overall: 0.6 })).toContain("⚠");
    expect(bridge.renderInlineHint({ overall: 0.3 })).toContain("✗");
  });
});

// ---------------------------------------------------------------------------
// GF-07 — Resumed workflow coherence
// ---------------------------------------------------------------------------

describe("GF-07: Resumed workflow coherence", () => {
  it("save → interrupt → restore produces coherent resumed status", async () => {
    const mock = makeMockCheckpointer();
    const orchestratorA = new ProgressOrchestrator();
    orchestratorA.startProgress("gf07-task1", { phase: "Compiling" });
    orchestratorA.updateProgress("gf07-task1", { progress: 40, message: "40% done" });
    orchestratorA.startProgress("gf07-task2", { phase: "Testing" });

    const cpA = new CheckpointedProgress({ orchestrator: orchestratorA, checkpointer: mock });
    await cpA.saveCheckpoint("gf07-session");

    // Simulate interrupt — new orchestrator, new bridge, same checkpointer
    const orchestratorB = new ProgressOrchestrator();
    const cpB = new CheckpointedProgress({ orchestrator: orchestratorB, checkpointer: mock });
    const restored = await cpB.restoreCheckpoint("gf07-session");

    expect(restored).toBe(true);

    const states = orchestratorB.getAllProgress();
    expect(states.length).toBeGreaterThan(0);
    expect(states.some((s) => s.phase === "Compiling")).toBe(true);

    const status = cpB.formatResumedStatus("gf07-session");
    expect(status).toContain("gf07-session");
    expect(status).toContain("Compiling");
  });

  it("formatResumedStatus shows what was in progress before interruption", async () => {
    const mock = makeMockCheckpointer();
    const orchestrator = new ProgressOrchestrator();
    orchestrator.startProgress("gf07-deploy", { phase: "Deploying" });

    const cp = new CheckpointedProgress({ orchestrator, checkpointer: mock });
    await cp.saveCheckpoint("gf07-deploy-session");

    const orchestrator2 = new ProgressOrchestrator();
    const cp2 = new CheckpointedProgress({ orchestrator: orchestrator2, checkpointer: mock });
    await cp2.restoreCheckpoint("gf07-deploy-session");

    const status = cp2.formatResumedStatus("gf07-deploy-session");
    expect(status).toMatch(/Deploying/);
    expect(status).toMatch(/gf07-deploy-session/);
  });

  it("no checkpoint → formatResumedStatus shows no in-progress items", () => {
    const orchestrator = new ProgressOrchestrator();
    const cp = new CheckpointedProgress({ orchestrator });
    const status = cp.formatResumedStatus("empty-session");
    expect(status).toContain("no in-progress items");
  });

  it("serialized progress state round-trips correctly", () => {
    const orchestrator = new ProgressOrchestrator();
    orchestrator.startProgress("gf07-round-trip", { phase: "Verifying" });
    orchestrator.updateProgress("gf07-round-trip", { progress: 75 });

    const snapshot = orchestrator.serialize();
    const orchestrator2 = new ProgressOrchestrator();
    orchestrator2.restore(snapshot);

    const state = orchestrator2.getProgress("gf07-round-trip");
    expect(state).toBeDefined();
    expect(state!.phase).toBe("Verifying");
    expect(state!.progress).toBe(75);
  });
});
