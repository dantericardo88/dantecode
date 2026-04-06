// ============================================================================
// @dantecode/cli — /docs command
// Generates JSDoc/docstring documentation using SEARCH/REPLACE blocks.
// Does NOT rewrite file logic — inserts docs surgically.
// ============================================================================

import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { join } from "node:path";
import type { ModelRouterImpl } from "@dantecode/core";

export type DocStyle = "jsdoc" | "sphinx" | "godoc";

export function detectDocStyle(filePath: string): DocStyle {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".py") return "sphinx";
  if (ext === ".go") return "godoc";
  return "jsdoc";
}

const DOC_SYSTEM_PROMPT = `You are a documentation expert. Add inline documentation to undocumented public APIs.
CRITICAL RULES:
- Use SEARCH/REPLACE blocks for EVERY change (format: filename\\n<<<<<<< SEARCH\\n...\\n=======\\n...\\n>>>>>>> REPLACE)
- Do NOT modify any logic, code structure, or behavior
- Document: purpose, @param (with types), @returns, @throws where relevant, @example for complex APIs
- Only document public/exported symbols
- Skip symbols that already have documentation
- Keep docs concise and accurate`;

export async function generateDocs(
  sourceFilePath: string,
  projectRoot: string,
  router: ModelRouterImpl,
  style?: DocStyle,
): Promise<{ applied: number; failed: number; skipped: number }> {
  const absPath = join(projectRoot, sourceFilePath);
  const content = readFileSync(absPath, "utf-8");
  const resolvedStyle = style ?? detectDocStyle(sourceFilePath);

  const response = await router.generate(
    [{ role: "user", content: `Add ${resolvedStyle} documentation to all undocumented public symbols in this file using SEARCH/REPLACE blocks:\n\n\`\`\`\n${content}\n\`\`\`` }],
    { system: DOC_SYSTEM_PROMPT, maxTokens: 4096 },
  );

  // Use the existing extractEditBlocks and applyEditBlock from tool-call-parser
  const { extractEditBlocks, applyEditBlock } = await import("../tool-call-parser.js");
  const blocks = extractEditBlocks(response);

  let applied = 0;
  let failed = 0;
  let skipped = 0;

  if (blocks.length === 0) {
    skipped = 1; // Model may have found everything already documented
  }

  for (const block of blocks) {
    const result = await applyEditBlock(
      block.filePath || sourceFilePath,
      block.searchContent,
      block.replaceContent,
      projectRoot,
    );
    if (result.success) applied++;
    else failed++;
  }

  return { applied, failed, skipped };
}
