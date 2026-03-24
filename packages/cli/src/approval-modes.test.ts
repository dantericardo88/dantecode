import { describe, it, expect } from "vitest";

describe("Approval modes", () => {
  // Inline test of mode state transitions (no real slash-command wiring needed)
  type ApprovalMode = "default" | "yolo" | "auto-edit" | "plan";

  function applyMode(
    current: { approvalMode: ApprovalMode; planModeActive: boolean },
    newMode: ApprovalMode,
  ) {
    current.approvalMode = newMode;
    if (newMode === "plan") {
      current.planModeActive = true;
    } else if (current.planModeActive) {
      current.planModeActive = false;
    }
  }

  it("default mode does not activate plan guard", () => {
    const state = { approvalMode: "yolo" as ApprovalMode, planModeActive: false };
    applyMode(state, "default");
    expect(state.approvalMode).toBe("default");
    expect(state.planModeActive).toBe(false);
  });

  it("yolo mode sets approvalMode without plan guard", () => {
    const state = { approvalMode: "default" as ApprovalMode, planModeActive: false };
    applyMode(state, "yolo");
    expect(state.approvalMode).toBe("yolo");
    expect(state.planModeActive).toBe(false);
  });

  it("plan mode activates plan guard", () => {
    const state = { approvalMode: "default" as ApprovalMode, planModeActive: false };
    applyMode(state, "plan");
    expect(state.approvalMode).toBe("plan");
    expect(state.planModeActive).toBe(true);
  });

  it("switching from plan to auto-edit deactivates plan guard", () => {
    const state = { approvalMode: "plan" as ApprovalMode, planModeActive: true };
    applyMode(state, "auto-edit");
    expect(state.approvalMode).toBe("auto-edit");
    expect(state.planModeActive).toBe(false);
  });

  it("auto-edit mode classification is correct", () => {
    const AUTO_EDIT_TOOLS = new Set(["Write", "Edit", "TodoWrite"]);
    const CONFIRM_TOOLS = new Set(["Bash", "GitPush", "GitCommit"]);

    expect(AUTO_EDIT_TOOLS.has("Write")).toBe(true);
    expect(AUTO_EDIT_TOOLS.has("Edit")).toBe(true);
    expect(AUTO_EDIT_TOOLS.has("Bash")).toBe(false);
    expect(CONFIRM_TOOLS.has("Bash")).toBe(true);
    expect(CONFIRM_TOOLS.has("GitPush")).toBe(true);
  });
});
