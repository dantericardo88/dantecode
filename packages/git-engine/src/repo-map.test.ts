import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  generateRepoMap,
  formatRepoMapForContext,
  type RepoMapEntry,
} from "./repo-map.js";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("repo-map", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "dantecode-repomap-test-"));
    execSync("git init", { cwd: repoDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: repoDir,
      stdio: "pipe",
    });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  describe("generateRepoMap", () => {
    it("returns empty array for repo with no tracked files", () => {
      // Need at least one commit for git ls-files to work in clean state
      execSync('git commit --allow-empty -m "init"', {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir);
      expect(entries).toEqual([]);
    });

    it("returns entries for tracked files", async () => {
      await writeFile(join(repoDir, "app.ts"), "export const x = 1;");
      execSync("git add . && git commit -m 'init'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.path).toBe("app.ts");
      expect(entries[0]?.language).toBe("TypeScript");
      expect(entries[0]?.size).toBeGreaterThan(0);
    });

    it("detects language from file extension", async () => {
      await writeFile(join(repoDir, "main.py"), "print('hi')");
      await writeFile(join(repoDir, "styles.css"), "body {}");
      execSync("git add . && git commit -m 'init'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir);
      const pyEntry = entries.find((e) => e.path === "main.py");
      const cssEntry = entries.find((e) => e.path === "styles.css");
      expect(pyEntry?.language).toBe("Python");
      expect(cssEntry?.language).toBe("CSS");
    });

    it("ignores default ignore patterns (node_modules, dist)", async () => {
      await mkdir(join(repoDir, "node_modules"), { recursive: true });
      await writeFile(join(repoDir, "node_modules", "pkg.js"), "module");
      await writeFile(join(repoDir, "app.ts"), "code");
      // Force-add node_modules file to test ignore filtering
      execSync("git add -f . && git commit -m 'init'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir);
      expect(entries.every((e) => !e.path.includes("node_modules"))).toBe(true);
    });

    it("respects extraIgnorePatterns", async () => {
      await mkdir(join(repoDir, "generated"), { recursive: true });
      await writeFile(join(repoDir, "generated", "out.ts"), "generated code");
      await writeFile(join(repoDir, "src.ts"), "real code");
      execSync("git add . && git commit -m 'init'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir, {
        extraIgnorePatterns: ["generated"],
      });
      expect(entries.every((e) => !e.path.includes("generated"))).toBe(true);
      expect(entries.some((e) => e.path === "src.ts")).toBe(true);
    });

    it("filters by includeExtensions", async () => {
      await writeFile(join(repoDir, "app.ts"), "ts code");
      await writeFile(join(repoDir, "readme.md"), "docs");
      await writeFile(join(repoDir, "config.json"), "{}");
      execSync("git add . && git commit -m 'init'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir, {
        includeExtensions: [".ts"],
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.path).toBe("app.ts");
    });

    it("respects maxFiles limit", async () => {
      for (let i = 0; i < 5; i++) {
        await writeFile(join(repoDir, `file${i}.ts`), `content ${i}`);
      }
      execSync("git add . && git commit -m 'init'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir, { maxFiles: 3 });
      expect(entries).toHaveLength(3);
    });

    it("sorts by modification time (most recent first)", async () => {
      await writeFile(join(repoDir, "old.ts"), "old");
      execSync("git add . && git commit -m 'first'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      // Small delay to ensure different mtime
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(join(repoDir, "new.ts"), "new");
      execSync("git add . && git commit -m 'second'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir);
      expect(entries[0]?.path).toBe("new.ts");
    });

    it("handles files in subdirectories", async () => {
      await mkdir(join(repoDir, "src", "utils"), { recursive: true });
      await writeFile(join(repoDir, "src", "utils", "helper.ts"), "helper");
      execSync("git add . && git commit -m 'init'", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const entries = generateRepoMap(repoDir);
      expect(entries.some((e) => e.path.includes("src/utils/helper.ts"))).toBe(
        true,
      );
    });
  });

  describe("formatRepoMapForContext", () => {
    it("returns placeholder for empty entries", () => {
      const result = formatRepoMapForContext([]);
      expect(result).toContain("No tracked files found");
    });

    it("formats entries with header and file count", () => {
      const entries: RepoMapEntry[] = [
        {
          path: "src/app.ts",
          size: 2560,
          language: "TypeScript",
          lastModified: new Date().toISOString(),
        },
      ];
      const result = formatRepoMapForContext(entries);
      expect(result).toContain("Repository Map");
      expect(result).toContain("1 files");
      expect(result).toContain("app.ts");
      expect(result).toContain("TypeScript");
    });

    it("groups files by directory", () => {
      const entries: RepoMapEntry[] = [
        {
          path: "src/index.ts",
          size: 100,
          language: "TypeScript",
          lastModified: new Date().toISOString(),
        },
        {
          path: "src/utils.ts",
          size: 200,
          language: "TypeScript",
          lastModified: new Date().toISOString(),
        },
        {
          path: "tests/app.test.ts",
          size: 300,
          language: "TypeScript",
          lastModified: new Date().toISOString(),
        },
      ];
      const result = formatRepoMapForContext(entries);
      expect(result).toContain("`src/`");
      expect(result).toContain("`tests/`");
    });

    it("formats file sizes correctly", () => {
      const entries: RepoMapEntry[] = [
        {
          path: "small.txt",
          size: 500,
          language: "Text",
          lastModified: new Date().toISOString(),
        },
        {
          path: "medium.ts",
          size: 5 * 1024,
          language: "TypeScript",
          lastModified: new Date().toISOString(),
        },
      ];
      const result = formatRepoMapForContext(entries);
      expect(result).toContain("500 B");
      expect(result).toContain("5.0 KB");
    });
  });
});
