import { describe, it, expect, vi, beforeEach } from "vitest";
import { configureApprovalMode } from "./approval-mode-runtime.js";
import type { ApprovalModeInput } from "./approval-mode-runtime.js";

// Mock @dantecode/core for approval mode functions
vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    normalizeApprovalMode: vi.fn((mode: string) => {
      const valid: Record<string, string> = {
        review: "review",
        apply: "apply",
        autoforge: "autoforge",
        plan: "plan",
        yolo: "yolo",
        chat: "chat",
        default: "review",
        "auto-edit": "apply",
      };
      return valid[mode] ?? null;
    }),
    buildApprovalGatewayProfile: vi.fn((mode: string) => ({
      mode,
      requiresApproval: mode !== "apply" && mode !== "yolo",
    })),
    globalApprovalGateway: {
      configure: vi.fn(),
    },
  };
});

describe("configureApprovalMode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns normalized mode for valid input", () => {
    const result = configureApprovalMode("review" as ApprovalModeInput);
    expect(result).toBe("review");
  });

  it("throws for unknown mode", () => {
    // Cast to bypass type check — testing runtime guard
    expect(() => configureApprovalMode("unknown-mode" as ApprovalModeInput)).toThrow(
      "Unknown approval mode",
    );
  });

  it("configures gateway with built profile", async () => {
    const { globalApprovalGateway } = await import("@dantecode/core");
    configureApprovalMode("apply" as ApprovalModeInput);
    expect(globalApprovalGateway.configure).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "apply" }),
    );
  });
});
