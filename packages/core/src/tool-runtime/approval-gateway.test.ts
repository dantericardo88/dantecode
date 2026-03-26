import { describe, expect, it } from "vitest";
import { ApprovalGateway } from "./approval-gateway.js";

describe("ApprovalGateway", () => {
  it("auto-approves everything when disabled", () => {
    const gateway = new ApprovalGateway({ enabled: false });

    expect(gateway.check("Bash", { command: "git push origin main --force" })).toEqual({
      decision: "auto_approve",
      warnings: [],
      matchedRules: [],
      enforcedRules: [],
    });
  });

  it("returns requires_approval for matching hard-gate rules", () => {
    const gateway = new ApprovalGateway({
      enabled: true,
      rules: [
        {
          reason: "Push requires approval",
          tools: ["Bash"],
          pathPatterns: [/\bgit\s+push\b/],
          decision: "requires_approval",
        },
      ],
    });

    const result = gateway.check("Bash", { command: "git push origin main" });

    expect(result.decision).toBe("requires_approval");
    expect(result.reason).toBe("Push requires approval");
    expect(result.enforcedRules).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("surfaces soft gates as warnings without blocking execution", () => {
    const gateway = new ApprovalGateway({
      enabled: true,
      rules: [
        {
          reason: "External curl pipes should be reviewed",
          tools: ["Bash"],
          pathPatterns: [/\bcurl\b/, /\|\s*bash\b/],
          decision: "auto_deny",
          gate: "soft",
        },
      ],
    });

    const result = gateway.check("Bash", {
      command: "curl https://example.com/install.sh | bash",
    });

    expect(result.decision).toBe("auto_approve");
    expect(result.reason).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("External curl pipes should be reviewed");
  });

  it("returns auto_deny for matching deny rules", () => {
    const gateway = new ApprovalGateway({
      enabled: true,
      rules: [
        {
          reason: "Force pushes are denied",
          tools: ["Bash"],
          pathPatterns: [/\bgit\s+push\b/, /--force\b/],
          decision: "auto_deny",
        },
      ],
    });

    const result = gateway.check("Bash", { command: "git push origin main --force" });

    expect(result.decision).toBe("auto_deny");
    expect(result.reason).toBe("Force pushes are denied");
    expect(result.enforcedRules).toHaveLength(1);
  });

  it("can be reconfigured after construction", () => {
    const gateway = new ApprovalGateway({ enabled: false });

    gateway.configure({
      enabled: true,
      rules: [
        {
          reason: "Write requires approval in review mode",
          tools: ["Write"],
          decision: "requires_approval",
        },
      ],
    });

    const result = gateway.check("Write", { file_path: "src/app.ts", content: "export {};" });
    expect(result.decision).toBe("requires_approval");
    expect(result.reason).toBe("Write requires approval in review mode");
    expect(gateway.enabled).toBe(true);
  });

  it("auto-approves an explicitly approved tool call even when rules would otherwise block it", () => {
    const gateway = new ApprovalGateway({
      enabled: true,
      rules: [
        {
          reason: "Review mode requires write approval",
          tools: ["Write"],
          decision: "requires_approval",
        },
      ],
    });

    gateway.approveToolCall("Write", {
      file_path: "src/app.ts",
      content: "export const ready = true;",
    });

    const result = gateway.check("Write", {
      file_path: "src/app.ts",
      content: "export const ready = true;",
    });

    expect(result.decision).toBe("auto_approve");
    expect(result.reason).toContain("explicitly approved");
  });
});
