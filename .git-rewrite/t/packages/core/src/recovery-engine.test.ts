// ============================================================================
// @dantecode/core — Recovery Engine Tests
// Tests for re-read recovery, hash auditing, and repo-root verification.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { RecoveryEngine, sha256ForTesting } from "./recovery-engine.js";

// Use resolve() to normalize paths for cross-platform compatibility (Windows vs Unix)
const PROJECT_ROOT = resolve("/project");
const SRC_DIR = resolve(PROJECT_ROOT, "src");

describe("RecoveryEngine", () => {
  let engine: RecoveryEngine;
  const fileSystem: Map<string, string> = new Map();
  const dirEntries: Map<string, string[]> = new Map();
  let execResults: Map<string, string>;

  beforeEach(() => {
    fileSystem.clear();
    dirEntries.clear();
    execResults = new Map();

    // Set up a virtual filesystem with platform-normalized paths
    fileSystem.set(resolve(SRC_DIR, "foo.ts"), 'export const foo = "bar";');
    fileSystem.set(resolve(SRC_DIR, "bar.ts"), "export const bar = 42;");
    fileSystem.set(resolve(SRC_DIR, "baz.tsx"), "export const Baz = () => <div/>;");
    fileSystem.set(resolve(SRC_DIR, "utils.ts"), "export function util() {}");

    dirEntries.set(SRC_DIR, ["foo.ts", "bar.ts", "baz.tsx", "utils.ts", "styles.css"]);

    // Default: all verification commands pass
    execResults.set("npm run typecheck", "");
    execResults.set("npm run lint", "");
    execResults.set("npm test", "");

    engine = new RecoveryEngine({
      maxContextFiles: 3,
      contextExtensions: [".ts", ".tsx"],
      readFileFn: async (p) => {
        const data = fileSystem.get(p);
        if (!data) throw new Error(`ENOENT: ${p}`);
        return data;
      },
      readdirSyncFn: (p) => {
        return dirEntries.get(p) ?? [];
      },
      execSyncFn: (cmd, _cwd) => {
        const result = execResults.get(cmd);
        if (result === undefined) {
          throw new Error(`Command failed: ${cmd}`);
        }
        return result;
      },
    });
  });

  // --------------------------------------------------------------------------
  // Re-read and recover
  // --------------------------------------------------------------------------

  describe("rereadAndRecover", () => {
    it("re-reads target file successfully", async () => {
      const result = await engine.rereadAndRecover(resolve(SRC_DIR, "foo.ts"), PROJECT_ROOT);

      expect(result.recovered).toBe(true);
      expect(result.targetContent).toBe('export const foo = "bar";');
      expect(result.targetHash).toBeTruthy();
    });

    it("reads surrounding context files", async () => {
      const result = await engine.rereadAndRecover(resolve(SRC_DIR, "foo.ts"), PROJECT_ROOT);

      expect(result.recovered).toBe(true);
      // Should read bar.ts, baz.tsx, utils.ts (up to maxContextFiles=3), excluding foo.ts itself and styles.css (wrong ext)
      expect(result.contextFiles.length).toBeLessThanOrEqual(3);
      expect(result.contextFiles.length).toBeGreaterThan(0);

      const paths = result.contextFiles.map((f) => f.path);
      expect(paths.every((p) => !p.endsWith("foo.ts"))).toBe(true);
      expect(paths.every((p) => !p.endsWith(".css"))).toBe(true);
    });

    it("returns recovered=false when target file does not exist", async () => {
      const result = await engine.rereadAndRecover(
        resolve(SRC_DIR, "nonexistent.ts"),
        PROJECT_ROOT,
      );

      expect(result.recovered).toBe(false);
      expect(result.error).toContain("ENOENT");
      expect(result.contextFiles).toHaveLength(0);
    });

    it("resolves relative paths against project root", async () => {
      fileSystem.set(resolve(SRC_DIR, "foo.ts"), "updated content");

      const result = await engine.rereadAndRecover("src/foo.ts", PROJECT_ROOT);
      expect(result.recovered).toBe(true);
      expect(result.targetContent).toBe("updated content");
    });

    it("handles empty directory gracefully", async () => {
      dirEntries.set(SRC_DIR, []);

      const result = await engine.rereadAndRecover(resolve(SRC_DIR, "foo.ts"), PROJECT_ROOT);
      expect(result.recovered).toBe(true);
      expect(result.contextFiles).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Hash auditing
  // --------------------------------------------------------------------------

  describe("hash auditing", () => {
    it("records before hash", () => {
      const hash = engine.recordBeforeHash("/project/src/foo.ts", "original content");

      expect(hash).toBeTruthy();
      expect(hash).toHaveLength(64); // SHA-256 hex
    });

    it("records after hash and detects modification", () => {
      engine.recordBeforeHash("/project/src/foo.ts", "original content");
      const audit = engine.recordAfterHash("/project/src/foo.ts", "modified content");

      expect(audit).not.toBeNull();
      expect(audit!.modified).toBe(true);
      expect(audit!.beforeHash).not.toBe(audit!.afterHash);
    });

    it("detects no modification when content is unchanged", () => {
      engine.recordBeforeHash("/project/src/foo.ts", "same content");
      const audit = engine.recordAfterHash("/project/src/foo.ts", "same content");

      expect(audit).not.toBeNull();
      expect(audit!.modified).toBe(false);
      expect(audit!.beforeHash).toBe(audit!.afterHash);
    });

    it("returns null when no matching before hash exists", () => {
      const audit = engine.recordAfterHash("/project/src/unknown.ts", "content");
      expect(audit).toBeNull();
    });

    it("maintains full audit trail", () => {
      engine.recordBeforeHash("/project/a.ts", "a1");
      engine.recordAfterHash("/project/a.ts", "a2");

      engine.recordBeforeHash("/project/b.ts", "b1");
      engine.recordAfterHash("/project/b.ts", "b1");

      const trail = engine.getAuditTrail();
      expect(trail).toHaveLength(2);
      expect(trail[0]!.filePath).toBe("/project/a.ts");
      expect(trail[0]!.modified).toBe(true);
      expect(trail[1]!.filePath).toBe("/project/b.ts");
      expect(trail[1]!.modified).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Repo-root verification
  // --------------------------------------------------------------------------

  describe("runRepoRootVerification", () => {
    it("passes when all steps succeed", () => {
      const result = engine.runRepoRootVerification("/project");

      expect(result.passed).toBe(true);
      expect(result.failedSteps).toHaveLength(0);
      expect(result.stepResults).toHaveLength(3);
      expect(result.stepResults.every((s) => s.passed)).toBe(true);
    });

    it("fails when typecheck fails", () => {
      execResults.delete("npm run typecheck");

      const result = engine.runRepoRootVerification("/project");

      expect(result.passed).toBe(false);
      expect(result.failedSteps).toContain("typecheck");
      expect(result.stepResults.find((s) => s.name === "typecheck")!.passed).toBe(false);
    });

    it("fails when lint fails", () => {
      execResults.delete("npm run lint");

      const result = engine.runRepoRootVerification("/project");

      expect(result.passed).toBe(false);
      expect(result.failedSteps).toContain("lint");
    });

    it("fails when test fails", () => {
      execResults.delete("npm test");

      const result = engine.runRepoRootVerification("/project");

      expect(result.passed).toBe(false);
      expect(result.failedSteps).toContain("test");
    });

    it("reports all failed steps when multiple fail", () => {
      execResults.delete("npm run typecheck");
      execResults.delete("npm test");

      const result = engine.runRepoRootVerification("/project");

      expect(result.passed).toBe(false);
      expect(result.failedSteps).toContain("typecheck");
      expect(result.failedSteps).toContain("test");
      expect(result.failedSteps).not.toContain("lint"); // lint still passes
    });

    it("records duration for each step", () => {
      const result = engine.runRepoRootVerification("/project");

      for (const step of result.stepResults) {
        expect(step.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // --------------------------------------------------------------------------
  // Self-edit commit validation
  // --------------------------------------------------------------------------

  describe("validateSelfEditCommit", () => {
    it("returns safe=true when verification passes", () => {
      const result = engine.validateSelfEditCommit("/project", [
        { path: "/project/src/foo.ts", beforeContent: "old", afterContent: "new" },
      ]);

      expect(result.safe).toBe(true);
      expect(result.verification.passed).toBe(true);
      expect(result.audits).toHaveLength(1);
      expect(result.audits[0]!.modified).toBe(true);
    });

    it("returns safe=false when verification fails", () => {
      execResults.delete("npm run typecheck");

      const result = engine.validateSelfEditCommit("/project", [
        { path: "/project/src/foo.ts", beforeContent: "old", afterContent: "new" },
      ]);

      expect(result.safe).toBe(false);
      expect(result.blockedReason).toContain("typecheck");
    });

    it("records hash audits for all modified files", () => {
      const result = engine.validateSelfEditCommit("/project", [
        { path: "/project/src/a.ts", beforeContent: "a1", afterContent: "a2" },
        { path: "/project/src/b.ts", beforeContent: "b1", afterContent: "b1" },
        { path: "/project/src/c.ts", beforeContent: "c1", afterContent: "c2" },
      ]);

      expect(result.audits).toHaveLength(3);
      const modifiedCount = result.audits.filter((a) => a.modified).length;
      expect(modifiedCount).toBe(2); // a.ts and c.ts modified
    });
  });
});

// ----------------------------------------------------------------------------
// sha256 utility
// ----------------------------------------------------------------------------

describe("sha256ForTesting", () => {
  it("produces consistent SHA-256 hex", () => {
    const h1 = sha256ForTesting("test");
    const h2 = sha256ForTesting("test");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256ForTesting("abc")).not.toBe(sha256ForTesting("xyz"));
  });
});
