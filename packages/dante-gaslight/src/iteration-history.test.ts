import { describe, it, expect, beforeEach } from "vitest";
import { IterationHistory } from "./iteration-history.js";
import type { GaslightCritique } from "./types.js";

describe("IterationHistory", () => {
  let history: IterationHistory;

  beforeEach(() => {
    history = new IterationHistory();
  });

  it("starts empty", () => {
    expect(history.count()).toBe(0);
    expect(history.last()).toBeUndefined();
  });

  it("records drafts with incrementing iteration number", () => {
    history.recordDraft("Draft 1");
    history.recordDraft("Draft 2");
    const records = history.getRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.iteration).toBe(1);
    expect(records[1]?.iteration).toBe(2);
    expect(records[0]?.draft).toBe("Draft 1");
  });

  it("attaches critique to last record", () => {
    history.recordDraft("Draft");
    const critique: GaslightCritique = {
      iteration: 1,
      points: [{ aspect: "shallow-reasoning", description: "Too shallow", severity: "high" }],
      summary: "Needs work",
      needsEvidenceEscalation: false,
      at: new Date().toISOString(),
    };
    history.attachCritique(critique);
    expect(history.last()?.critique?.summary).toBe("Needs work");
  });

  it("attaches gate result to last record", () => {
    history.recordDraft("Draft");
    history.attachGateResult("pass", 0.9, 250);
    const last = history.last();
    expect(last?.gateDecision).toBe("pass");
    expect(last?.gateScore).toBe(0.9);
    expect(last?.tokensUsed).toBe(250);
  });

  it("getRecords returns a copy", () => {
    history.recordDraft("Draft");
    const records = history.getRecords();
    records.push({ iteration: 99, draft: "Injected", at: new Date().toISOString() });
    expect(history.count()).toBe(1);
  });

  it("toSessionIterations matches getRecords", () => {
    history.recordDraft("Draft 1");
    history.recordDraft("Draft 2");
    expect(history.toSessionIterations()).toHaveLength(2);
  });
});
