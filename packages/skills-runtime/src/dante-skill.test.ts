import { describe, it, expect } from "vitest";
import type { DanteSkill } from "./dante-skill.js";
import type { SkillProvenance } from "./skill-provenance.js";
import { makeProvenance } from "./skill-provenance.js";
import { makeRunContext, DEFAULT_SKILL_POLICY } from "./skill-run-context.js";
import { makeRunId, assertAppliedBeforeSuccess, type SkillRunResult } from "./skill-run-result.js";
import { runSkill } from "./run-skill.js";
import { emitSkillReceipt } from "./skill-receipt.js";
import { buildSkillReport } from "./skill-report.js";
import { linkToEvidenceChain } from "./skill-ledger-link.js";

// Helper to build a minimal valid DanteSkill
function makeSkill(overrides: Partial<DanteSkill> = {}): DanteSkill {
  const provenance: SkillProvenance = makeProvenance({
    sourceType: "native",
    sourceRef: "/skills/test-skill",
    license: "MIT",
  });
  return {
    name: "test-skill",
    description: "A test skill for unit testing",
    sourceType: "native",
    sourceRef: "/skills/test-skill",
    license: "MIT",
    instructions: "Do something useful here.",
    provenance,
    ...overrides,
  };
}

// Helper to build a minimal valid SkillRunResult
function makeResult(overrides: Partial<SkillRunResult> = {}): SkillRunResult {
  return {
    runId: makeRunId(),
    skillName: "test-skill",
    sourceType: "native",
    mode: "apply",
    state: "applied",
    filesTouched: [],
    commandsRun: [],
    verificationOutcome: "skipped",
    plainLanguageSummary: "Applied skill successfully.",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("DanteSkill interface", () => {
  it("creates a valid skill with all required fields", () => {
    const skill = makeSkill();
    expect(skill.name).toBe("test-skill");
    expect(skill.description).toBe("A test skill for unit testing");
    expect(skill.sourceType).toBe("native");
    expect(skill.sourceRef).toBe("/skills/test-skill");
    expect(skill.license).toBe("MIT");
    expect(skill.instructions).toBe("Do something useful here.");
    expect(skill.provenance).toBeDefined();
  });

  it("accepts optional fields", () => {
    const skill = makeSkill({
      compatibility: ["claude", "codex"],
      allowedTools: ["Read", "Write"],
      metadata: { version: "1.0" },
      scripts: "/skills/test-skill/scripts",
      references: "/skills/test-skill/references",
      assets: "/skills/test-skill/assets",
      disabled: false,
    });
    expect(skill.compatibility).toEqual(["claude", "codex"]);
    expect(skill.allowedTools).toEqual(["Read", "Write"]);
    expect(skill.metadata).toEqual({ version: "1.0" });
    expect(skill.scripts).toBe("/skills/test-skill/scripts");
    expect(skill.disabled).toBe(false);
  });

  it("accepts all source types", () => {
    const sourceTypes = [
      "native",
      "agent-skills",
      "hf",
      "agency-converted",
      "private-pack",
      "codex",
      "cursor",
      "qwen",
    ] as const;
    for (const sourceType of sourceTypes) {
      const skill = makeSkill({ sourceType });
      expect(skill.sourceType).toBe(sourceType);
    }
  });
});

describe("SkillProvenance — makeProvenance", () => {
  it("sets importedAt automatically when not provided", () => {
    const before = new Date().toISOString();
    const prov = makeProvenance({
      sourceType: "hf",
      sourceRef: "huggingface/hf-skills",
      license: "Apache-2.0",
    });
    const after = new Date().toISOString();
    expect(prov.importedAt >= before).toBe(true);
    expect(prov.importedAt <= after).toBe(true);
  });

  it("preserves importedAt when explicitly provided", () => {
    const fixed = "2024-01-01T00:00:00.000Z";
    const prov = makeProvenance({
      sourceType: "native",
      sourceRef: "/local",
      license: "MIT",
      importedAt: fixed,
    });
    expect(prov.importedAt).toBe(fixed);
  });

  it("sets all required fields", () => {
    const prov = makeProvenance({
      sourceType: "agent-skills",
      sourceRef: "https://github.com/agent-skills/repo",
      license: "MIT",
      originalName: "original-skill",
      conversionNotes: "Converted from v1",
      version: "2.0.0",
    });
    expect(prov.sourceType).toBe("agent-skills");
    expect(prov.sourceRef).toBe("https://github.com/agent-skills/repo");
    expect(prov.originalName).toBe("original-skill");
    expect(prov.conversionNotes).toBe("Converted from v1");
    expect(prov.version).toBe("2.0.0");
  });
});

describe("makeRunContext", () => {
  it("applies defaults correctly", () => {
    const ctx = makeRunContext({
      skillName: "my-skill",
      projectRoot: "/project",
    });
    expect(ctx.skillName).toBe("my-skill");
    expect(ctx.projectRoot).toBe("/project");
    expect(ctx.mode).toBe("apply");
    expect(ctx.policy).toBe(DEFAULT_SKILL_POLICY);
  });

  it("allows overriding defaults", () => {
    const ctx = makeRunContext({
      skillName: "my-skill",
      projectRoot: "/project",
      mode: "dry-run",
      dryRun: true,
    });
    expect(ctx.mode).toBe("dry-run");
    expect(ctx.dryRun).toBe(true);
  });

  it("includes sessionId when provided", () => {
    const ctx = makeRunContext({
      skillName: "my-skill",
      projectRoot: "/project",
      sessionId: "sess_abc123",
    });
    expect(ctx.sessionId).toBe("sess_abc123");
  });
});

describe("DEFAULT_SKILL_POLICY", () => {
  it("allowNetwork is false by default", () => {
    expect(DEFAULT_SKILL_POLICY.allowNetwork).toBe(false);
  });

  it("sandboxMode is 'host' by default", () => {
    expect(DEFAULT_SKILL_POLICY.sandboxMode).toBe("host");
  });

  it("maxFileWrites is 50 by default", () => {
    expect(DEFAULT_SKILL_POLICY.maxFileWrites).toBe(50);
  });

  it("allowedTools is empty by default", () => {
    expect(DEFAULT_SKILL_POLICY.allowedTools).toEqual([]);
  });
});

describe("makeRunId", () => {
  it("returns id starting with 'sr_'", () => {
    const id = makeRunId();
    expect(id.startsWith("sr_")).toBe(true);
  });

  it("returns id with 8 hex chars after prefix", () => {
    const id = makeRunId();
    const hex = id.slice(3);
    expect(hex).toHaveLength(8);
    expect(/^[0-9a-f]{8}$/.test(hex)).toBe(true);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => makeRunId()));
    // With 100 IDs from 16^8 = 4 billion possibilities, expect all unique
    expect(ids.size).toBe(100);
  });
});

