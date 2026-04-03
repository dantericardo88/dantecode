import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readStateYaml,
  writeStateYaml,
  initializeState,
  stateYamlExists,
  readOrInitializeState,
  updateStateYaml,
} from "./state.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("state manager", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dantecode-state-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("initializeState", () => {
    it("creates .dantecode directory and STATE.yaml", async () => {
      const state = await initializeState(testDir);
      expect(state.version).toBe("1.0.0");
      expect(state.projectRoot).toBe(testDir);
      expect(state.model.default.provider).toBe("grok");
      expect(state.model.default.modelId).toBe("grok-3");
    });

    it("sets sensible defaults for all sections", async () => {
      const state = await initializeState(testDir);
      expect(state.pdse.threshold).toBe(85);
      expect(state.pdse.hardViolationsAllowed).toBe(0);
      expect(state.autoforge.enabled).toBe(true);
      expect(state.autoforge.maxIterations).toBeGreaterThanOrEqual(1);
      expect(state.git.autoCommit).toBe(false); // Changed to minimal mode (no auto-commits)
      expect(state.agents.maxConcurrent).toBeGreaterThanOrEqual(1);
      expect(state.audit.enabled).toBe(true);
      expect(state.lessons.enabled).toBe(true);
    });

    it("persists to disk as valid YAML", async () => {
      await initializeState(testDir);
      const filePath = join(testDir, ".dantecode", "STATE.yaml");
      const content = await readFile(filePath, "utf-8");
      expect(content).toContain("version:");
      expect(content).toContain("grok");
    });

    it("includes fallback model configuration", async () => {
      const state = await initializeState(testDir);
      expect(state.model.fallback.length).toBeGreaterThanOrEqual(1);
      expect(state.model.fallback[0]?.provider).toBe("anthropic");
    });

    it("sets PDSE weights that sum to 1.0", async () => {
      const state = await initializeState(testDir);
      const { completeness, correctness, clarity, consistency } = state.pdse.weights;
      const sum = completeness + correctness + clarity + consistency;
      expect(sum).toBeCloseTo(1.0, 5);
    });
  });

  describe("readStateYaml", () => {
    it("reads and validates a previously written state", async () => {
      const original = await initializeState(testDir);
      const read = await readStateYaml(testDir);
      expect(read.version).toBe(original.version);
      expect(read.model.default.provider).toBe(original.model.default.provider);
    });

    it("throws on non-existent file", async () => {
      await expect(readStateYaml(testDir)).rejects.toThrow();
    });
  });

  describe("writeStateYaml", () => {
    it("performs atomic write (via temp file)", async () => {
      const state = await initializeState(testDir);
      state.project.name = "TestProject";
      await writeStateYaml(testDir, state);

      const reRead = await readStateYaml(testDir);
      expect(reRead.project.name).toBe("TestProject");
    });

    it("updates the updatedAt timestamp", async () => {
      const state = await initializeState(testDir);
      const originalUpdatedAt = state.updatedAt;

      // Small delay to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10));
      await writeStateYaml(testDir, state);

      const reRead = await readStateYaml(testDir);
      expect(reRead.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe("stateYamlExists", () => {
    it("returns false when no STATE.yaml exists", async () => {
      const exists = await stateYamlExists(testDir);
      expect(exists).toBe(false);
    });

    it("returns true after initialization", async () => {
      await initializeState(testDir);
      const exists = await stateYamlExists(testDir);
      expect(exists).toBe(true);
    });
  });

  describe("readOrInitializeState", () => {
    it("initializes when no state exists", async () => {
      const state = await readOrInitializeState(testDir);
      expect(state.version).toBe("1.0.0");
      // Verify it was also persisted
      const exists = await stateYamlExists(testDir);
      expect(exists).toBe(true);
    });

    it("reads existing state without reinitializing", async () => {
      const original = await initializeState(testDir);
      original.project.name = "ExistingProject";
      await writeStateYaml(testDir, original);

      const read = await readOrInitializeState(testDir);
      expect(read.project.name).toBe("ExistingProject");
    });
  });

  describe("updateStateYaml", () => {
    it("merges partial updates into existing state", async () => {
      await initializeState(testDir);

      const updated = await updateStateYaml(testDir, {
        project: {
          name: "UpdatedName",
          language: "typescript",
          sourceDirectories: ["src"],
          excludePatterns: [],
        },
      });

      expect(updated.project.name).toBe("UpdatedName");
      // Other fields should be preserved
      expect(updated.model.default.provider).toBe("grok");
    });

    it("preserves immutable fields (version, projectRoot, createdAt)", async () => {
      const original = await initializeState(testDir);

      const updated = await updateStateYaml(testDir, {
        version: "999.0.0", // should be ignored
      });

      expect(updated.version).toBe(original.version);
      expect(updated.projectRoot).toBe(original.projectRoot);
      expect(updated.createdAt).toBe(original.createdAt);
    });
  });
});
