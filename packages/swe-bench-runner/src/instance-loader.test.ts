// ============================================================================
// @dantecode/swe-bench-runner — InstanceLoader Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InstanceLoader } from "./instance-loader.js";

describe("InstanceLoader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "swe-bench-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("getBuiltinInstances() returns exactly 25 instances", () => {
    const loader = new InstanceLoader();
    const instances = loader.getBuiltinInstances();
    expect(instances).toHaveLength(25);
  });

  it("each builtin instance has required fields", () => {
    const loader = new InstanceLoader();
    const instances = loader.getBuiltinInstances();
    for (const inst of instances) {
      expect(inst.instance_id).toBeTruthy();
      expect(typeof inst.instance_id).toBe("string");
      expect(inst.problem_statement).toBeTruthy();
      expect(typeof inst.problem_statement).toBe("string");
      expect(inst.test_patch).toBeTruthy();
      expect(typeof inst.test_patch).toBe("string");
      expect(inst.repo).toBeTruthy();
      expect(Array.isArray(inst.fail_to_pass)).toBe(true);
      expect(Array.isArray(inst.pass_to_pass)).toBe(true);
    }
  });

  it("loadInstances({ subset: 5 }) returns at most 5 instances", async () => {
    const loader = new InstanceLoader(join(tmpDir, "cache"));
    const instances = await loader.loadInstances({ subset: 5 });
    expect(instances.length).toBeLessThanOrEqual(5);
    expect(instances.length).toBeGreaterThan(0);
  });

  it("saveToCache and loadInstances roundtrip", async () => {
    const cacheDir = join(tmpDir, "cache");
    const loader = new InstanceLoader(cacheDir);
    const original = loader.getBuiltinInstances().slice(0, 3);
    await loader.saveToCache(original);
    const loaded = await loader.loadInstances();
    expect(loaded).toHaveLength(3);
    expect(loaded[0]?.instance_id).toBe(original[0]?.instance_id);
    expect(loaded[2]?.problem_statement).toBe(original[2]?.problem_statement);
  });

  it("missing cache returns builtin instances", async () => {
    const loader = new InstanceLoader(join(tmpDir, "nonexistent-cache"));
    const instances = await loader.loadInstances();
    expect(instances).toHaveLength(25);
  });
});
