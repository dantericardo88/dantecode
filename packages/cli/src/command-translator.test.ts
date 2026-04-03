import { describe, it, expect } from "vitest";
import { translateCdCommand } from "./command-translator.js";

describe("command-translator", () => {
  describe("translateCdCommand", () => {
    it("should translate npm commands with --prefix", () => {
      const result = translateCdCommand("cd frontend && npm install");
      expect(result.suggested).toBe("npm --prefix frontend install");
      expect(result.confidence).toBe("high");
      expect(result.explanation).toContain("--prefix");
    });

    it("should translate npm commands with complex args", () => {
      const result = translateCdCommand("cd packages/cli && npm run build -- --watch");
      expect(result.suggested).toBe("npm --prefix packages/cli run build -- --watch");
      expect(result.confidence).toBe("high");
    });

    it("should translate pnpm commands with -C", () => {
      const result = translateCdCommand("cd packages/core && pnpm test");
      expect(result.suggested).toBe("pnpm -C packages/core test");
      expect(result.confidence).toBe("high");
      expect(result.explanation).toContain("-C");
    });

    it("should translate yarn commands with --cwd", () => {
      const result = translateCdCommand("cd frontend && yarn build");
      expect(result.suggested).toBe("yarn --cwd frontend build");
      expect(result.confidence).toBe("high");
      expect(result.explanation).toContain("--cwd");
    });

    it("should translate turbo commands with --cwd", () => {
      const result = translateCdCommand("cd apps/web && turbo run lint");
      expect(result.suggested).toBe("turbo run lint --cwd apps/web");
      expect(result.confidence).toBe("high");
    });

    it("should use subshell for drizzle-kit commands", () => {
      const result = translateCdCommand("cd frontend && npx drizzle-kit push:sqlite");
      expect(result.suggested).toBe("(cd frontend && npx drizzle-kit push:sqlite)");
      expect(result.confidence).toBe("medium");
      expect(result.explanation.toLowerCase()).toContain("subshell");
    });

    it("should use subshell for generic commands", () => {
      const result = translateCdCommand("cd dist && ls -la");
      expect(result.suggested).toBe("(cd dist && ls -la)");
      expect(result.confidence).toBe("medium");
      expect(result.explanation.toLowerCase()).toContain("subshell");
    });

    it("should handle quoted directory paths", () => {
      const result = translateCdCommand('cd "frontend" && npm test');
      expect(result.suggested).toBe("npm --prefix frontend test");
    });

    it("should handle single-quoted paths", () => {
      const result = translateCdCommand("cd 'packages/cli' && pnpm build");
      expect(result.suggested).toBe("pnpm -C packages/cli build");
    });

    it("should return original command if not a cd chain", () => {
      const result = translateCdCommand("npm install");
      expect(result.suggested).toBe("npm install");
      expect(result.confidence).toBe("low");
    });

    it("should handle complex paths with slashes", () => {
      const result = translateCdCommand("cd ./packages/core/src && npm test");
      expect(result.suggested).toBe("npm --prefix ./packages/core/src test");
    });

    it("should handle Windows-style paths", () => {
      const result = translateCdCommand("cd packages\\cli && npm test");
      expect(result.suggested).toBe("npm --prefix packages\\cli test");
    });
  });
});
