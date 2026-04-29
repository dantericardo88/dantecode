import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SessionStore,
  getProviderPromptSupplement,
  getCoChangeFiles,
  buildWavePrompt,
  CLAUDE_WORKFLOW_MODE,
  loadRepoMemory,
  ProjectKnowledgeStore,
  rankContextChunks,
  buildFileContextMap,
} from "@dantecode/core";
import type {
  RepoMemory,
  Hotspot,
  SymbolNode,
  TestRelevance,
  WaveOrchestratorState,
} from "@dantecode/core";
import { queryLessons, formatLessonsForPrompt } from "@dantecode/danteforge";
import {
  generateRepoMap,
  formatRepoMapForContext,
  generateSemanticRepoMap,
  formatSemanticRepoMapForContext,
} from "@dantecode/git-engine";
import type { Session } from "@dantecode/config-types";

import { getToolDefinitions } from "./tools.js";

export interface SystemPromptConfig {
  state: {
    model: {
      default: {
        provider: Session["model"]["provider"];
      };
    };
    project: {
      name?: string;
      language?: string;
      framework?: string;
    };
  };
  skillActive?: boolean;
  waveState?: WaveOrchestratorState;
}

export interface MemoryRecallOrchestrator {
  memoryRecall(query: string, limit?: number): Promise<unknown[]>;
}

export function selectHotContext(repoMemory: RepoMemory | null, session: Session): string | null {
  if (!repoMemory) {
    return null;
  }

  const parts: string[] = [];

  if (repoMemory.hotspots.length > 0) {
    const topHotspots = repoMemory.hotspots
      .slice(0, 5)
      .map((hotspot: Hotspot) => `- ${hotspot.file} (${hotspot.changeCount} changes)`);
    parts.push("Recent hot files:", ...topHotspots);
  }

  if (session.activeFiles.length > 0) {
    const relevantSymbols = repoMemory.symbolGraph
      .filter((symbol: SymbolNode) =>
        session.activeFiles.some((activeFile: string) => symbol.file === activeFile),
      )
      .slice(0, 10);
    if (relevantSymbols.length > 0) {
      parts.push(
        "",
        "Symbols in active files:",
        ...relevantSymbols.map(
          (symbol: SymbolNode) => `- ${symbol.name} (${symbol.kind}) in ${symbol.file}`,
        ),
      );
    }
  }

  if (session.activeFiles.length > 0) {
    const relevantTests = repoMemory.testMap
      .filter((test: TestRelevance) =>
        test.sourceFiles.some((sourceFile: string) => session.activeFiles.includes(sourceFile)),
      )
      .slice(0, 5);
    if (relevantTests.length > 0) {
      parts.push(
        "",
        "Related tests:",
        ...relevantTests.map(
          (test: TestRelevance) => `- ${test.testFile} covers ${test.sourceFiles.join(", ")}`,
        ),
      );
    }
  }

  return parts.length > 0 ? parts.join("\n") : null;
}

// ── Static prompt sections ──────────────────────────────────────────────────
// Constant prompt content hoisted to module-level template literals so the
// composer (buildSystemPrompt) stays under the maintainability scanner's
// 100-LOC threshold. Const declarations of TemplateLiteral aren't counted
// as functions by the AST scanner — they're data, not code.

/**
 * Render the base prompt (identity rules → tool list → key principles →
 * trust → SEARCH/REPLACE format → task management). The only dynamic part
 * is the tool list, interpolated mid-template.
 */
function renderBaseSystemPrompt(toolList: string): string {
  return `You are DanteCode, a rigorous coding agent that accomplishes tasks through tool execution.

## Identity Rules

- Your goal is to ACCOMPLISH the task, not engage in conversation.
- Prioritize technical accuracy over validating user beliefs. If something failed, say it failed.
- Never claim a file changed, a bug was fixed, or tests passed unless a tool result confirmed it in this session.
- Every execution round must move the task forward with real tool use. Pure narration is not work.
- When the task is complete, report what was done and what was verified. Do not pad the answer with filler.

## Available Tools

You can use the following tools by including tool_use blocks in your response:

${toolList}

## Key Principles

1. ALWAYS produce COMPLETE, PRODUCTION-READY code. Never use stubs, placeholders, or ellipsis.
2. Read files before editing them to understand context.
3. Use Edit for small changes, Write for new files or complete rewrites.
4. Run Bash commands to verify your changes (e.g., type-check, test, lint).
5. Be precise with file paths. Use the Glob tool to find files if unsure.
6. Keep explanations brief and execution-heavy. Use tools first, prose second.
7. When you are uncertain about an approach, open your response with '[Exploratory] ' to signal low confidence. When highly confident, no prefix is needed.

## Trust and Transparency

- For uncertain or multi-file changes, briefly state what you assume before starting.
- If a change has meaningful risk (deleting data, modifying auth, changing APIs), say so explicitly in one sentence before proceeding.
- When you discover something surprising in the code (unexpected pattern, hidden dependency), surface it with: 'Note: ...'

## Code Edit Format â€” SEARCH/REPLACE Blocks

When editing files, you MAY output SEARCH/REPLACE blocks in your response prose.
They are parsed and applied automatically alongside the Edit tool.

  path/to/file.ts
  <<<<<<< SEARCH
  exact content to find (must match indentation)
  =======
  replacement content
  >>>>>>> REPLACE

Rules:
1. File path on the line IMMEDIATELY before <<<<<<< SEARCH (no blank line between).
2. SEARCH must match file content exactly including indentation.
3. Empty REPLACE = delete match. Empty SEARCH = insert at top / create file.
4. Multiple blocks in one response are applied in order.
5. Edit tool remains available and preferred for simple single replacements.

## Task Management

Use the TodoWrite tool FREQUENTLY to track execution for any multi-step task.
Break complex work into numbered steps before editing.
Mark each todo complete immediately after finishing it. Do not batch completions.
`;
}