describe("assertAppliedBeforeSuccess", () => {
  it("throws SKILL-010 when summary says 'success' but state is 'proposed'", () => {
    const result = makeResult({
      state: "proposed",
      plainLanguageSummary: "Operation was a success!",
    });
    expect(() => assertAppliedBeforeSuccess(result)).toThrow("SKILL-010");
  });

  it("throws SKILL-010 when summary says 'success' but state is 'failed'", () => {
    const result = makeResult({
      state: "failed",
      plainLanguageSummary: "This was a success.",
    });
    expect(() => assertAppliedBeforeSuccess(result)).toThrow("SKILL-010");
  });

  it("throws SKILL-010 when summary says 'success' but state is 'partial'", () => {
    const result = makeResult({
      state: "partial",
      plainLanguageSummary: "Partial success achieved",
    });
    expect(() => assertAppliedBeforeSuccess(result)).toThrow("SKILL-010");
  });

  it("does NOT throw when state is 'applied'", () => {
    const result = makeResult({
      state: "applied",
      plainLanguageSummary: "This was a great success!",
    });
    expect(() => assertAppliedBeforeSuccess(result)).not.toThrow();
  });

  it("does NOT throw when state is 'verified'", () => {
    const result = makeResult({
      state: "verified",
      plainLanguageSummary: "Verification success.",
    });
    expect(() => assertAppliedBeforeSuccess(result)).not.toThrow();
  });

  it("does NOT throw when summary doesn't mention 'success'", () => {
    const result = makeResult({
      state: "proposed",
      plainLanguageSummary: "Proposed skill for review.",
    });
    expect(() => assertAppliedBeforeSuccess(result)).not.toThrow();
  });
});

