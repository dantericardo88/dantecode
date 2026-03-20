import { describe, it, expect, beforeEach } from "vitest";
import {
  ReasoningChain,
  type ReasoningPhase,
  type ChainStep,
} from "./reasoning-chain.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makePhase(
  type: ReasoningPhase["type"],
  content: string,
  pdseScore?: number,
): ReasoningPhase {
  return { type, content, pdseScore, timestamp: new Date().toISOString() };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("ReasoningChain", () => {
  let chain: ReasoningChain;

  beforeEach(() => {
    chain = new ReasoningChain();
  });

  // --------------------------------------------------------------------------
  // 1. Constructor & Defaults (3 tests)
  // --------------------------------------------------------------------------

  describe("constructor & defaults", () => {
    it("uses default options when none are provided", () => {
      // Verify defaults by checking behavior they control
      // critiqueEveryNTurns = 5: step 5 should trigger critique
      for (let i = 0; i < 5; i++) {
        chain.recordStep(makePhase("thinking", `step ${i}`));
      }
      expect(chain.shouldCritique()).toBe(true);
    });

    it("accepts custom options", () => {
      const custom = new ReasoningChain({ critiqueEveryNTurns: 2 });
      custom.recordStep(makePhase("thinking", "one"));
      custom.recordStep(makePhase("thinking", "two"));
      expect(custom.shouldCritique()).toBe(true);
    });

    it("merges partial options with defaults", () => {
      const custom = new ReasoningChain({ maxChainDepth: 100 });
      // critiqueEveryNTurns should still be default (5)
      for (let i = 0; i < 5; i++) {
        custom.recordStep(makePhase("thinking", `step ${i}`));
      }
      expect(custom.shouldCritique()).toBe(true);

      // autoEscalateThreshold should still be default (0.75)
      const critique = custom.selfCritique(makePhase("thinking", "test"), 0.74);
      expect(critique.shouldEscalate).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. decideTier (4 tests)
  // --------------------------------------------------------------------------

  describe("decideTier", () => {
    it("returns 'quick' for simple tasks (complexity < 0.3)", () => {
      const tier = chain.decideTier(0.2, { errorCount: 2, toolCalls: 10 });
      expect(tier).toBe("quick");
      expect(chain.getCurrentTier()).toBe("quick");
    });

    it("returns 'quick' when no errors and few tool calls", () => {
      const tier = chain.decideTier(0.5, { errorCount: 0, toolCalls: 3 });
      expect(tier).toBe("quick");
    });

    it("returns 'deep' for moderate complexity", () => {
      const tier = chain.decideTier(0.5, { errorCount: 1, toolCalls: 10 });
      expect(tier).toBe("deep");
    });

    it("returns 'expert' for high complexity with many errors", () => {
      const tier = chain.decideTier(0.9, { errorCount: 5, toolCalls: 20 });
      expect(tier).toBe("expert");
    });
  });

  // --------------------------------------------------------------------------
  // 3. think (3 tests)
  // --------------------------------------------------------------------------

  describe("think", () => {
    it("generates quick thinking with direct approach", () => {
      const phase = chain.think("fix auth bug", "login fails", "quick");
      expect(phase.type).toBe("thinking");
      expect(phase.content).toContain("Consider the most direct approach to:");
      expect(phase.content).toContain("fix auth bug");
      expect(phase.content).toContain("Context: login fails");
    });

    it("generates deep thinking with step-by-step analysis", () => {
      const phase = chain.think("refactor module", "perf issues", "deep");
      expect(phase.content).toContain("Analyze step-by-step:");
      expect(phase.content).toContain("What tools/files are needed");
      expect(phase.content).toContain("refactor module");
    });

    it("generates expert thinking with decomposition", () => {
      const phase = chain.think("redesign API", "breaking changes", "expert");
      expect(phase.content).toContain("Deep analysis required:");
      expect(phase.content).toContain("Decompose the problem");
      expect(phase.content).toContain("Plan verification strategy");
      expect(phase.content).toContain("redesign API");
    });
  });

  // --------------------------------------------------------------------------
  // 4. selfCritique (5 tests)
  // --------------------------------------------------------------------------

  describe("selfCritique", () => {
    it("does not escalate for high scores (>= 0.9)", () => {
      const result = chain.selfCritique(makePhase("thinking", "solid plan"), 0.95);
      expect(result.shouldEscalate).toBe(false);
      expect(result.rootCause).toBeUndefined();
      expect(result.recommendation).toBe("Proceed with current approach");
    });

    it("escalates and identifies root cause for low scores", () => {
      const thought = makePhase("thinking", "wrong approach used for the method");
      const result = chain.selfCritique(thought, 0.4);
      expect(result.shouldEscalate).toBe(true);
      expect(result.rootCause).toBe("wrong approach");
      expect(result.recommendation).toContain("Escalate");
    });

    it("respects the autoEscalateThreshold boundary", () => {
      const thought = makePhase("thinking", "some analysis");
      // Exactly at threshold → not escalated
      const atThreshold = chain.selfCritique(thought, 0.75);
      expect(atThreshold.shouldEscalate).toBe(false);

      // Just below threshold → escalated
      const belowThreshold = chain.selfCritique(thought, 0.74);
      expect(belowThreshold.shouldEscalate).toBe(true);
    });

    it("returns appropriate recommendation text per score range", () => {
      const thought = makePhase("thinking", "test");

      const r1 = chain.selfCritique(thought, 0.92);
      expect(r1.recommendation).toBe("Proceed with current approach");

      const r2 = chain.selfCritique(thought, 0.85);
      expect(r2.recommendation).toBe("Minor adjustments recommended");

      const r3 = chain.selfCritique(thought, 0.76);
      expect(r3.recommendation).toBe("Re-evaluate approach — consider alternative strategies");

      const r4 = chain.selfCritique(thought, 0.5);
      expect(r4.recommendation).toContain("Escalate to higher reasoning tier");
    });

    it("uses context in root cause analysis when provided", () => {
      const thought = makePhase("thinking", "some analysis");
      const result = chain.selfCritique(thought, 0.6, "missing context about the data layer");
      expect(result.rootCause).toBe("missing context");
    });
  });

  // --------------------------------------------------------------------------
  // 5. shouldCritique (3 tests)
  // --------------------------------------------------------------------------

  describe("shouldCritique", () => {
    it("returns false when no steps have been recorded", () => {
      expect(chain.shouldCritique()).toBe(false);
    });

    it("returns true at the critique interval", () => {
      // Default critiqueEveryNTurns = 5
      for (let i = 0; i < 5; i++) {
        chain.recordStep(makePhase("thinking", `step ${i}`));
      }
      expect(chain.getStepCount()).toBe(5);
      expect(chain.shouldCritique()).toBe(true);
    });

    it("returns false between intervals", () => {
      chain.recordStep(makePhase("thinking", "one"));
      chain.recordStep(makePhase("thinking", "two"));
      chain.recordStep(makePhase("thinking", "three"));
      expect(chain.getStepCount()).toBe(3);
      expect(chain.shouldCritique()).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 6. distillPlaybook (4 tests)
  // --------------------------------------------------------------------------

  describe("distillPlaybook", () => {
    it("extracts bullets from successful steps (pdseScore >= 0.85)", () => {
      const steps: ChainStep[] = [
        { stepNumber: 1, phase: makePhase("thinking", "used AST parser for code analysis", 0.90), escalated: false },
        { stepNumber: 2, phase: makePhase("thinking", "tried regex matching", 0.60), escalated: false },
        { stepNumber: 3, phase: makePhase("thinking", "applied semantic search for file discovery", 0.88), escalated: false },
      ];
      const bullets = chain.distillPlaybook(steps);
      expect(bullets).toHaveLength(2);
      expect(bullets[0]).toContain("AST parser");
      expect(bullets[1]).toContain("semantic search");
    });

    it("deduplicates similar bullets via Jaccard similarity", () => {
      // Entry 1 tokens (>2 chars): used, ast, parser, code, analysis, review, module, structure
      // Entry 2 tokens (>2 chars): used, ast, parser, code, analysis, review, module, layout
      // Intersection: 7, Union: 9, Jaccard: 7/9 ≈ 0.78 — too low. Need more overlap.
      // So we use entries with 10 tokens sharing 9:
      const steps: ChainStep[] = [
        { stepNumber: 1, phase: makePhase("thinking", "used the advanced AST parser for deep code analysis review and module structure scanning", 0.90), escalated: false },
        { stepNumber: 2, phase: makePhase("thinking", "used the advanced AST parser for deep code analysis review and module layout scanning", 0.92), escalated: false },
        { stepNumber: 3, phase: makePhase("thinking", "completely different strategy with docker containers deployed production", 0.95), escalated: false },
      ];
      // Entry 1 tokens: used, the, advanced, ast, parser, for, deep, code, analysis, review, and, module, structure, scanning (14 tokens, but "the" is 3 chars so kept, "for" 3 chars kept, "and" 3 chars kept, "ast" 3 chars kept)
      // Entry 2 tokens: same except "layout" instead of "structure" → 13 shared / 15 union ≈ 0.87 > 0.8
      const bullets = chain.distillPlaybook(steps);
      expect(bullets).toHaveLength(2);
      expect(bullets.some((b) => b.includes("docker"))).toBe(true);
    });

    it("returns at most 5 bullets", () => {
      // Each entry uses completely different words to avoid Jaccard dedup
      const phrases = [
        "alpha bravo charlie delta echo foxtrot",
        "golf hotel india juliet kilo lima",
        "mike november oscar papa quebec romeo",
        "sierra tango uniform victor whiskey xray",
        "zulu amber bronze copper diamond emerald",
        "falcon granite horizon ivory jasper kelvin",
        "lunar marble nebula opaque prism quartz",
        "radiant sapphire topaz umbra velvet wisteria",
        "xenon yarrow zenith aurora borealis cascade",
        "driftwood ember flicker glacial harvest indigo",
      ];
      const steps: ChainStep[] = phrases.map((phrase, i) => ({
        stepNumber: i + 1,
        phase: makePhase("thinking", phrase, 0.90),
        escalated: false,
      }));
      const bullets = chain.distillPlaybook(steps);
      // All 10 are unique, but capped at 5
      expect(bullets).toHaveLength(5);
    });

    it("returns empty array when no steps meet threshold", () => {
      const steps: ChainStep[] = [
        { stepNumber: 1, phase: makePhase("thinking", "bad plan", 0.40), escalated: false },
        { stepNumber: 2, phase: makePhase("thinking", "another bad plan", 0.50), escalated: false },
      ];
      const bullets = chain.distillPlaybook(steps);
      expect(bullets).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 7. recordStep (3 tests)
  // --------------------------------------------------------------------------

  describe("recordStep", () => {
    it("increments step counter", () => {
      expect(chain.getStepCount()).toBe(0);
      chain.recordStep(makePhase("thinking", "first"));
      expect(chain.getStepCount()).toBe(1);
      chain.recordStep(makePhase("action", "second"));
      expect(chain.getStepCount()).toBe(2);
    });

    it("stores step in history", () => {
      chain.recordStep(makePhase("thinking", "hello"));
      const history = chain.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0]!.phase.content).toBe("hello");
    });

    it("includes all provided fields", () => {
      const step = chain.recordStep(
        makePhase("critique", "analysis", 0.72),
        "missing context",
        ["use AST parser", "check imports"],
        true,
      );
      expect(step.stepNumber).toBe(1);
      expect(step.phase.type).toBe("critique");
      expect(step.rootCause).toBe("missing context");
      expect(step.playbookBullets).toEqual(["use AST parser", "check imports"]);
      expect(step.escalated).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 8. formatChainForPrompt (3 tests)
  // --------------------------------------------------------------------------

  describe("formatChainForPrompt", () => {
    it("formats phases with type prefixes", () => {
      chain.recordStep(makePhase("thinking", "analyze the problem"));
      chain.recordStep({ type: "critique", content: "needs more depth", pdseScore: 0.85, timestamp: new Date().toISOString() });
      chain.recordStep(makePhase("action", "edit file.ts"));
      chain.recordStep(makePhase("observe", "tests pass"));

      const formatted = chain.formatChainForPrompt();
      expect(formatted).toContain("[Think] analyze the problem");
      expect(formatted).toContain("[Critique PDSE=0.85] needs more depth");
      expect(formatted).toContain("[Act] edit file.ts");
      expect(formatted).toContain("[Observe] tests pass");
    });

    it("respects the limit parameter", () => {
      for (let i = 0; i < 10; i++) {
        chain.recordStep(makePhase("thinking", `step ${i}`));
      }
      const formatted = chain.formatChainForPrompt(3);
      const lines = formatted.split("\n");
      expect(lines).toHaveLength(3);
      // Should show the last 3 steps (7, 8, 9)
      expect(lines[0]).toContain("step 7");
      expect(lines[2]).toContain("step 9");
    });

    it("returns empty string for empty chain", () => {
      expect(chain.formatChainForPrompt()).toBe("");
    });
  });

  // --------------------------------------------------------------------------
  // 9. reset (2 tests)
  // --------------------------------------------------------------------------

  describe("reset", () => {
    it("clears history and step counter", () => {
      chain.recordStep(makePhase("thinking", "first"));
      chain.recordStep(makePhase("action", "second"));
      expect(chain.getStepCount()).toBe(2);
      expect(chain.getHistory()).toHaveLength(2);

      chain.reset();

      expect(chain.getStepCount()).toBe(0);
      expect(chain.getHistory()).toHaveLength(0);
    });

    it("resets tier back to quick", () => {
      chain.decideTier(0.9, { errorCount: 5, toolCalls: 20 });
      expect(chain.getCurrentTier()).toBe("expert");

      chain.reset();

      expect(chain.getCurrentTier()).toBe("quick");
    });
  });

  // --------------------------------------------------------------------------
  // 10. verifyPhase (2 tests)
  // --------------------------------------------------------------------------

  describe("verifyPhase", () => {
    it("scores a reasoning phase, records it, and keeps the current tier when quality is high", () => {
      const phase = makePhase(
        "thinking",
        "Steps\n1. Inspect the deploy script.\n2. Confirm rollback instructions and health checks.",
      );

      const result = chain.verifyPhase("Provide deployment steps and rollback guidance", phase, {
        criteria: {
          requiredKeywords: ["deploy", "rollback"],
          expectedSections: ["Steps"],
          minLength: 50,
        },
      });

      expect(result.report.overallPassed).toBe(true);
      expect(result.step.phase.pdseScore).toBeGreaterThan(0.85);
      expect(result.critique.shouldEscalate).toBe(false);
      expect(result.tierAfterReview).toBe("quick");
      expect(chain.getHistory()).toHaveLength(1);
    });

    it("auto-escalates the tier when verification exposes a weak reasoning phase", () => {
      const phase = makePhase("thinking", "TODO: missing context for the analysis");

      const result = chain.verifyPhase("Explain the incident response flow", phase, {
        criteria: {
          requiredKeywords: ["incident", "response"],
          minLength: 60,
        },
      });

      expect(result.report.overallPassed).toBe(false);
      expect(result.critique.shouldEscalate).toBe(true);
      expect(result.step.rootCause).toBe("missing context");
      expect(result.tierAfterReview).toBe("deep");
      expect(chain.getCurrentTier()).toBe("deep");
    });
  });
});