/** Skill workflow protocol — pushed when config.skillActive but no wave-state. */
const SKILL_EXECUTION_PROTOCOL = `## Tool Recipes for Skill Execution

When executing skills, you may need capabilities beyond the basic tool set.
Use Bash to access these â€” do NOT skip steps because a dedicated tool is missing.

### Searching GitHub
\`\`\`bash
gh search repos "react state management" --limit 10 --json name,url,description,stargazersCount
\`\`\`
To search code: \`gh search code "pattern" --limit 10 --json path,repository\`

### Fetching Web Content
\`\`\`bash
curl -sL 'https://example.com/page' | head -200
\`\`\`

### Cloning and Analyzing Repositories
\`\`\`bash
git clone --depth 1 'https://github.com/org/repo.git' /tmp/oss-scan/reponame
\`\`\`
Then use Glob, Grep, and Read to analyze the cloned repository.

### GitHub API Queries
\`\`\`bash
gh api repos/owner/repo --jq '.stargazers_count, .license.spdx_id'
gh api 'search/repositories?q=topic:state-management+language:typescript&sort=stars' --jq '.items[:5] | .[].full_name'
\`\`\`

## Skill Execution Protocol

You are executing a multi-step skill workflow. Follow this protocol STRICTLY:

1. **DECOMPOSE FIRST**: Use TodoWrite to create a numbered checklist of all steps before doing any work.
2. **READ BEFORE EDIT**: Always Read a file before modifying it. Never edit blind.
3. **ONE STEP AT A TIME**: Complete one step fully, verify it, then advance to the next.
4. **EVERY RESPONSE = TOOL CALLS**: Never respond with only text/narration. Every response MUST include at least one tool call.
5. **VERIFY EACH STEP**: After completing a step, verify with a concrete check (Read the file, run a test, check git status).
6. **UPDATE PROGRESS**: Mark each TodoWrite item as completed before starting the next.
7. **USE BASH FOR EXTERNAL OPS**: GitHub search, web fetch, repo cloning â€” use Bash with the recipes above.
8. **NEVER CONFABULATE**: Only claim a file was modified AFTER a successful Edit/Write tool result. Only claim tests pass AFTER a successful Bash test result.
`;

// ── Dynamic prompt injections ──────────────────────────────────────────────
// Each helper is a single try/catch async block that pushes into the
// shared `sections` array when its data source is available. Extracted from
// buildSystemPrompt so that function stays a small composer.

async function injectRepoMap(sections: string[], projectRoot: string): Promise<void> {
  try {
    const semanticMap = generateSemanticRepoMap(projectRoot, { maxFiles: 150 });
    if (semanticMap.length > 0) {
      sections.push("", formatSemanticRepoMapForContext(semanticMap));
      return;
    }
  } catch { /* fall through to non-semantic map */ }
  try {
    const repoMap = generateRepoMap(projectRoot, { maxFiles: 150 });
    if (repoMap.length > 0) {
      sections.push("", "## Repository Structure", "", formatRepoMapForContext(repoMap));
    }
  } catch { /* non-fatal */ }
}

async function injectMicroagents(sections: string[], projectRoot: string, userPrompt: string): Promise<void> {
  try {
    const { loadMicroagents, findActiveMicroagents, formatMicroagentContext } = await import(
      "./microagent-loader.js"
    );
    const microagents = loadMicroagents(projectRoot);
    const active = findActiveMicroagents(microagents, userPrompt);
    if (active.length > 0) {
      const ctx = formatMicroagentContext(active);
      if (ctx.length > 0) sections.push("", ctx);
    }
  } catch { /* non-fatal */ }
}

