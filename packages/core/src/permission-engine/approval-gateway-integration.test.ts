import { describe, expect, it } from "vitest";
import { ApprovalGateway } from "../tool-runtime/approval-gateway.js";
import { parseRules } from "./rule-parser.js";
import type { PermissionConfig } from "./types.js";

describe("ApprovalGateway + Permission Engine Integration", () => {
  function createGatewayWithPermissions(permissionConfig: PermissionConfig): ApprovalGateway {
    const gateway = new ApprovalGateway({
      enabled: true,
      rules: [
        {
          reason: "Write requires verification-rule approval",
          tools: ["Write"],
          decision: "requires_approval",
        },
      ],
    });
    gateway.setPermissionConfig(permissionConfig);
    gateway.setApprovalMode("review");
    return gateway;
  }

  it("returns auto_deny when permission engine denies", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["deny Bash rm *"]),
      defaultDecision: "ask",
    });

    const result = gateway.checkWithPermissions("Bash", {
      command: "rm -rf /tmp/dangerous",
    });
    expect(result.decision).toBe("auto_deny");
    expect(result.reason).toContain("Permission denied by rule");
    expect(result.permissionResult).toBeDefined();
    expect(result.permissionResult!.decision).toBe("deny");
  });

  it("returns auto_approve when permission engine allows", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["allow Write src/*"]),
      defaultDecision: "ask",
    });

    const result = gateway.checkWithPermissions("Write", {
      file_path: "src/index.ts",
      content: "export {};",
    });
    expect(result.decision).toBe("auto_approve");
    expect(result.reason).toContain("Permission allowed by rule");
    expect(result.permissionResult).toBeDefined();
    expect(result.permissionResult!.decision).toBe("allow");
  });

  it("falls through to verification rules when permission engine says ask", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["ask Write *"]),
      defaultDecision: "ask",
    });

    const result = gateway.checkWithPermissions("Write", {
      file_path: "src/index.ts",
      content: "export {};",
    });
    // The verification rule for Write says "requires_approval"
    expect(result.decision).toBe("requires_approval");
    expect(result.permissionResult).toBeDefined();
    expect(result.permissionResult!.decision).toBe("ask");
  });

  it("uses default permission decision when no rules match", () => {
    const gateway = createGatewayWithPermissions({
      rules: [],
      defaultDecision: "allow",
    });

    const result = gateway.checkWithPermissions("Bash", { command: "echo hello" });
    expect(result.decision).toBe("auto_approve");
    expect(result.permissionResult).toBeDefined();
    expect(result.permissionResult!.usedDefault).toBe(true);
  });

  it("uses default deny when no rules match and default is deny", () => {
    const gateway = createGatewayWithPermissions({
      rules: [],
      defaultDecision: "deny",
    });

    const result = gateway.checkWithPermissions("Bash", { command: "echo hello" });
    expect(result.decision).toBe("auto_deny");
    expect(result.reason).toContain("Permission denied by default policy");
  });

  it("pre-approved fingerprint bypasses permission check", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["deny Bash *"]),
      defaultDecision: "deny",
    });

    const input = { command: "rm -rf /" };
    gateway.approveToolCall("Bash", input);

    const result = gateway.checkWithPermissions("Bash", input);
    expect(result.decision).toBe("auto_approve");
    expect(result.reason).toContain("explicitly approved");
    expect(result.permissionResult).toBeUndefined();
  });

  it("gateway disabled bypasses permission check", () => {
    const gateway = new ApprovalGateway({ enabled: false });
    gateway.setPermissionConfig({
      rules: parseRules(["deny Bash *"]),
      defaultDecision: "deny",
    });

    const result = gateway.checkWithPermissions("Bash", { command: "rm -rf /" });
    expect(result.decision).toBe("auto_approve");
    expect(result.permissionResult).toBeUndefined();
  });

  it("no permission config falls through to verification rules", () => {
    const gateway = new ApprovalGateway({
      enabled: true,
      rules: [
        {
          reason: "Bash requires approval",
          tools: ["Bash"],
          decision: "requires_approval",
        },
      ],
    });
    // Explicitly no permission config

    const result = gateway.checkWithPermissions("Bash", { command: "echo hello" });
    expect(result.decision).toBe("requires_approval");
    expect(result.permissionResult).toBeUndefined();
  });

  it("deny > ask in permission engine prevents fall-through to verification rules", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["ask Bash *", "deny Bash rm *"]),
      defaultDecision: "allow",
    });

    const result = gateway.checkWithPermissions("Bash", { command: "rm something" });
    expect(result.decision).toBe("auto_deny");
  });

  it("permission config can be removed to revert to verification-only", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["deny Bash *"]),
      defaultDecision: "deny",
    });

    // With permission config: denied
    expect(gateway.checkWithPermissions("Bash", { command: "echo" }).decision).toBe("auto_deny");

    // Remove permission config
    gateway.setPermissionConfig(null);
    expect(gateway.permissionConfig).toBeNull();

    // Without permission config: falls through to verification rules (no match = auto_approve)
    const result = gateway.checkWithPermissions("Bash", { command: "echo" });
    expect(result.decision).toBe("auto_approve");
  });

  it("extracts file_path from input for path-based rules", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["deny Edit packages/core/src/secret/*"]),
      defaultDecision: "allow",
    });

    const result = gateway.checkWithPermissions("Edit", {
      file_path: "packages/core/src/secret/keys.ts",
      old_string: "old",
      new_string: "new",
    });
    expect(result.decision).toBe("auto_deny");
  });

  it("extracts path from input when file_path is absent", () => {
    const gateway = createGatewayWithPermissions({
      rules: parseRules(["deny Glob node_modules/*"]),
      defaultDecision: "allow",
    });

    const result = gateway.checkWithPermissions("Glob", {
      path: "node_modules/something",
    });
    expect(result.decision).toBe("auto_deny");
  });

  it("handles approval mode getter", () => {
    const gateway = new ApprovalGateway({ enabled: true });
    expect(gateway.approvalMode).toBe("review");

    gateway.setApprovalMode("autoforge");
    expect(gateway.approvalMode).toBe("autoforge");

    gateway.setApprovalMode("yolo");
    expect(gateway.approvalMode).toBe("yolo");
  });
});
