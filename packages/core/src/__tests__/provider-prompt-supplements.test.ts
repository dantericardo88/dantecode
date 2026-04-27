// packages/core/src/__tests__/provider-prompt-supplements.test.ts
// Sprint 2 — Prompt Hardening: verify tool-only-turn enforcement in Grok supplement and strict mode

import { describe, it, expect } from "vitest";
import {
  getProviderPromptSupplement,
  getStrictModeAddition,
} from "../provider-prompt-supplements.js";

describe("getProviderPromptSupplement — Grok", () => {
  it("contains TOOL-ONLY TURNS enforcement clause", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("TOOL-ONLY TURNS");
  });

  it("prohibits inline epilogue after </tool_use>", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("</tool_use>");
    expect(s).toContain("fabrication event");
  });

  it("also matches provider key 'xai'", () => {
    const s = getProviderPromptSupplement("xai");
    expect(s).toContain("TOOL-ONLY TURNS");
  });
});

describe("getProviderPromptSupplement — Grok mid-task stop prevention", () => {
  it("contains MID-TASK STOP rule", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("MID-TASK STOP");
  });

  it("contains 'not attempted' language", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("not attempted");
  });

  it("Claude/Anthropic supplement does NOT contain MID-TASK STOP", () => {
    const s = getProviderPromptSupplement("anthropic/claude-sonnet-4-6");
    expect(s).not.toContain("MID-TASK STOP");
  });
});

describe("getProviderPromptSupplement — other providers", () => {
  it("Claude/Anthropic supplement does NOT contain TOOL-ONLY TURNS", () => {
    const s = getProviderPromptSupplement("anthropic/claude-sonnet-4-6");
    expect(s).not.toContain("TOOL-ONLY TURNS");
  });

  it("OpenAI supplement does NOT contain TOOL-ONLY TURNS", () => {
    const s = getProviderPromptSupplement("openai/gpt-4o");
    expect(s).not.toContain("TOOL-ONLY TURNS");
  });
});

describe("getProviderPromptSupplement — Grok task-completion stop rules", () => {
  it("contains TASK-COMPLETE SIGNAL", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("TASK-COMPLETE SIGNAL");
  });

  it("contains STOP CRITERIA", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("STOP CRITERIA");
  });

  it("contains double-check language", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("double-check");
  });

  it("Claude supplement does NOT contain TASK-COMPLETE SIGNAL", () => {
    const s = getProviderPromptSupplement("anthropic/claude-sonnet-4-6");
    expect(s).not.toContain("TASK-COMPLETE SIGNAL");
  });
});

describe("getProviderPromptSupplement — Grok failure triage taxonomy", () => {
  it("contains FAILURE TRIAGE", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("FAILURE TRIAGE");
  });

  it("contains TRANSIENT", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("TRANSIENT");
  });

  it("contains LOGIC ERROR", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("LOGIC ERROR");
  });

  it("contains PERMANENT", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("PERMANENT");
  });

  it("Claude supplement does NOT contain FAILURE TRIAGE", () => {
    const s = getProviderPromptSupplement("anthropic/claude-sonnet-4-6");
    expect(s).not.toContain("FAILURE TRIAGE");
  });
});

describe("getProviderPromptSupplement — Grok truncated output rule (Rule 16)", () => {
  it("contains TRUNCATED TOOL OUTPUT rule", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("TRUNCATED TOOL OUTPUT");
  });

  it("prohibits inventing results from truncated output", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("[TRUNCATED —]");
  });

  it("requires reporting truncation verbatim, not summarizing", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("do NOT invent what the remaining output");
  });

  it("classifies truncation fabrication as fabrication-class event", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("Inventing results from a truncated command");
  });

  it("Claude supplement does NOT contain TRUNCATED TOOL OUTPUT", () => {
    const s = getProviderPromptSupplement("anthropic/claude-sonnet-4-6");
    expect(s).not.toContain("TRUNCATED TOOL OUTPUT");
  });
});

describe("getProviderPromptSupplement — Grok improvement verification rule (Rule 17)", () => {
  it("contains IMPROVEMENT VERIFICATION rule", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("IMPROVEMENT VERIFICATION");
  });

  it("requires danteforge score after improvement commands", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("danteforge score --level light");
  });

  it("covers danteforge ascend and autoforge commands", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("danteforge ascend");
    expect(s).toContain("danteforge autoforge");
  });

  it("prohibits claiming success without verified score delta", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("never claim success without");
  });

  it("Claude supplement does NOT contain IMPROVEMENT VERIFICATION", () => {
    const s = getProviderPromptSupplement("anthropic/claude-sonnet-4-6");
    expect(s).not.toContain("IMPROVEMENT VERIFICATION");
  });
});

describe("getProviderPromptSupplement — Grok stale report files rule (Rule 18)", () => {
  it("contains STALE REPORT FILES rule", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("STALE REPORT FILES");
  });

  it("references ASCEND_REPORT.md as a stale artifact", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("ASCEND_REPORT.md");
  });

  it("requires live score before presenting report data", () => {
    const s = getProviderPromptSupplement("xai/grok-3");
    expect(s).toContain("danteforge score --level light");
  });

  it("classifies presenting stale data as fabrication", () => {
    const s = getProviderPromptSupplement("grok-4");
    expect(s).toContain("fabrication-class event");
  });

  it("Claude supplement does NOT contain STALE REPORT FILES", () => {
    const s = getProviderPromptSupplement("anthropic/claude-sonnet-4-6");
    expect(s).not.toContain("STALE REPORT FILES");
  });
});

describe("getStrictModeAddition", () => {
  it("contains tool-only-turn enforcement", () => {
    const s = getStrictModeAddition(3);
    expect(s).toContain("ONLY with tool calls");
    expect(s).toContain("</tool_use>");
  });

  it("still contains VERIFICATION AUDIT language", () => {
    const s = getStrictModeAddition(2);
    expect(s).toContain("VERIFICATION AUDIT:");
    expect(s).toContain("STRICT VERIFICATION MODE");
  });

  it("mentions the correct consecutive fabrication count", () => {
    expect(getStrictModeAddition(1)).toContain("last 1 response");
    expect(getStrictModeAddition(4)).toContain("last 4 responses");
  });

  it("states that post-</tool_use> text counts as fabrication", () => {
    const s = getStrictModeAddition(3);
    expect(s).toContain("counted as another fabrication");
  });
});
