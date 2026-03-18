import { describe, it, expect } from "vitest";
import {
  createSelfImprovementContext,
  detectSelfImprovementContext,
  isProtectedWriteTarget,
  isRepoInternalCdChain,
  isSelfImprovementWriteAllowed,
} from "./self-improvement-policy.js";

describe("self-improvement-policy", () => {
  const projectRoot = "/projects/dantecode";

  describe("isProtectedWriteTarget", () => {
    it("returns true for protected source paths", () => {
      expect(isProtectedWriteTarget("packages/cli/src/tools.ts", projectRoot)).toBe(true);
      expect(isProtectedWriteTarget("packages/core/src/model-router.ts", projectRoot)).toBe(true);
      expect(isProtectedWriteTarget(".dantecode/STATE.yaml", projectRoot)).toBe(true);
      expect(isProtectedWriteTarget("CONSTITUTION.md", projectRoot)).toBe(true);
    });

    it("returns false for normal project files", () => {
      expect(isProtectedWriteTarget("src/app.ts", projectRoot)).toBe(false);
      expect(isProtectedWriteTarget("packages/git-engine/src/worktree.ts", projectRoot)).toBe(
        false,
      );
    });
  });

  describe("detectSelfImprovementContext", () => {
    it("detects /autoforge --self-improve workflows", () => {
      const context = detectSelfImprovementContext("/autoforge --self-improve", projectRoot);
      expect(context?.enabled).toBe(true);
      expect(context?.workflowId).toBe("autoforge-self-improve");
    });

    it("detects /party --autoforge workflows", () => {
      const context = detectSelfImprovementContext(
        "/party --autoforge reliability ga",
        projectRoot,
      );
      expect(context?.enabled).toBe(true);
      expect(context?.workflowId).toBe("party-autoforge");
    });

    it("detects explicit self-upgrade language", () => {
      const context = detectSelfImprovementContext(
        "Please self-upgrade and improve codebase reliability",
        projectRoot,
      );
      expect(context?.enabled).toBe(true);
      expect(context?.workflowId).toBe("chat-self-improvement");
    });

    it("ignores normal user prompts", () => {
      expect(detectSelfImprovementContext("help me fix auth", projectRoot)).toBeNull();
    });
  });

  describe("isSelfImprovementWriteAllowed", () => {
    it("allows protected writes inside an explicit self-improvement context", () => {
      const context = createSelfImprovementContext(projectRoot, {
        workflowId: "autoforge-self-improve",
        triggerCommand: "/autoforge --self-improve",
      });

      expect(isSelfImprovementWriteAllowed("packages/cli/src/tools.ts", projectRoot, context)).toBe(
        true,
      );
    });

    it("rejects protected writes without explicit context", () => {
      expect(
        isSelfImprovementWriteAllowed("packages/cli/src/tools.ts", projectRoot, undefined),
      ).toBe(false);
    });

    it("rejects writes outside allowed roots even when enabled", () => {
      const context = createSelfImprovementContext(projectRoot, {
        workflowId: "narrow",
        triggerCommand: "/autoforge --self-improve",
        allowedRoots: ["packages/cli"],
      });

      expect(
        isSelfImprovementWriteAllowed("packages/core/src/model-router.ts", projectRoot, context),
      ).toBe(false);
    });
  });

  describe("isRepoInternalCdChain", () => {
    it("flags repo-internal cd chains", () => {
      expect(isRepoInternalCdChain("cd packages/cli && npm test", projectRoot)).toBe(true);
      expect(isRepoInternalCdChain("cd ./packages/core && npm run lint", projectRoot)).toBe(true);
    });

    it("allows repo-root and non-cd commands", () => {
      expect(isRepoInternalCdChain("npm test", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("cd . && npm test", projectRoot)).toBe(false);
    });
  });
});