describe("runSkill — instruction-only", () => {
  it("returns state 'applied' for instruction-only skill", async () => {
    const skill = makeSkill();
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const result = await runSkill({ skill, context });
    expect(result.state).toBe("applied");
  });

  it("plainLanguageSummary doesn't say 'success' in a misleading context", async () => {
    const skill = makeSkill();
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const result = await runSkill({ skill, context });
    // result.state is "applied" so no SKILL-010 violation
    expect(() => assertAppliedBeforeSuccess(result)).not.toThrow();
  });

  it("returns correct runId format", async () => {
    const skill = makeSkill();
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const result = await runSkill({ skill, context });
    expect(result.runId.startsWith("sr_")).toBe(true);
  });

  it("returns empty filesTouched and commandsRun", async () => {
    const skill = makeSkill();
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const result = await runSkill({ skill, context });
    expect(result.filesTouched).toEqual([]);
    expect(result.commandsRun).toEqual([]);
  });

  it("returns verificationOutcome 'skipped' for instruction-only", async () => {
    const skill = makeSkill();
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const result = await runSkill({ skill, context });
    expect(result.verificationOutcome).toBe("skipped");
  });
});

describe("runSkill — dry-run", () => {
  it("returns state 'proposed' when dryRun is true", async () => {
    const skill = makeSkill();
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
      dryRun: true,
    });
    const result = await runSkill({ skill, context });
    expect(result.state).toBe("proposed");
  });

  it("includes 'review instructions' in dry-run summary", async () => {
    const skill = makeSkill();
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
      dryRun: true,
    });
    const result = await runSkill({ skill, context });
    expect(result.plainLanguageSummary).toContain("review instructions");
  });
});

describe("runSkill — with scriptRunner", () => {
  it("returns state 'applied' with commandsRun populated on success", async () => {
    const skill = makeSkill({ scripts: "/skills/test-skill/scripts" });
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const scriptRunner = async (_path: string, _ctx: typeof context) => [
      "npm run lint",
      "npm test",
    ];
    const result = await runSkill({ skill, context, scriptRunner });
    expect(result.state).toBe("applied");
    expect(result.commandsRun).toEqual(["npm run lint", "npm test"]);
  });

  it("returns state 'failed' and failureReason with SKILL-007 on error", async () => {
    const skill = makeSkill({ scripts: "/skills/test-skill/scripts" });
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const scriptRunner = async (_path: string, _ctx: typeof context) => {
      throw new Error("Command not found: foobar");
    };
    const result = await runSkill({ skill, context, scriptRunner });
    expect(result.state).toBe("failed");
    expect(result.failureReason).toContain("SKILL-007");
    expect(result.failureReason).toContain("Command not found: foobar");
  });

  it("verificationOutcome is 'fail' when script fails", async () => {
    const skill = makeSkill({ scripts: "/skills/test-skill/scripts" });
    const context = makeRunContext({
      skillName: "test-skill",
      projectRoot: "/project",
    });
    const scriptRunner = async () => {
      throw new Error("Script error");
    };
    const result = await runSkill({ skill, context, scriptRunner });
    expect(result.verificationOutcome).toBe("fail");
  });
});

