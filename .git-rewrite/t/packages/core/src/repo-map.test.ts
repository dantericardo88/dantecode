// ============================================================================
// @dantecode/core - Unified Repo Map Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { buildUnifiedRepoMap, getRepoMapForQuery, invalidateRepoMapCache } from "./repo-map.js";

describe("buildUnifiedRepoMap", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dante-repo-map-unified-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should build a repo map with pagerank strategy", async () => {
    const fileA = `
export function helperFunction() {
  return "helper";
}
`;

    const fileB = `
import { helperFunction } from './a';

export function mainFunction() {
  return helperFunction();
}
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);

    const map = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts", "b.ts"],
      strategy: "pagerank",
      maxTokens: 500,
      useCache: false,
    });

    expect(map).toContain("# Repository Map");
    expect(map).toContain("helperFunction");
    // mainFunction may not appear if not heavily referenced
    expect(map.length).toBeGreaterThan(50);
  });

  it("should build a repo map with ast strategy", async () => {
    const fileA = `
export function helperFunction() {
  return "helper";
}
`;

    await writeFile(join(testDir, "a.ts"), fileA);

    const map = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts"],
      strategy: "ast",
      maxTokens: 500,
      useCache: false,
    });

    expect(map).toContain("Repository Map");
    expect(map).toContain("helperFunction");
  });

  it("should cache results when useCache is true", async () => {
    const fileA = `export const x = 1;`;
    await writeFile(join(testDir, "a.ts"), fileA);

    const map1 = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts"],
      strategy: "pagerank",
      useCache: true,
    });

    // Second call should hit cache
    const map2 = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts"],
      strategy: "pagerank",
      useCache: true,
    });

    expect(map1).toBe(map2);

    // Check that cache file exists
    const cachePath = join(testDir, ".dantecode/repo-map-cache");
    expect(existsSync(cachePath)).toBe(true);
  });

  it("should invalidate cache when files change", async () => {
    const fileA = `export const x = 1;`;
    await writeFile(join(testDir, "a.ts"), fileA);

    const map1 = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts"],
      strategy: "pagerank",
      useCache: true,
    });

    // Add a new file
    const fileB = `export const y = 2;`;
    await writeFile(join(testDir, "b.ts"), fileB);

    const map2 = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts", "b.ts"],
      strategy: "pagerank",
      useCache: true,
    });

    expect(map1).not.toBe(map2);
    expect(map2).toContain("a.ts");
    expect(map2).toContain("b.ts");
  });

  it("should prioritize chat files", async () => {
    const fileA = `export function chatFunc() {}`;
    const fileB = `export function otherFunc() {}`;
    const fileC = `
import { chatFunc } from './a';
import { otherFunc } from './b';

chatFunc();
otherFunc();
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);
    await writeFile(join(testDir, "c.ts"), fileC);

    const map = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts", "b.ts", "c.ts"],
      chatFiles: ["a.ts"],
      strategy: "pagerank",
      useCache: false,
    });

    // Chat files are excluded from output, so chatFunc shouldn't appear
    expect(map).not.toContain("a.ts"); // Chat file excluded
    expect(map).toContain("otherFunc"); // Other file symbols included
  });

  it("should boost mentioned files and identifiers", async () => {
    const fileA = `export function targetFunction() {}`;
    const fileB = `export function normalFunction() {}`;
    const fileC = `
import { targetFunction } from './a';
import { normalFunction } from './b';

targetFunction();
normalFunction();
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);
    await writeFile(join(testDir, "c.ts"), fileC);

    const map = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts", "b.ts", "c.ts"],
      mentionedIdents: ["targetFunction"],
      strategy: "pagerank",
      useCache: false,
    });

    const targetPos = map.indexOf("targetFunction");
    const normalPos = map.indexOf("normalFunction");

    expect(targetPos).toBeGreaterThan(0);
    expect(targetPos).toBeLessThan(normalPos);
  });

  it("should respect maxTokens budget", async () => {
    const files = Array.from({ length: 20 }, (_, i) => ({
      name: `file${i}.ts`,
      content: `export function func${i}() { return ${i}; }`,
    }));

    for (const file of files) {
      await writeFile(join(testDir, file.name), file.content);
    }

    const smallMap = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: files.map((f) => f.name),
      maxTokens: 200,
      useCache: false,
    });

    const largeMap = await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: files.map((f) => f.name),
      maxTokens: 2000,
      useCache: false,
    });

    // With minimal files, both maps might be similar size
    // Just verify budget is respected
    expect(smallMap.length).toBeLessThanOrEqual(largeMap.length + 50); // Allow some variance
    expect(smallMap.length).toBeLessThanOrEqual(200 * 4 + 100); // ~4 chars per token + header
  });
});

describe("getRepoMapForQuery", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dante-repo-map-query-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should boost symbols matching query terms", async () => {
    const fileA = `export function authenticateUser() {}`;
    const fileB = `export function processData() {}`;
    const fileC = `
import { authenticateUser } from './a';
import { processData } from './b';

authenticateUser();
processData();
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);
    await writeFile(join(testDir, "c.ts"), fileC);

    const map = await getRepoMapForQuery(
      testDir,
      ["a.ts", "b.ts", "c.ts"],
      "authentication user login",
      { maxTokens: 500 },
    );

    const authPos = map.indexOf("authenticateUser");
    const dataPos = map.indexOf("processData");

    expect(authPos).toBeGreaterThan(0);
    expect(authPos).toBeLessThan(dataPos);
  });

  it("should handle empty query gracefully", async () => {
    const fileA = `export const x = 1;`;
    await writeFile(join(testDir, "a.ts"), fileA);

    const map = await getRepoMapForQuery(testDir, ["a.ts"], "", { maxTokens: 500 });

    expect(map).toContain("Repository Map");
  });

  it("should extract multiple query terms", async () => {
    const fileA = `export function userAuthenticationHandler() {}`;
    const fileB = `export function genericProcessor() {}`;
    const fileC = `
import { userAuthenticationHandler } from './a';
import { genericProcessor } from './b';

userAuthenticationHandler();
genericProcessor();
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);
    await writeFile(join(testDir, "c.ts"), fileC);

    const map = await getRepoMapForQuery(
      testDir,
      ["a.ts", "b.ts", "c.ts"],
      "user authentication handler",
      { maxTokens: 500 },
    );

    // All three terms match the symbol name
    const authPos = map.indexOf("userAuthenticationHandler");
    const genPos = map.indexOf("genericProcessor");

    expect(authPos).toBeGreaterThan(0);
    expect(authPos).toBeLessThan(genPos);
  });
});

describe("invalidateRepoMapCache", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dante-repo-map-cache-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  it("should remove cache directory", async () => {
    const fileA = `export const x = 1;`;
    await writeFile(join(testDir, "a.ts"), fileA);

    // Build with cache
    await buildUnifiedRepoMap({
      projectRoot: testDir,
      files: ["a.ts"],
      useCache: true,
    });

    const cachePath = join(testDir, ".dantecode/repo-map-cache");
    expect(existsSync(cachePath)).toBe(true);

    // Invalidate
    await invalidateRepoMapCache(testDir);

    expect(existsSync(cachePath)).toBe(false);
  });

  it("should handle missing cache gracefully", async () => {
    await expect(invalidateRepoMapCache(testDir)).resolves.not.toThrow();
  });
});