async function injectLessons(sections: string[], projectRoot: string): Promise<void> {
  try {
    const lessons = await queryLessons({ projectRoot, limit: 10 });
    if (lessons.length > 0) {
      sections.push("", "## Learned Patterns (from past sessions)", "", formatLessonsForPrompt(lessons));
    }
  } catch { /* non-fatal */ }
}

async function injectTaskOutcomes(sections: string[], projectRoot: string): Promise<void> {
  try {
    const danteforge = (await import("@dantecode/danteforge")) as unknown as typeof import("@dantecode/danteforge") & {
      summarizeTaskOutcomeTrends: (outcomes: unknown[]) => unknown;
      formatTaskOutcomeTrendSummary: (summary: unknown) => string;
      queryRecentTaskOutcomes: (projectRoot: string, limit: number) => Promise<unknown[]>;
      formatTaskOutcomesForPrompt: (outcomes: unknown[]) => string;
    };
    const recent = await danteforge.queryRecentTaskOutcomes(projectRoot, 5);
    if (recent.length > 0) {
      sections.push("", "## Recent Task Outcomes", "", danteforge.formatTaskOutcomesForPrompt(recent));
      sections.push("", "## Task Outcome Trends", "",
        danteforge.formatTaskOutcomeTrendSummary(danteforge.summarizeTaskOutcomeTrends(recent)));
    }
  } catch { /* non-fatal */ }
}

async function injectBenchmarkOutcomes(sections: string[], projectRoot: string): Promise<void> {
  try {
    const danteforge = (await import("@dantecode/danteforge")) as unknown as typeof import("@dantecode/danteforge") & {
      queryRecentBenchmarkOutcomes: (projectRoot: string, limit?: number) => Promise<unknown[]>;
      formatBenchmarkOutcomesForPrompt: (outcomes: unknown[]) => string;
    };
    const recent = await danteforge.queryRecentBenchmarkOutcomes(projectRoot, 3);
    if (recent.length > 0) {
      sections.push("", "## Recent Benchmark Outcomes", "", danteforge.formatBenchmarkOutcomesForPrompt(recent));
    }
  } catch { /* non-fatal */ }
}