describe("emitSkillReceipt", () => {
  it("produces receipt with correct receiptId prefix 'rcpt_'", () => {
    const result = makeResult();
    const receipt = emitSkillReceipt(result);
    expect(receipt.receiptId.startsWith("rcpt_")).toBe(true);
  });

  it("throws SKILL-007 when runId is empty", () => {
    const result = makeResult({ runId: "" });
    expect(() => emitSkillReceipt(result)).toThrow("SKILL-007");
  });

  it("copies filesTouched from result", () => {
    const result = makeResult({ filesTouched: ["/a/b.ts", "/c/d.ts"] });
    const receipt = emitSkillReceipt(result);
    expect(receipt.filesTouched).toEqual(["/a/b.ts", "/c/d.ts"]);
  });

  it("copies commandsRun from result", () => {
    const result = makeResult({ commandsRun: ["npm test", "npm lint"] });
    const receipt = emitSkillReceipt(result);
    expect(receipt.commandsRun).toEqual(["npm test", "npm lint"]);
  });

  it("creates a defensive copy of filesTouched (not same reference)", () => {
    const files = ["/a.ts"];
    const result = makeResult({ filesTouched: files });
    const receipt = emitSkillReceipt(result);
    files.push("/b.ts");
    expect(receipt.filesTouched).toEqual(["/a.ts"]);
  });

  it("includes issuedAt as ISO timestamp", () => {
    const result = makeResult();
    const receipt = emitSkillReceipt(result);
    expect(() => new Date(receipt.issuedAt)).not.toThrow();
    expect(receipt.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes failureReason when present", () => {
    const result = makeResult({
      state: "failed",
      failureReason: "SKILL-007: something went wrong",
    });
    const receipt = emitSkillReceipt(result);
    expect(receipt.failureReason).toBe("SKILL-007: something went wrong");
  });
});

describe("buildSkillReport", () => {
  it("includes 'APPLIED' for applied state", () => {
    const result = makeResult({ state: "applied" });
    const report = buildSkillReport(result);
    expect(report).toContain("APPLIED");
  });

  it("includes 'PROPOSED' for proposed state", () => {
    const result = makeResult({ state: "proposed" });
    const report = buildSkillReport(result);
    expect(report).toContain("PROPOSED");
  });

  it("includes 'FAILED' for failed state", () => {
    const result = makeResult({
      state: "failed",
      failureReason: "SKILL-007: script error",
    });
    const report = buildSkillReport(result);
    expect(report).toContain("FAILED");
  });

  it("includes failureReason for failed state", () => {
    const result = makeResult({
      state: "failed",
      failureReason: "SKILL-007: script error",
    });
    const report = buildSkillReport(result);
    expect(report).toContain("SKILL-007: script error");
  });

  it("includes receipt section when receipt provided", () => {
    const result = makeResult();
    const receipt = emitSkillReceipt(result);
    const report = buildSkillReport(result, receipt);
    expect(report).toContain("Receipt ID");
    expect(report).toContain(receipt.receiptId);
  });

  it("'verified' state shows ✅", () => {
    const result = makeResult({ state: "verified" });
    const report = buildSkillReport(result);
    expect(report).toContain("✅");
  });

  it("does NOT include receipt section when receipt not provided", () => {
    const result = makeResult();
    const report = buildSkillReport(result);
    expect(report).not.toContain("Receipt ID:");
  });

  it("includes skill name in header", () => {
    const result = makeResult({ skillName: "my-awesome-skill" });
    const report = buildSkillReport(result);
    expect(report).toContain("my-awesome-skill");
  });
});

describe("linkToEvidenceChain", () => {
  it("creates LedgerLink with correct fields", () => {
    const result = makeResult();
    const receipt = emitSkillReceipt(result);
    const link = linkToEvidenceChain(receipt, "chain_abc123");
    expect(link.receiptId).toBe(receipt.receiptId);
    expect(link.runId).toBe(receipt.runId);
    expect(link.chainRef).toBe("chain_abc123");
    expect(link.linkedAt).toBeDefined();
  });

  it("chainRef is optional", () => {
    const result = makeResult();
    const receipt = emitSkillReceipt(result);
    const link = linkToEvidenceChain(receipt);
    expect(link.chainRef).toBeUndefined();
    expect(link.receiptId).toBe(receipt.receiptId);
  });

  it("linkedAt is a valid ISO timestamp", () => {
    const result = makeResult();
    const receipt = emitSkillReceipt(result);
    const link = linkToEvidenceChain(receipt);
    expect(link.linkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("SkillRunResult runId", () => {
  it("starts with 'sr_'", () => {
    const id = makeRunId();
    expect(id.startsWith("sr_")).toBe(true);
  });
});

describe("Full flow integration", () => {
  it("create skill → makeRunContext → runSkill → emitSkillReceipt → buildSkillReport → linkToEvidenceChain", async () => {
    // 1. Create skill
    const skill = makeSkill({
      name: "integration-test-skill",
      description: "Full integration test skill",
      sourceType: "native",
    });

    // 2. makeRunContext
    const context = makeRunContext({
      skillName: skill.name,
      projectRoot: "/project/root",
      sessionId: "sess_integration_001",
    });
    expect(context.skillName).toBe("integration-test-skill");
    expect(context.mode).toBe("apply");

    // 3. runSkill
    const result = await runSkill({ skill, context });
    expect(result.state).toBe("applied");
    expect(result.runId.startsWith("sr_")).toBe(true);

    // 4. emitSkillReceipt
    const receipt = emitSkillReceipt(result);
    expect(receipt.receiptId.startsWith("rcpt_")).toBe(true);
    expect(receipt.runId).toBe(result.runId);

    // 5. buildSkillReport
    const report = buildSkillReport(result, receipt);
    expect(report).toContain("integration-test-skill");
    expect(report).toContain("APPLIED");
    expect(report).toContain(receipt.receiptId);

    // 6. linkToEvidenceChain
    const link = linkToEvidenceChain(receipt, "evidence_hash_abc");
    expect(link.receiptId).toBe(receipt.receiptId);
    expect(link.chainRef).toBe("evidence_hash_abc");
  });
});
