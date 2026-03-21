import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GitSkillbookStore } from "./git-skillbook-store.js";
import type { SkillbookData } from "./skillbook.js";

const makeTestDir = () => {
  const dir = join(tmpdir(), `dc-skillbook-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const makeData = (): SkillbookData => ({
  version: "1.0.0",
  skills: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("GitSkillbookStore", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("returns null when skillbook does not exist", () => {
    const store = new GitSkillbookStore({ cwd: testDir, gitStage: false });
    expect(store.load()).toBeNull();
  });

  it("saves and loads skillbook data", () => {
    const store = new GitSkillbookStore({ cwd: testDir, gitStage: false });
    const data = makeData();
    store.save(data);
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe("1.0.0");
  });

  it("creates parent directories on save", () => {
    const store = new GitSkillbookStore({ cwd: testDir, gitStage: false });
    store.save(makeData());
    expect(store.exists()).toBe(true);
  });

  it("exists() returns false before save", () => {
    const store = new GitSkillbookStore({ cwd: testDir, gitStage: false });
    expect(store.exists()).toBe(false);
  });

  it("exists() returns true after save", () => {
    const store = new GitSkillbookStore({ cwd: testDir, gitStage: false });
    store.save(makeData());
    expect(store.exists()).toBe(true);
  });

  it("uses custom skillbook path", () => {
    const store = new GitSkillbookStore({
      cwd: testDir,
      skillbookPath: "custom/path/sb.json",
      gitStage: false,
    });
    store.save(makeData());
    expect(existsSync(join(testDir, "custom/path/sb.json"))).toBe(true);
  });

  it("fullPath reflects cwd + skillbookPath", () => {
    const store = new GitSkillbookStore({ cwd: testDir, gitStage: false });
    expect(store.fullPath).toBe(join(testDir, ".dantecode/skillbook/skillbook.json"));
  });
});
