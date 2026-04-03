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

    it("detects /magic as danteforge-pipeline", () => {
      const context = detectSelfImprovementContext("/magic improve reliability", projectRoot);
      expect(context?.enabled).toBe(true);
      expect(context?.workflowId).toBe("danteforge-pipeline");
      expect(context?.triggerCommand).toBe("/magic");
    });

    it("detects /inferno as danteforge-pipeline", () => {
      const context = detectSelfImprovementContext("/inferno 4-hour resume proof", projectRoot);
      expect(context?.enabled).toBe(true);
      expect(context?.workflowId).toBe("danteforge-pipeline");
      expect(context?.triggerCommand).toBe("/inferno");
    });

    it("detects /forge as danteforge-pipeline", () => {
      const context = detectSelfImprovementContext("/forge build auth module", projectRoot);
      expect(context?.enabled).toBe(true);
      expect(context?.workflowId).toBe("danteforge-pipeline");
      expect(context?.triggerCommand).toBe("/forge");
    });

    it("preserves specific /autoforge --self-improve workflowId over generic match", () => {
      const context = detectSelfImprovementContext("/autoforge --self-improve", projectRoot);
      expect(context?.workflowId).toBe("autoforge-self-improve");
    });

    it("preserves specific /party --autoforge workflowId over generic match", () => {
      const context = detectSelfImprovementContext("/party --autoforge reliability", projectRoot);
      expect(context?.workflowId).toBe("party-autoforge");
    });

    it("detects /party without --autoforge as danteforge-pipeline", () => {
      const context = detectSelfImprovementContext("/party run tests", projectRoot);
      expect(context?.enabled).toBe(true);
      expect(context?.workflowId).toBe("danteforge-pipeline");
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

  describe("detectSelfImprovementContext with usingFallbackModel", () => {
    const root = "/fake/project";

    it("returns null for /inferno when usingFallbackModel is true", () => {
      const result = detectSelfImprovementContext("/inferno build everything", root, {
        usingFallbackModel: true,
      });
      expect(result).toBeNull();
    });

    it("returns non-null for /magic when usingFallbackModel is true", () => {
      const result = detectSelfImprovementContext("/magic fix tests", root, {
        usingFallbackModel: true,
      });
      expect(result).not.toBeNull();
      expect(result?.enabled).toBe(true);
    });

    it("returns non-null for /inferno when usingFallbackModel is false", () => {
      const result = detectSelfImprovementContext("/inferno build everything", root, {
        usingFallbackModel: false,
      });
      expect(result).not.toBeNull();
    });
  });

  describe("isRepoInternalCdChain - FIXED LOGIC", () => {
    // FIXED: Function now returns FALSE (allow) for internal paths,
    // TRUE (block) for external paths. Previous tests had inverted expectations.

    it("should ALLOW cd to internal subdirectories", () => {
      // These should return FALSE (don't block) because they're inside the repo
      expect(isRepoInternalCdChain("cd packages/cli && npm test", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("cd ./packages/core && npm run lint", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("cd frontend && npm install", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("cd src/lib && npm test", projectRoot)).toBe(false);
    });

    it("should ALLOW cd to current directory", () => {
      expect(isRepoInternalCdChain("cd . && npm test", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("cd ./ && npm install", projectRoot)).toBe(false);
    });

    it("should NOT block non-cd commands", () => {
      expect(isRepoInternalCdChain("npm test", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("npm install && npm test", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("echo 'cd test' && ls", projectRoot)).toBe(false);
    });

    it("should BLOCK cd to external directories", () => {
      // These should return TRUE (block) because they're outside the repo
      expect(isRepoInternalCdChain("cd /etc && cat passwd", projectRoot)).toBe(true);
      expect(isRepoInternalCdChain("cd /tmp && rm -rf test", projectRoot)).toBe(true);
      expect(isRepoInternalCdChain("cd ../other-project && npm test", projectRoot)).toBe(true);
      expect(isRepoInternalCdChain("cd ../../ && ls", projectRoot)).toBe(true);
    });

    it("should handle quoted paths correctly", () => {
      expect(isRepoInternalCdChain('cd "packages/cli" && npm test', projectRoot)).toBe(false);
      expect(isRepoInternalCdChain("cd 'frontend' && npm build", projectRoot)).toBe(false);
      expect(isRepoInternalCdChain('cd "/tmp" && ls', projectRoot)).toBe(true);
    });
  });
});
