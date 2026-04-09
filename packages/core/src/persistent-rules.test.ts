import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatPersistentRulesForPrompt,
  loadPersistentRules,
  loadPersistentRulesPrompt,
} from "./persistent-rules.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("persistent rules", () => {
  it("loads project and global rules from primary files and rules directories", async () => {
    const projectRoot = await makeTempDir("dantecode-project-rules-");
    const globalRoot = await makeTempDir("dantecode-global-rules-");

    await mkdir(join(projectRoot, ".dantecode", "rules"), { recursive: true });
    await mkdir(join(globalRoot, "rules"), { recursive: true });

    await writeFile(
      join(projectRoot, ".dantecode", "rules.md"),
      "# Project Rule\nAlways verify edits.",
      "utf8",
    );
    await writeFile(
      join(projectRoot, ".dantecode", "rules", "execution.md"),
      "Never describe a code change without executing a mutating tool first.",
      "utf8",
    );
    await writeFile(
      join(globalRoot, "rules.md"),
      "# Global Rule\nPrefer concise summaries backed by evidence.",
      "utf8",
    );
    await writeFile(join(globalRoot, "rules", "safety.md"), "Do not fabricate test results.", "utf8");

    const bundle = await loadPersistentRules(projectRoot, { globalRoot });

    expect(bundle.projectRules.map((rule) => rule.pathLabel)).toEqual([
      ".dantecode/rules.md",
      ".dantecode/rules/execution.md",
    ]);
    expect(bundle.globalRules.map((rule) => rule.pathLabel)).toEqual([
      "~/.dantecode/rules.md",
      "~/.dantecode/rules/safety.md",
    ]);

    const promptSection = formatPersistentRulesForPrompt(bundle);
    expect(promptSection).toContain("## Persistent Rules");
    expect(promptSection).toContain("Project Rule (.dantecode/rules.md)");
    expect(promptSection).toContain("Global Rule (~/.dantecode/rules/safety.md)");
  });

  it("ignores missing and empty rules files", async () => {
    const projectRoot = await makeTempDir("dantecode-project-empty-rules-");
    const globalRoot = await makeTempDir("dantecode-global-empty-rules-");

    await mkdir(join(projectRoot, ".dantecode", "rules"), { recursive: true });
    await writeFile(join(projectRoot, ".dantecode", "rules", "blank.md"), "   \n", "utf8");

    const bundle = await loadPersistentRules(projectRoot, { globalRoot });

    expect(bundle.allRules).toHaveLength(0);
    expect(formatPersistentRulesForPrompt(bundle)).toBeNull();
    await expect(loadPersistentRulesPrompt(projectRoot, { globalRoot })).resolves.toBeNull();
  });
});
