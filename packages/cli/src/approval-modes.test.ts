import { describe, expect, it, afterEach } from "vitest";
import { ApprovalGateway, globalApprovalGateway } from "@dantecode/core";
import {
  buildApprovalGatewayProfile,
  configureApprovalMode,
  normalizeApprovalMode,
} from "./approval-mode-runtime.js";
import { isPlanModeBlocked } from "./plan-mode-guard.js";

describe("approval mode runtime profiles", () => {
  it("normalizes new and legacy mode labels", () => {
    expect(normalizeApprovalMode("review")).toBe("review");
    expect(normalizeApprovalMode("default")).toBe("review");
    expect(normalizeApprovalMode("apply")).toBe("apply");
    expect(normalizeApprovalMode("auto-edit")).toBe("apply");
    expect(normalizeApprovalMode("autoforge")).toBe("autoforge");
    expect(normalizeApprovalMode("plan")).toBe("plan");
    expect(normalizeApprovalMode("yolo")).toBe("yolo");
  });

  it("review mode requires approval for writes and subagents", () => {
    const profile = buildApprovalGatewayProfile("review");
    const gateway = new ApprovalGateway(profile);

    expect(
      gateway.check("Write", { file_path: "src/app.ts", content: "export const ready = true;" })
        .decision,
    ).toBe("requires_approval");
    expect(gateway.check("SubAgent", { prompt: "edit the file" }).decision).toBe(
      "requires_approval",
    );
  });

  it("apply mode auto-approves edits but still gates bash and subagents", () => {
    const profile = buildApprovalGatewayProfile("apply");
    const gateway = new ApprovalGateway(profile);

    expect(
      gateway.check("Write", { file_path: "src/app.ts", content: "export const ready = true;" })
        .decision,
    ).toBe("auto_approve");
    expect(gateway.check("Bash", { command: "git commit -am ready" }).decision).toBe(
      "requires_approval",
    );
    expect(gateway.check("SubAgent", { prompt: "edit the file" }).decision).toBe(
      "requires_approval",
    );
  });

  it("autoforge mode shares apply permissions", () => {
    const profile = buildApprovalGatewayProfile("autoforge");
    const gateway = new ApprovalGateway(profile);

    expect(
      gateway.check("Write", { file_path: "src/app.ts", content: "export const ready = true;" })
        .decision,
    ).toBe("auto_approve");
    expect(gateway.check("Bash", { command: "git push origin main" }).decision).toBe(
      "requires_approval",
    );
  });

  it("plan mode denies mutation tools at the gateway layer", () => {
    const profile = buildApprovalGatewayProfile("plan");
    const gateway = new ApprovalGateway(profile);

    expect(
      gateway.check("Write", { file_path: "src/app.ts", content: "export const ready = true;" })
        .decision,
    ).toBe("auto_deny");
    expect(gateway.check("SubAgent", { prompt: "edit the file" }).decision).toBe("auto_deny");
  });

  it("yolo mode leaves the gateway disabled", () => {
    const profile = buildApprovalGatewayProfile("yolo");
    const gateway = new ApprovalGateway(profile);

    expect(gateway.enabled).toBe(false);
    expect(gateway.check("Bash", { command: "git push origin main" }).decision).toBe(
      "auto_approve",
    );
  });

  it("plan mode blocks SubAgent in the CLI guard as well", () => {
    expect(isPlanModeBlocked("SubAgent")).toBe(true);
  });
});

describe("approval gateway hard enforcement via peekDecision", () => {
  afterEach(() => {
    // Reset global gateway to disabled state after each test
    globalApprovalGateway.reset();
  });

  it("peekDecision returns auto_deny for Write when plan mode is configured", () => {
    configureApprovalMode("plan");
    const input = { file_path: "src/app.ts", content: "export const x = 1;" };
    expect(globalApprovalGateway.peekDecision("Write", input)).toBe("auto_deny");
  });

  it("peekDecision is non-consuming — second call returns the same result", () => {
    configureApprovalMode("plan");
    const input = { file_path: "src/app.ts", content: "export const x = 1;" };
    expect(globalApprovalGateway.peekDecision("Write", input)).toBe("auto_deny");
    // A second peek must NOT change the result (no fingerprint consumed)
    expect(globalApprovalGateway.peekDecision("Write", input)).toBe("auto_deny");
  });

  it("peekDecision returns auto_approve for a pre-approved fingerprint (uses has, not delete)", () => {
    configureApprovalMode("review");
    const input = { file_path: "src/app.ts", content: "export const x = 1;" };
    globalApprovalGateway.approveToolCall("Write", input);
    // peekDecision should see the pre-approval (has) and return auto_approve
    expect(globalApprovalGateway.peekDecision("Write", input)).toBe("auto_approve");
    // The fingerprint must NOT have been consumed — check() should also return auto_approve
    expect(globalApprovalGateway.check("Write", input).decision).toBe("auto_approve");
  });

  it("peekDecision returns auto_approve in yolo mode (gateway disabled)", () => {
    configureApprovalMode("yolo");
    expect(globalApprovalGateway.peekDecision("Write", { file_path: "x.ts" })).toBe("auto_approve");
  });

  it("peekDecision returns requires_approval for Bash in apply mode", () => {
    configureApprovalMode("apply");
    expect(
      globalApprovalGateway.peekDecision("Bash", { command: "git commit -am x" }),
    ).toBe("requires_approval");
  });
});
