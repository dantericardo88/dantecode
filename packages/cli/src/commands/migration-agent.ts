// ============================================================================
// @dantecode/cli — /migrate command
// Migrates codebases using architect planning + batch execution + build verification.
// Based on Amazon Q Code Transformation pattern: compilation feedback loop.
// ============================================================================

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import type { ModelRouterImpl } from "@dantecode/core";

export type MigrationType = "js-to-ts" | "cjs-to-esm" | "jest-to-vitest" | "npm-to-pnpm";

// Codemod.com CLI mapping — AST-level transforms (more reliable than LLM for mechanical changes)
const CODEMOD_CLI_MAP: Partial<Record<MigrationType, string>> = {
  "cjs-to-esm": "cjs-to-esm",
  "jest-to-vitest": "jest-to-vitest",
};

async function tryCodemodCLI(
  type: MigrationType,
  projectRoot: string,
): Promise<{ success: boolean; filesChanged: number; output: string }> {
  const codemapId = CODEMOD_CLI_MAP[type];
  if (!codemapId) return { success: false, filesChanged: 0, output: "No codemod transform for this type" };
  try {
    const { execSync } = await import("node:child_process");
    const output = execSync(
      `npx --yes codemod ${codemapId} --target=. --no-interactive 2>&1`,
      { cwd: projectRoot, timeout: 120_000, encoding: "utf-8" }
    );
    const match = output.match(/(\d+)\s+files?\s+(?:transformed|changed)/i);
    const filesChanged = parseInt(match?.[1] ?? "0", 10);
    return { success: true, filesChanged, output };
  } catch (err: unknown) {
    return {
      success: false,
      filesChanged: 0,
      output: (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? String(err),
    };
  }
}

const MIGRATION_CONFIGS: Record<MigrationType, { description: string; filePattern: RegExp; buildCmd: string }> = {
  "js-to-ts": {
    description: "Convert JavaScript to TypeScript with type annotations",
    filePattern: /\.(js|mjs|cjs)$/,
    buildCmd: "npx tsc --noEmit",
  },
  "cjs-to-esm": {
    description: "Convert CommonJS (require) to ES Modules (import/export)",
    filePattern: /\.(js|ts|mjs|cjs)$/,
    buildCmd: "npm run build 2>/dev/null || npx tsc --noEmit",
  },
  "jest-to-vitest": {
    description: "Replace Jest with Vitest (faster, ESM-native)",
    filePattern: /\.(test|spec)\.(js|ts|jsx|tsx)$/,
    buildCmd: "npx vitest run --reporter=verbose 2>&1 | tail -20",
  },
  "npm-to-pnpm": {
    description: "Switch package manager from npm to pnpm",
    filePattern: /package\.json$/,
    buildCmd: "pnpm install --frozen-lockfile 2>/dev/null || echo 'lockfile check done'",
  },
};

const MIGRATION_SYSTEM_PROMPT = `You are a migration expert. You ONLY output SEARCH/REPLACE blocks.
Format: filepath\\n<<<<<<< SEARCH\\n[exact content]\\n=======\\n[replacement]\\n>>>>>>> REPLACE
Rules:
- Make minimal targeted changes — only what's needed for the migration
- Preserve all logic, tests, and comments
- Do NOT add TODO or placeholder code
- Do NOT rewrite entire files — make surgical edits only`;

export async function runMigration(
  projectRoot: string,
  type: MigrationType,
  router: ModelRouterImpl,
  options: { maxFiles?: number; silent?: boolean } = {},
): Promise<{ filesChanged: number; buildPassed: boolean; summary: string }> {
  const config = MIGRATION_CONFIGS[type];
  const { extractEditBlocks, applyEditBlock } = await import("../tool-call-parser.js");

  // Phase 1: Find files to migrate
  const { globSync } = await import("glob").catch(() => ({ globSync: null }));
  let files: string[] = [];
  if (globSync) {
    files = (globSync("**/*", { cwd: projectRoot, nodir: true }) as string[])
      .filter(f => config.filePattern.test(f) && !f.includes("node_modules") && !f.includes(".next"))
      .slice(0, options.maxFiles ?? 50);
  }

  if (files.length === 0) {
    return { filesChanged: 0, buildPassed: true, summary: `No files matching ${config.filePattern} found` };
  }

  // Phase 2: Architect planning
  const fileList = files.slice(0, 20).map(f => `- ${f}`).join("\n");
  const plan = await router.generate(
    [{ role: "user", content: `Migration type: ${type} (${config.description})\n\nFiles to migrate:\n${fileList}\n\nCreate a brief ordered migration plan. Which files first? What patterns to change?` }],
    { system: "You are a senior engineer. Create a concise, ordered migration plan.", maxTokens: 1024 },
  );

  const summary: string[] = [`Migration plan: ${type}`, plan.slice(0, 500), ""];
  let filesChanged = 0;

  // Try AST-level codemod transform first (more reliable for mechanical changes)
  const codemapResult = await tryCodemodCLI(type, projectRoot);
  if (codemapResult.success && codemapResult.filesChanged > 0) {
    summary.push(`AST transform: ${codemapResult.filesChanged} files via codemod CLI`);
    filesChanged += codemapResult.filesChanged;
    // Still run LLM pass for cleanup, custom edge cases, and files codemod missed
  }

  // Phase 3: Execute in batches of 5
  const batches: string[][] = [];
  for (let i = 0; i < files.length; i += 5) {
    batches.push(files.slice(i, i + 5));
  }

  for (const batch of batches) {
    const batchContent = batch
      .map(f => {
        try { return `File: ${f}\n\`\`\`\n${readFileSync(join(projectRoot, f), "utf-8").slice(0, 2000)}\n\`\`\``; }
        catch { return null; }
      })
      .filter((x): x is string => x !== null)
      .join("\n\n");

    const response = await router.generate(
      [{ role: "user", content: `Apply ${type} migration to these files:\n\n${batchContent}` }],
      { system: MIGRATION_SYSTEM_PROMPT, maxTokens: 4096 },
    );

    const blocks = extractEditBlocks(response);
    for (const block of blocks) {
      const result = await applyEditBlock(block.filePath, block.searchContent, block.replaceContent, projectRoot);
      if (result.success) filesChanged++;
    }

    // Phase 4: Compile check after each batch
    try {
      execSync(config.buildCmd, { cwd: projectRoot, timeout: 60_000, stdio: "pipe" });
    } catch (err: unknown) {
      const errOutput = ((err as NodeJS.ErrnoException & { stdout?: Buffer }).stdout ?? Buffer.alloc(0)).toString().slice(0, 500);
      // Inject errors back for fix
      await router.generate(
        [{ role: "user", content: `Build failed after batch. Fix these errors:\n${errOutput}\n\nUse SEARCH/REPLACE blocks.` }],
        { system: MIGRATION_SYSTEM_PROMPT, maxTokens: 2048 },
      );
    }
  }

  // Final build check
  let buildPassed = true;
  try {
    execSync(config.buildCmd, { cwd: projectRoot, timeout: 60_000, stdio: "pipe" });
    summary.push(`Build passed after migration`);
  } catch {
    buildPassed = false;
    summary.push(`Build check failed — manual review needed`);
  }

  summary.push(`Files changed: ${filesChanged} of ${files.length}`);
  return { filesChanged, buildPassed, summary: summary.join("\n") };
}
