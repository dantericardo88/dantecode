// ============================================================================
// @dantecode/cli — Context Manager
// Builds system prompts, manages context compaction, and handles cross-session
// learning. Extracted from agent-loop.ts for maintainability.
// ============================================================================

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SessionStore,
  CLAUDE_WORKFLOW_MODE,
  buildWavePrompt,
  buildWorkflowInvocationPrompt,
} from "@dantecode/core";
import type { Session } from "@dantecode/config-types";
import {
  queryLessons,
  formatLessonsForPrompt,
} from "@dantecode/danteforge";
import {
  generateRepoMap,
  formatRepoMapForContext,
} from "@dantecode/git-engine";
import { getToolDefinitions } from "./tools.js";
import type { AgentLoopConfig } from "./agent-loop.js";

/**
 * Builds the system prompt sent to the model. Includes instructions for tool
 * use, the DanteForge doctrine, and project-specific context.
 */
export async function buildSystemPrompt(session: Session, config: AgentLoopConfig): Promise<string> {
  const toolDefs = getToolDefinitions();
  const toolList = toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n");

  const sections: string[] = [
    "You are DanteCode, an expert AI coding agent. You help users write, edit, debug, and maintain code.",
    "",
    "## Available Tools",
    "",
    "You can use the following tools by including tool_use blocks in your response:",
    "",
    toolList,
    "",
    "## Key Principles",
    "",
    "1. ALWAYS produce COMPLETE, PRODUCTION-READY code. Never use stubs, placeholders, or ellipsis.",
    "2. Read files before editing them to understand context.",
    "3. Use Edit for small changes, Write for new files or complete rewrites.",
    "4. Run Bash commands to verify your changes (e.g., type-check, test, lint).",
    "5. Be precise with file paths. Use the Glob tool to find files if unsure.",
    "6. Explain what you are doing and why.",
    "",
    "## Tool Execution Protocol — Sequential Verification",
    "",
    "Tool calls in a single response execute ONE AT A TIME in order. Each result appears BEFORE the next tool runs.",
    "",
    "VERIFY BEFORE PROCEEDING — after any Bash command (git clone, npm install, mkdir), confirm it succeeded:",
    "- After `git clone <url> <dir>`: use ListDir to verify `<dir>` exists before reading files inside it.",
    "- After Bash commands that create directories/files: verify with ListDir before referencing them.",
    "- After `Write <file>`: the SUCCESS result confirms the file exists. If you see ERROR, do NOT proceed as if it succeeded.",
    "- If a tool returns an error, address it immediately. Never skip errors and continue as if they did not happen.",
    "",
    "## Artifact Acquisition Tools",
    "",
    "Prefer these over `Bash curl`/`Bash wget` when downloading files — they auto-verify the download, compute SHA-256, and register a tracked ArtifactRecord:",
    "",
    "- **AcquireUrl** — download any URL to a local file with size check + hash:",
    '  `{"name":"AcquireUrl","input":{"url":"https://example.com/file.tar.gz","dest":"external/file.tar.gz"}}`',
    "- **AcquireArchive** — download AND extract .tar.gz / .zip / .tar.bz2 archives, verifies file count:",
    '  `{"name":"AcquireArchive","input":{"url":"https://example.com/repo.tar.gz","extract_to":"external/repo","strip_components":1}}`',
    "",
    "Both tools return an ArtifactID you can reference in subsequent steps. If either returns isError=true, do NOT proceed as if the file exists.",
    "",
    "JSON TOOL CALL FORMAT — malformed JSON causes SILENT DROPS (file never written, command never ran):",
    '- Double quotes inside string values MUST be escaped: \\"',
    "- Backslashes MUST be escaped: \\\\",
    "- Real newlines inside string values MUST be \\n (not a literal newline character)",
    '- Test JSON mentally: every { must close with }, every " must be paired.',
    "",
  ];

  // Skill execution: when a skill is active, inject either the full Claude Workflow
  // Mode (if wave orchestration is active) or the basic tool recipes + execution protocol.
  if (config.skillActive) {
    if (config.waveState && config.waveState.waves.length > 1) {
      // Wave orchestration: inject Claude Workflow Mode + current wave prompt
      sections.push(CLAUDE_WORKFLOW_MODE, "", buildWavePrompt(config.waveState), "");
    } else {
      // No wave structure detected: inject tool recipes + basic execution protocol.
      sections.push(
        "## Tool Recipes for Skill Execution",
        "",
        "When executing skills, you may need capabilities beyond the basic tool set.",
        "Use Bash to access these — do NOT skip steps because a dedicated tool is missing.",
        "",
        "### Searching GitHub",
        "```bash",
        'gh search repos "react state management" --limit 10 --json name,url,description,stargazersCount',
        "```",
        'To search code: `gh search code "pattern" --limit 10 --json path,repository`',
        "",
        "### Fetching Web Content",
        "```bash",
        "curl -sL 'https://example.com/page' | head -200",
        "```",
        "",
        "### Cloning and Analyzing Repositories",
        "```bash",
        "git clone --depth 1 'https://github.com/org/repo.git' /tmp/oss-scan/reponame",
        "```",
        "Then use Glob, Grep, and Read to analyze the cloned repository.",
        "",
        "### GitHub API Queries",
        "```bash",
        "gh api repos/owner/repo --jq '.stargazers_count, .license.spdx_id'",
        "gh api 'search/repositories?q=topic:state-management+language:typescript&sort=stars' --jq '.items[:5] | .[].full_name'",
        "```",
        "",
        "## Skill Execution Protocol",
        "",
        "You are executing a multi-step skill workflow. Follow this protocol STRICTLY:",
        "",
        "1. **DECOMPOSE FIRST**: Use TodoWrite to create a numbered checklist of all steps before doing any work.",
        "2. **READ BEFORE EDIT**: Always Read a file before modifying it. Never edit blind.",
        "3. **ONE STEP AT A TIME**: Complete one step fully, verify it, then advance to the next.",
        "4. **EVERY RESPONSE = TOOL CALLS**: Never respond with only text/narration. Every response MUST include at least one tool call.",
        "5. **VERIFY EACH STEP**: After completing a step, verify with a concrete check (Read the file, run a test, check git status).",
        "6. **UPDATE PROGRESS**: Mark each TodoWrite item as completed before starting the next.",
        "7. **USE BASH FOR EXTERNAL OPS**: GitHub search, web fetch, repo cloning — use Bash with the recipes above.",
        "8. **NEVER CONFABULATE**: Only claim a file was modified AFTER a successful Edit/Write tool result. Only claim tests pass AFTER a successful Bash test result.",
        "",
      );
    }
  }

  // Workflow contract preamble
  if (config.workflowContext) {
    const preamble = buildWorkflowInvocationPrompt(config.workflowContext);
    sections.push(preamble, "");
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
    sections.push("");
    sections.push("## Files in Context");
    sections.push("");
    for (const file of session.activeFiles) {
      sections.push(`- ${file}`);
    }
  }

  // Repo map injection
  try {
    const repoMap = generateRepoMap(session.projectRoot, { maxFiles: 150 });
    if (repoMap.length > 0) {
      sections.push("", "## Repository Structure", "", formatRepoMapForContext(repoMap));
    }
  } catch {
    // Non-fatal
  }

  // Lesson injection
  try {
    const lessons = await queryLessons({ projectRoot: session.projectRoot, limit: 10 });
    if (lessons.length > 0) {
      sections.push("", "## Learned Patterns (from past sessions)", "");
      sections.push(formatLessonsForPrompt(lessons));
    }
  } catch {
    // Non-fatal
  }

  // Cross-session learning
  try {
    const sessionStore = new SessionStore(session.projectRoot);
    const recentSummaries = await sessionStore.getRecentSummaries(3);
    const pastSummaries = recentSummaries.filter((s) => s.id !== session.id);
    if (pastSummaries.length > 0) {
      sections.push("", "## Recent Session Context", "");
      for (const s of pastSummaries) {
        const dateStr = new Date(s.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        sections.push(`- ${dateStr}: ${s.summary}`);
      }
    }
  } catch {
    // Non-fatal
  }

  // Project notes
  try {
    const danteNotesPath = resolve(session.projectRoot, ".dantecode", "DANTE.md");
    const danteNotes = await readFile(danteNotesPath, "utf-8");
    if (danteNotes.trim().length > 0) {
      sections.push("", "## Project Notes", "", danteNotes.trim());
    }
  } catch {
    // Non-fatal
  }

  // First-turn complexity rating instruction
  if (session.messages.length <= 1) {
    sections.push("");
    sections.push(
      "On your FIRST response only, include at the very end: [COMPLEXITY: X.X] " +
        "where X.X is your 0-1 self-assessment of task complexity. " +
        "0.0 = trivial, 1.0 = extremely complex multi-file refactor.",
    );
  }

  return sections.join("\n");
}