async function injectRecentSessionSummaries(sections: string[], session: Session): Promise<void> {
  try {
    const sessionStore = new SessionStore(session.projectRoot);
    const recentSummaries = await sessionStore.getRecentSummaries(3);
    const past = recentSummaries.filter((s) => s.id !== session.id);
    if (past.length === 0) return;
    sections.push("", "## Recent Session Context", "");
    for (const s of past) {
      const dateStr = new Date(s.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      sections.push(`- ${dateStr}: ${s.summary}`);
    }
  } catch { /* non-fatal */ }
}

async function injectMemoryRecall(
  sections: string[],
  userPrompt: string,
  memOrchestrator: MemoryRecallOrchestrator,
): Promise<void> {
  if (userPrompt.length === 0) return;
  try {
    const recalled = await memOrchestrator.memoryRecall(userPrompt, 8);
    if (!Array.isArray(recalled) || recalled.length === 0) return;
    const rawTexts = recalled
      .map((r: unknown) => {
        const entry = r as { content?: string; text?: string; value?: string };
        return entry.content ?? entry.text ?? entry.value ?? String(r);
      })
      .filter(Boolean);
    // BM25-rank recalled facts by relevance to the query (dim 4 — repo context quality)
    const rankedResult = rankContextChunks(
      rawTexts.map((text, idx) => ({ filePath: `memory-${idx}`, content: text, startLine: 0, endLine: 0 })),
      userPrompt,
      2000,
      "bm25",
    );
    const recallLines = rankedResult.chunks.map((c) => `- ${c.content}`);
    if (recallLines.length > 0) sections.push("", "## DanteMemory (Semantic Recall)", "", ...recallLines);
  } catch { /* non-fatal */ }
}

async function injectActiveSkill(
  sections: string[],
  projectRoot: string,
  waveState: WaveOrchestratorState,
): Promise<void> {
  try {
    const { getSkill } = await import("@dantecode/skill-adapter");
    const skillId = (waveState as { skillId?: string }).skillId;
    if (!skillId) return;
    const skill = await getSkill(skillId, projectRoot);
    if (!skill) return;
    const toolList = Array.isArray(skill.frontmatter.tools) && skill.frontmatter.tools.length > 0
      ? skill.frontmatter.tools.join(", ")
      : "any";
    sections.push(
      "",
      `## Active Skill: ${skill.frontmatter.name}`,
      "",
      skill.frontmatter.description,
      "",
      `Required tools: ${toolList}`,
    );
  } catch { /* non-fatal */ }
}

function injectProjectKnowledge(sections: string[], session: Session): void {
  try {
    const knowledgeStore = new ProjectKnowledgeStore(session.projectRoot);
    const knowledgeBlock = knowledgeStore.formatForPrompt(8, session.id);
    if (knowledgeBlock) sections.push("", knowledgeBlock);
  } catch { /* non-fatal */ }
}

async function injectDanteNotes(sections: string[], projectRoot: string): Promise<void> {
  try {
    const danteNotesPath = resolve(projectRoot, ".dantecode", "DANTE.md");
    const danteNotes = await readFile(danteNotesPath, "utf-8");
    if (danteNotes.trim().length > 0) {
      sections.push("", "## Project Notes", "", danteNotes.trim());
    }
  } catch { /* non-fatal */ }
}

function injectHotContext(sections: string[], repoMemory: RepoMemory | null, session: Session): void {
  if (!repoMemory) return;
  const hotContext = selectHotContext(repoMemory, session);
  if (hotContext) sections.push("", "## Hot Context from Repo Memory", "", hotContext);
}

async function injectCoChangeContext(sections: string[], session: Session): Promise<void> {
  try {
    const coChangeLines: string[] = [];
    for (const file of session.activeFiles.slice(0, 3)) {
      const partners = await getCoChangeFiles(session.projectRoot, file, 3);
      if (partners.length > 0) coChangeLines.push(`  ${file}: → ${partners.join(", ")}`);
    }
    if (coChangeLines.length > 0) {
      sections.push(
        "",
        "## Co-Change Patterns (files that often change together)",
        "When editing these files, check the partners too:",
        ...coChangeLines,
      );
    }
  } catch { /* non-fatal */ }
}

function injectImportGraphContext(sections: string[], session: Session): void {
  // Sprint CG — Dim 4: import graph dependency context
  try {
    const fileCtx = buildFileContextMap(session.activeFiles.slice(0, 5), session.projectRoot);
    if (fileCtx.relatedFiles.length > 0) {
      sections.push("", "## Import Graph Context (files imported by active files)", fileCtx.contextSummary);
    }
  } catch { /* non-fatal */ }
}

async function injectNegativeExamples(sections: string[], userPrompt: string): Promise<void> {
  try {
    const { selectNegativeExamples, formatNegativeExamples } = await import("./negative-examples.js");
    const examples = selectNegativeExamples(userPrompt, 3);
    const formatted = formatNegativeExamples(examples);
    if (formatted) sections.push("", formatted);
  } catch { /* non-fatal */ }
}

export async function buildSystemPrompt(
  session: Session,
  config: SystemPromptConfig,
  userPrompt?: string,
  memOrchestrator?: MemoryRecallOrchestrator,
): Promise<string> {
  const repoMemory = await loadRepoMemory(session.projectRoot);
  const toolDefs = getToolDefinitions();
  const toolList = toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n");

  const sections: string[] = [renderBaseSystemPrompt(toolList)];

  sections.push(getProviderPromptSupplement(config.state.model.default.provider), "");

  if (config.skillActive) {
    if (config.waveState && config.waveState.waves.length > 1) {
      sections.push(CLAUDE_WORKFLOW_MODE, "", buildWavePrompt(config.waveState), "");
    } else {
      sections.push(SKILL_EXECUTION_PROTOCOL);
    }
  }

  sections.push("## Project Context", "", `Project root: ${session.projectRoot}`);

  if (config.state.project.name) {
    sections.push(`Project name: ${config.state.project.name}`);
  }
  if (config.state.project.language) {
    sections.push(`Language: ${config.state.project.language}`);
  }
  if (config.state.project.framework) {
    sections.push(`Framework: ${config.state.project.framework}`);
  }

  if (session.activeFiles.length > 0) {
    sections.push("", "## Files in Context", "");
    for (const file of session.activeFiles) {
      sections.push(`- ${file}`);
    }
  }

  await injectRepoMap(sections, session.projectRoot);
  if (userPrompt) await injectMicroagents(sections, session.projectRoot, userPrompt);
  await injectLessons(sections, session.projectRoot);
  await injectTaskOutcomes(sections, session.projectRoot);
  await injectBenchmarkOutcomes(sections, session.projectRoot);
  await injectRecentSessionSummaries(sections, session);

  injectProjectKnowledge(sections, session);
  if (userPrompt && memOrchestrator) await injectMemoryRecall(sections, userPrompt, memOrchestrator);
  await injectDanteNotes(sections, session.projectRoot);
  injectHotContext(sections, repoMemory, session);
  if (config.skillActive && config.waveState) {
    await injectActiveSkill(sections, session.projectRoot, config.waveState);
  }
  if (session.activeFiles.length > 0) {
    await injectCoChangeContext(sections, session);
    injectImportGraphContext(sections, session);
  }
  if (userPrompt) await injectNegativeExamples(sections, userPrompt);

  return sections.join("\n");
}
