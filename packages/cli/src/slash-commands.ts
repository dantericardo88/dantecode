// ============================================================================
// @dantecode/cli — Slash Command Router for the REPL
// Each slash command is a function that operates on the REPL state.
// ============================================================================

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readAuditEvents, MultiAgent, ModelRouterImpl } from "@dantecode/core";
import type { MultiAgentProgressCallback } from "@dantecode/core";
import {
  runLocalPDSEScorer,
  runGStack,
  allGStackPassed,
  summarizeGStackResults,
  queryLessons,
  formatLessonsForPrompt,
  runAutoforgeIAL,
  formatBladeProgressLine,
} from "@dantecode/danteforge";
import { listSkills, getSkill } from "@dantecode/skill-adapter";
import {
  getStatus,
  getDiff,
  autoCommit,
  revertLastCommit,
  createWorktree,
} from "@dantecode/git-engine";
import type { Session, SessionMessage, DanteCodeState, ModelConfig } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The mutable state shared between all slash commands and the REPL. */
export interface ReplState {
  session: Session;
  state: DanteCodeState;
  projectRoot: string;
  verbose: boolean;
  enableGit: boolean;
  enableSandbox: boolean;
  /** Whether silent mode is active (toggle with /silent). */
  silent: boolean;
  lastEditFile: string | null;
  lastEditContent: string | null;
  /** Tracks recent tool call signatures for stuck-loop detection (from opencode/OpenHands). */
  recentToolCalls: string[];
  /** When set by a slash command, processInput will feed this prompt to the agent loop. */
  pendingAgentPrompt: string | null;
  /** Active abort controller for cancelling streaming generation via Ctrl+C. */
  activeAbortController: AbortController | null;
}

/** A single slash command handler. */
interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  handler: (args: string, state: ReplState) => Promise<string>;
}

// ----------------------------------------------------------------------------
// Command Implementations
// ----------------------------------------------------------------------------

async function helpCommand(_args: string, _state: ReplState): Promise<string> {
  const lines = ["", `${BOLD}Available Slash Commands${RESET}`, ""];

  for (const cmd of SLASH_COMMANDS) {
    lines.push(`  ${YELLOW}${cmd.usage.padEnd(28)}${RESET} ${DIM}${cmd.description}${RESET}`);
  }

  lines.push("");
  lines.push(
    `${DIM}Type a command with / prefix, or type naturally to chat with the agent.${RESET}`,
  );
  lines.push("");

  return lines.join("\n");
}

async function modelCommand(args: string, state: ReplState): Promise<string> {
  const modelId = args.trim();
  if (!modelId) {
    const current = state.state.model.default;
    return `${DIM}Current model:${RESET} ${BOLD}${current.provider}/${current.modelId}${RESET}\n\n${DIM}Usage: /model <provider/modelId> (e.g. /model grok/grok-3)${RESET}`;
  }

  // Parse provider/modelId format
  const parts = modelId.split("/");
  let provider: string;
  let model: string;

  if (parts.length >= 2) {
    provider = parts[0]!;
    model = parts.slice(1).join("/");
  } else {
    // Infer provider from model name
    if (modelId.startsWith("grok")) {
      provider = "grok";
    } else if (modelId.startsWith("claude")) {
      provider = "anthropic";
    } else if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")) {
      provider = "openai";
    } else if (modelId.startsWith("gemini")) {
      provider = "google";
    } else {
      provider = "grok";
    }
    model = modelId;
  }

  const newModelConfig: ModelConfig = {
    ...state.state.model.default,
    provider: provider as ModelConfig["provider"],
    modelId: model,
  };

  state.state.model.default = newModelConfig;
  state.session.model = newModelConfig;

  return `${GREEN}Model switched to${RESET} ${BOLD}${provider}/${model}${RESET}`;
}

async function addCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /add <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const lineCount = content.split("\n").length;

    if (!state.session.activeFiles.includes(resolved)) {
      state.session.activeFiles.push(resolved);
    }

    // Add as a system message so the agent has the context
    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: `File added to context: ${resolved}\n\n\`\`\`\n${content}\n\`\`\``,
      timestamp: new Date().toISOString(),
    });

    return `${GREEN}Added${RESET} ${resolved} ${DIM}(${lineCount} lines)${RESET}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error reading file: ${message}${RESET}`;
  }
}

async function dropCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /drop <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);
  const index = state.session.activeFiles.indexOf(resolved);

  if (index === -1) {
    // Try matching by relative path
    const relativeMatch = state.session.activeFiles.findIndex(
      (f) => relative(state.projectRoot, f) === filePath || f.endsWith(filePath),
    );
    if (relativeMatch === -1) {
      return `${YELLOW}File not in context: ${filePath}${RESET}`;
    }
    const removed = state.session.activeFiles.splice(relativeMatch, 1)[0];
    return `${GREEN}Removed${RESET} ${removed} from context`;
  }

  state.session.activeFiles.splice(index, 1);
  return `${GREEN}Removed${RESET} ${resolved} from context`;
}

async function filesCommand(_args: string, state: ReplState): Promise<string> {
  if (state.session.activeFiles.length === 0) {
    return `${DIM}No files in context. Use /add <file> to add files.${RESET}`;
  }

  const lines = [`${BOLD}Files in context:${RESET}`, ""];
  for (const file of state.session.activeFiles) {
    const rel = relative(state.projectRoot, file);
    lines.push(`  ${DIM}-${RESET} ${rel}`);
  }
  lines.push("");
  lines.push(`${DIM}${state.session.activeFiles.length} file(s) total${RESET}`);
  return lines.join("\n");
}

async function diffCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const diff = getDiff(state.projectRoot);
    if (!diff || diff.trim().length === 0) {
      return `${DIM}No unstaged changes.${RESET}`;
    }
    return `${BOLD}Unstaged changes:${RESET}\n\n${diff}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error getting diff: ${message}${RESET}`;
  }
}

async function commitCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const status = getStatus(state.projectRoot);
    const filesToCommit = [
      ...status.staged.map((s: { path: string }) => s.path),
      ...status.unstaged.map((s: { path: string }) => s.path),
      ...status.untracked.map((s: { path: string }) => s.path),
    ];

    if (filesToCommit.length === 0) {
      return `${DIM}Nothing to commit. Working tree is clean.${RESET}`;
    }

    const commitResult = autoCommit(
      {
        message: `${state.state.git.commitPrefix} update ${filesToCommit.length} file(s)`,
        footer:
          "Generated with DanteCode (https://dantecode.dev)\n\nCo-Authored-By: DanteCode <noreply@dantecode.dev>",
        files: filesToCommit,
        allowEmpty: false,
      },
      state.projectRoot,
    );

    return `${GREEN}Committed${RESET} ${commitResult.commitHash.slice(0, 8)}: ${commitResult.message.split("\n")[0]}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Commit error: ${message}${RESET}`;
  }
}

async function revertCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const result = revertLastCommit(state.projectRoot);
    return `${GREEN}Reverted last commit.${RESET} New HEAD: ${result.slice(0, 8)}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Revert error: ${message}${RESET}`;
  }
}

async function undoCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.lastEditFile || !state.lastEditContent) {
    return `${DIM}Nothing to undo. No previous edit recorded.${RESET}`;
  }

  try {
    await writeFile(state.lastEditFile, state.lastEditContent, "utf-8");
    const filePath = state.lastEditFile;
    state.lastEditFile = null;
    state.lastEditContent = null;
    return `${GREEN}Undone${RESET} last edit to ${filePath}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Undo error: ${message}${RESET}`;
  }
}

async function lessonsCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const lessons = await queryLessons({
      projectRoot: state.projectRoot,
      limit: 20,
    });

    if (lessons.length === 0) {
      return `${DIM}No lessons recorded for this project yet.${RESET}`;
    }

    const formatted = formatLessonsForPrompt(lessons);
    return formatted;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error loading lessons: ${message}${RESET}`;
  }
}

async function pdseCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    return `${RED}Usage: /pdse <file_path>${RESET}`;
  }

  const resolved = resolve(state.projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const score = runLocalPDSEScorer(content, state.projectRoot);

    const lines = [
      `${BOLD}PDSE Score for ${relative(state.projectRoot, resolved)}${RESET}`,
      "",
      `  Overall:       ${score.passedGate ? GREEN : RED}${score.overall}/100${RESET} ${score.passedGate ? "(PASSED)" : "(FAILED)"}`,
      `  Completeness:  ${score.completeness}/100`,
      `  Correctness:   ${score.correctness}/100`,
      `  Clarity:       ${score.clarity}/100`,
      `  Consistency:   ${score.consistency}/100`,
    ];

    if (score.violations.length > 0) {
      lines.push("");
      lines.push(`  ${BOLD}Violations (${score.violations.length}):${RESET}`);
      for (const v of score.violations.slice(0, 10)) {
        const lineRef = v.line ? `line ${v.line}` : "?";
        const severity = v.severity === "hard" ? RED : YELLOW;
        lines.push(`    ${severity}[${v.severity}]${RESET} ${DIM}${lineRef}:${RESET} ${v.message}`);
      }
      if (score.violations.length > 10) {
        lines.push(`    ${DIM}... and ${score.violations.length - 10} more${RESET}`);
      }
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error scoring file: ${message}${RESET}`;
  }
}

async function qaCommand(_args: string, state: ReplState): Promise<string> {
  const gstackCommands = state.state.autoforge.gstackCommands;

  if (gstackCommands.length === 0) {
    return `${DIM}No GStack commands configured. Configure them in STATE.yaml.${RESET}`;
  }

  process.stdout.write(
    `${DIM}Running GStack QA pipeline (${gstackCommands.length} commands)...${RESET}\n`,
  );

  try {
    const results = await runGStack("", gstackCommands, state.projectRoot);
    const allPassed = allGStackPassed(results);
    const summary = summarizeGStackResults(results);

    const header = allPassed
      ? `${GREEN}${BOLD}GStack QA: ALL PASSED${RESET}`
      : `${RED}${BOLD}GStack QA: SOME FAILED${RESET}`;

    return `${header}\n\n${summary}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}GStack error: ${message}${RESET}`;
  }
}

async function auditCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const events = await readAuditEvents(state.projectRoot, {
      limit: 20,
    });

    if (events.length === 0) {
      return `${DIM}No audit events recorded yet.${RESET}`;
    }

    const lines = [`${BOLD}Recent Audit Events (${events.length}):${RESET}`, ""];
    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      lines.push(`  ${DIM}${time}${RESET} ${YELLOW}[${event.type}]${RESET} ${event.modelId}`);
    }

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Audit error: ${message}${RESET}`;
  }
}

async function clearCommand(_args: string, state: ReplState): Promise<string> {
  const count = state.session.messages.length;
  state.session.messages = [];
  state.session.activeFiles = [];
  return `${GREEN}Cleared${RESET} ${count} messages and all context files.`;
}

async function tokensCommand(_args: string, state: ReplState): Promise<string> {
  let totalTokens = 0;
  let messageCount = 0;

  for (const msg of state.session.messages) {
    messageCount++;
    if (msg.tokensUsed) {
      totalTokens += msg.tokensUsed;
    } else if (typeof msg.content === "string") {
      // Rough estimate: 1 token per 4 characters
      totalTokens += Math.ceil(msg.content.length / 4);
    }
  }

  const lines = [
    `${BOLD}Token Usage${RESET}`,
    "",
    `  Messages:       ${messageCount}`,
    `  Est. tokens:    ${totalTokens.toLocaleString()}`,
    `  Context window: ${state.state.model.default.contextWindow.toLocaleString()}`,
    `  Utilization:    ${((totalTokens / state.state.model.default.contextWindow) * 100).toFixed(1)}%`,
  ];

  return lines.join("\n");
}

async function webCommand(args: string, _state: ReplState): Promise<string> {
  const url = args.trim();
  if (!url) {
    return `${RED}Usage: /web <url>${RESET}`;
  }

  // Validate URL format
  try {
    new URL(url);
  } catch {
    return `${RED}Invalid URL: ${url}${RESET}`;
  }

  try {
    // Use a simple fetch to get the URL content
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DanteCode/1.0.0",
        Accept: "text/html,text/plain,application/json",
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return `${RED}HTTP ${response.status}: ${response.statusText}${RESET}`;
    }

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    // Truncate to a reasonable size for context
    const maxChars = 50000;
    const truncated =
      text.length > maxChars
        ? text.slice(0, maxChars) + `\n\n... (truncated, ${text.length} chars total)`
        : text;

    return `${GREEN}Fetched${RESET} ${url} ${DIM}(${text.length} chars, ${contentType})${RESET}\n\n${truncated}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Fetch error: ${message}${RESET}`;
  }
}

async function skillCommand(args: string, state: ReplState): Promise<string> {
  const skillName = args.trim();
  if (!skillName) {
    // List skills
    const skills = await listSkills(state.projectRoot);
    if (skills.length === 0) {
      return `${DIM}No skills imported. Use 'dantecode skills import' to import skills.${RESET}`;
    }

    const lines = [`${BOLD}Available Skills:${RESET}`, ""];
    for (const skill of skills) {
      lines.push(`  ${YELLOW}${skill.name.padEnd(24)}${RESET} ${DIM}${skill.description}${RESET}`);
    }
    return lines.join("\n");
  }

  // Activate a specific skill
  const skill = await getSkill(skillName, state.projectRoot);
  if (!skill) {
    return `${RED}Skill not found: ${skillName}${RESET}`;
  }

  // Inject the skill instructions into the session as a system message
  state.session.messages.push({
    id: randomUUID(),
    role: "system",
    content: `Activated skill "${skill.frontmatter.name}": ${skill.frontmatter.description}\n\n${skill.instructions}`,
    timestamp: new Date().toISOString(),
  });

  return `${GREEN}Activated skill:${RESET} ${BOLD}${skill.frontmatter.name}${RESET}\n${DIM}${skill.frontmatter.description}${RESET}`;
}

async function agentsCommand(_args: string, state: ReplState): Promise<string> {
  const agentsDir = join(state.projectRoot, ".dantecode", "agents");

  try {
    const entries = await readdir(agentsDir);
    const agentFiles = entries.filter(
      (e) => e.endsWith(".yaml") || e.endsWith(".yml") || e.endsWith(".md"),
    );

    if (agentFiles.length === 0) {
      return `${DIM}No agent definitions found in ${agentsDir}${RESET}`;
    }

    const lines = [`${BOLD}Available Agents:${RESET}`, ""];
    for (const file of agentFiles) {
      const name = file.replace(/\.(yaml|yml|md)$/, "");
      lines.push(`  ${YELLOW}${name}${RESET}`);
    }
    return lines.join("\n");
  } catch {
    return `${DIM}No agent definitions directory found. Run 'dantecode init' to create one.${RESET}`;
  }
}

async function worktreeCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.enableGit) {
    return `${YELLOW}Git is disabled for this session (--no-git).${RESET}`;
  }

  try {
    const branchName = `dantecode/${state.session.id.slice(0, 8)}`;
    let baseBranch: string;

    try {
      baseBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: state.projectRoot,
        encoding: "utf-8",
      }).trim();
    } catch {
      baseBranch = "main";
    }

    const result = createWorktree({
      branch: branchName,
      baseBranch,
      sessionId: state.session.id,
      directory: state.projectRoot,
    });

    state.session.worktreeRef = result.branch;

    return `${GREEN}Created worktree${RESET}\n  Branch: ${BOLD}${result.branch}${RESET}\n  Directory: ${result.directory}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Worktree error: ${message}${RESET}`;
  }
}

async function readOnlyCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) {
    // Show current read-only files
    if (state.session.readOnlyFiles.length === 0) {
      return `${DIM}No read-only files. Use /read-only <file> to add reference context.${RESET}`;
    }
    const lines = [`${BOLD}Read-only files (reference only, not editable):${RESET}`, ""];
    for (const file of state.session.readOnlyFiles) {
      const rel = relative(state.projectRoot, file);
      lines.push(`  ${DIM}-${RESET} ${rel}`);
    }
    return lines.join("\n");
  }

  const resolved = resolve(state.projectRoot, filePath);

  try {
    const content = await readFile(resolved, "utf-8");
    const lineCount = content.split("\n").length;

    if (!state.session.readOnlyFiles.includes(resolved)) {
      state.session.readOnlyFiles.push(resolved);
    }
    // Remove from editable files if present
    const editIdx = state.session.activeFiles.indexOf(resolved);
    if (editIdx !== -1) {
      state.session.activeFiles.splice(editIdx, 1);
    }

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: `Reference file (READ-ONLY, do not edit): ${resolved}\n\n\`\`\`\n${content}\n\`\`\``,
      timestamp: new Date().toISOString(),
    });

    return `${GREEN}Added (read-only)${RESET} ${resolved} ${DIM}(${lineCount} lines)${RESET}`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Error reading file: ${message}${RESET}`;
  }
}

async function compactCommand(_args: string, state: ReplState): Promise<string> {
  const before = state.session.messages.length;
  if (before <= 10) {
    return `${DIM}Session is small (${before} messages), no compaction needed.${RESET}`;
  }

  const KEEP_RECENT = 10;
  const kept = state.session.messages.slice(-KEEP_RECENT);
  const dropped = before - KEEP_RECENT;

  const summaryMsg: SessionMessage = {
    id: randomUUID(),
    role: "system",
    content: `[Context compacted: ${dropped} earlier messages were removed to free context space.]`,
    timestamp: new Date().toISOString(),
  };

  state.session.messages = [summaryMsg, ...kept];
  return `${GREEN}Compacted${RESET} ${dropped} messages → ${state.session.messages.length} remaining`;
}

async function architectCommand(_args: string, state: ReplState): Promise<string> {
  const ARCHITECT_MARKER = "[ARCHITECT MODE]";
  const hasArchitect = state.session.messages.some(
    (m) => m.role === "system" && typeof m.content === "string" && m.content.includes(ARCHITECT_MARKER),
  );

  if (hasArchitect) {
    state.session.messages = state.session.messages.filter(
      (m) => !(m.role === "system" && typeof m.content === "string" && m.content.includes(ARCHITECT_MARKER)),
    );
    return `${YELLOW}Architect mode OFF${RESET} — direct coding mode resumed.`;
  }

  state.session.messages.push({
    id: randomUUID(),
    role: "system",
    content: `${ARCHITECT_MARKER}\nYou are now in Architect mode. Before writing any code:\n1. Analyze the full scope of the request\n2. Identify all files that need to change\n3. Draft a step-by-step plan with file paths and change descriptions\n4. Present the plan to the user for approval\n5. Only after approval, implement the changes one file at a time\n6. After each file change, run verification (lint/test/build) before moving to the next`,
    timestamp: new Date().toISOString(),
  });

  return `${GREEN}Architect mode ON${RESET} — the agent will plan before coding.`;
}

async function ossCommand(args: string, state: ReplState): Promise<string> {
  const focusArea = args.trim();

  const ossInstructions = `[OSS RESEARCHER — AUTONOMOUS PIPELINE]

You are now executing the /oss pipeline. Follow these steps AUTONOMOUSLY — do NOT ask the user for permission at any step.

## Phase 0: Auto-Detect This Project
Read the project root, package.json, README.md, and key source files to understand what this project is, what language/framework it uses, and what features it already has.

## Phase 1: Internet Search
Using what you learned about this project, search the internet for the 5-10 most relevant open source projects in the same domain. Use WebSearch to find repos with 1k+ stars, permissive licenses, and active maintenance.${focusArea ? `\n\nFocus area: ${focusArea}` : ""}

## Phase 2: Clone & License Gate
Clone each repo shallow into /tmp/oss-research-<name>. Check LICENSE files — skip GPL/AGPL/SSPL. Delete blocked repos immediately.

## Phase 3: Rapid Scan
For each repo: read entry points, glob for key patterns, note architecture and unique features. Spend 2-3 minutes max per repo.

## Phase 4: Deep Pattern Extraction
Use parallel subagents to analyze each repo. Look for architecture patterns, agent/AI patterns, CLI/UX patterns, quality patterns, and unique innovations.

## Phase 5: Gap Analysis
Compare findings against this project. Rank patterns by P0 (critical, small effort) through P3 (niche, large effort). Select the top 5-8 P0/P1 items.

## Phase 6: Implement
Implement each pattern directly — no stubs, no TODOs, no placeholders. Run typecheck/lint/test after each change. Commit each logical change.

## Phase 7: Autoforge Verification
Run the full QA pipeline. Fix any failures. Continue until ALL checks pass or 3 retry cycles complete.

## Cleanup
rm -rf /tmp/oss-research-* when done.

Rules: Never copy code verbatim. Always check licenses. Clean up cloned repos. Verify every change compiles and passes tests.`;

  state.session.messages.push({
    id: randomUUID(),
    role: "system",
    content: ossInstructions,
    timestamp: new Date().toISOString(),
  });

  // Set the pending agent prompt so processInput chains into the agent loop
  const prompt = focusArea
    ? `Execute the /oss pipeline now. Focus area: ${focusArea}. Start with Phase 0 — scan this project, then search the internet for relevant OSS, clone them, analyze, harvest patterns, implement, and run autoforge.`
    : `Execute the /oss pipeline now. Start with Phase 0 — scan this project to understand what it does, then search the internet for the most relevant OSS tools in the same domain, clone them, analyze, harvest the best patterns, implement them, and run autoforge to verify everything passes.`;

  state.pendingAgentPrompt = prompt;

  return `${GREEN}${BOLD}OSS Research Pipeline activated${RESET}\n${DIM}Scanning project → searching internet → cloning repos → analyzing → implementing → autoforging${RESET}`;
}

async function sandboxCommand(_args: string, state: ReplState): Promise<string> {
  state.enableSandbox = !state.enableSandbox;
  const statusText = state.enableSandbox ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  return `${BOLD}Sandbox mode:${RESET} ${statusText}`;
}

async function silentCommand(_args: string, state: ReplState): Promise<string> {
  state.silent = !state.silent;
  const statusText = state.silent ? `${GREEN}ON${RESET}` : `${RED}OFF${RESET}`;
  return `${BOLD}Silent mode:${RESET} ${statusText}${state.silent ? ` ${DIM}(compact progress only)${RESET}` : ""}`;
}

async function autoforgeCommand(args: string, state: ReplState): Promise<string> {
  const flags = args.trim().split(/\s+/);
  const silentMode = flags.includes("--silent");
  const persistUntilGreen = flags.includes("--persist");
  const hardCeiling = persistUntilGreen ? 200 : state.state.autoforge.maxIterations;

  // If no active files or last edit, show config summary
  if (!state.lastEditFile && state.session.activeFiles.length === 0) {
    const lines: string[] = [
      `${BOLD}Autoforge Configuration:${RESET}`,
      `  Silent mode: ${silentMode ? `${GREEN}ON${RESET}` : `${DIM}OFF${RESET}`}`,
      `  Persist until green: ${persistUntilGreen ? `${GREEN}ON${RESET}` : `${DIM}OFF${RESET}`}`,
      `  Hard ceiling: ${hardCeiling} rounds`,
      `  GStack commands: ${state.state.autoforge.gstackCommands.length}`,
      "",
      `${DIM}Add a file with /add <file> then run /autoforge to start the loop.${RESET}`,
    ];
    return lines.join("\n");
  }

  // Get the code to autoforge from the last edited file or the first active file
  const targetFile = state.lastEditFile ?? state.session.activeFiles[0]!;
  let code: string;
  try {
    code = await readFile(resolve(state.projectRoot, targetFile), "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Error reading target file: ${msg}${RESET}`;
  }

  process.stdout.write(
    `${DIM}Starting Autoforge IAL on ${targetFile} (max ${hardCeiling} iterations)...${RESET}\n`,
  );

  // Build a simple ModelRouter adapter for the REPL
  const router = {
    chat: async (prompt: string, _opts?: { temperature?: number; maxTokens?: number }) => {
      // In CLI mode without a live model connection, return the prompt as-is.
      // The full agent loop provides model-backed autoforge.
      return prompt;
    },
    getConfig: () => ({
      default: state.state.model.default,
      fallback: state.state.model.fallback,
      overrides:
        ((state.state.model as Record<string, unknown>)["taskOverrides"] as Record<
          string,
          import("@dantecode/config-types").ModelConfig
        >) ?? {},
    }),
  };

  try {
    const autoforgeConfig = {
      ...state.state.autoforge,
      maxIterations: hardCeiling,
      enabled: true,
    } as import("@dantecode/config-types").BladeAutoforgeConfig;
    autoforgeConfig.silentMode = silentMode;
    autoforgeConfig.persistUntilGreen = persistUntilGreen;
    autoforgeConfig.hardCeiling = hardCeiling;

    const result = await runAutoforgeIAL(
      code,
      {
        taskDescription: `Autoforge quality improvement for ${targetFile}`,
        filePath: targetFile,
      },
      autoforgeConfig,
      router,
      state.projectRoot,
      silentMode
        ? undefined
        : (progressState) => {
            process.stdout.write(`\r${formatBladeProgressLine(progressState)}`);
          },
    );

    process.stdout.write("\n");

    const lines: string[] = [
      "",
      result.succeeded
        ? `${GREEN}${BOLD}Autoforge: ALL GATES PASSED${RESET}`
        : `${RED}${BOLD}Autoforge: DID NOT PASS${RESET}`,
      `  Iterations: ${result.iterations}`,
      `  Termination: ${result.terminationReason}`,
    ];

    if (result.finalScore) {
      lines.push(`  PDSE Score: ${result.finalScore.overall}/100`);
    }

    lines.push(`  Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

    return lines.join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Autoforge error: ${msg}${RESET}`;
  }
}

async function partyCommand(args: string, state: ReplState): Promise<string> {
  const task = args.trim();
  if (!task) {
    return `${RED}Usage: /party <task description>${RESET}\n${DIM}Spawns multi-agent coordination with parallel lanes.${RESET}`;
  }

  const routerConfig = {
    default: state.state.model.default,
    fallback: state.state.model.fallback ?? [],
    overrides:
      ((state.state.model as Record<string, unknown>)["taskOverrides"] as Record<
        string,
        import("@dantecode/config-types").ModelConfig
      >) ?? {},
  };
  const router = new ModelRouterImpl(routerConfig, state.projectRoot, state.session.id);
  const multiAgent = new MultiAgent(router, state.state);

  const onProgress: MultiAgentProgressCallback = (update) => {
    const icon =
      update.status === "started"
        ? `${YELLOW}>`
        : update.status === "completed"
          ? `${GREEN}+`
          : `${RED}x`;
    process.stdout.write(
      `  ${icon}${RESET} ${BOLD}${update.lane.padEnd(12)}${RESET} ${DIM}${update.message.slice(0, 60)}${RESET}\n`,
    );
  };

  process.stdout.write(
    `\n${YELLOW}${BOLD}Multi-Agent Party${RESET} ${DIM}(spawning lanes...)${RESET}\n\n`,
  );

  try {
    const result = await multiAgent.coordinate(task, {}, onProgress);

    const lines: string[] = [
      "",
      result.compositePdse >= state.state.pdse.threshold
        ? `${GREEN}${BOLD}Party Complete: PASSED${RESET}`
        : `${YELLOW}${BOLD}Party Complete: BELOW THRESHOLD${RESET}`,
      `  Composite PDSE: ${result.compositePdse}/100 (threshold: ${state.state.pdse.threshold})`,
      `  Iterations: ${result.iterations}`,
      `  Lanes used: ${result.outputs.map((o) => o.lane).join(", ")}`,
      "",
    ];

    for (const output of result.outputs) {
      const scoreColor = output.pdseScore >= 80 ? GREEN : output.pdseScore >= 60 ? YELLOW : RED;
      lines.push(
        `  ${BOLD}${output.lane.padEnd(12)}${RESET} ${scoreColor}PDSE ${output.pdseScore}${RESET} ${DIM}${output.content.slice(0, 80)}...${RESET}`,
      );
    }

    // Inject combined outputs into session
    const combinedContent = result.outputs
      .map((o) => `## ${o.lane} (PDSE: ${o.pdseScore})\n\n${o.content}`)
      .join("\n\n---\n\n");

    state.session.messages.push({
      id: randomUUID(),
      role: "assistant",
      content: combinedContent,
      timestamp: new Date().toISOString(),
    });

    return lines.join("\n");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return `${RED}Party error: ${message}${RESET}`;
  }
}

// ----------------------------------------------------------------------------
// Slash Command Registry
// ----------------------------------------------------------------------------

const SLASH_COMMANDS: SlashCommand[] = [
  { name: "help", description: "Show all slash commands", usage: "/help", handler: helpCommand },
  {
    name: "model",
    description: "Switch model mid-session",
    usage: "/model <id>",
    handler: modelCommand,
  },
  {
    name: "add",
    description: "Add file to conversation context",
    usage: "/add <file>",
    handler: addCommand,
  },
  {
    name: "drop",
    description: "Remove file from context",
    usage: "/drop <file>",
    handler: dropCommand,
  },
  {
    name: "files",
    description: "List files currently in context",
    usage: "/files",
    handler: filesCommand,
  },
  {
    name: "diff",
    description: "Show pending changes (unstaged diff)",
    usage: "/diff",
    handler: diffCommand,
  },
  { name: "commit", description: "Trigger auto-commit", usage: "/commit", handler: commitCommand },
  { name: "revert", description: "Revert last commit", usage: "/revert", handler: revertCommand },
  { name: "undo", description: "Undo last file edit", usage: "/undo", handler: undoCommand },
  {
    name: "lessons",
    description: "Show project lessons",
    usage: "/lessons",
    handler: lessonsCommand,
  },
  {
    name: "pdse",
    description: "Run PDSE scorer on a file",
    usage: "/pdse <file>",
    handler: pdseCommand,
  },
  { name: "qa", description: "Run GStack QA pipeline", usage: "/qa", handler: qaCommand },
  {
    name: "audit",
    description: "Show recent audit log entries",
    usage: "/audit",
    handler: auditCommand,
  },
  {
    name: "clear",
    description: "Clear conversation history",
    usage: "/clear",
    handler: clearCommand,
  },
  { name: "tokens", description: "Show token usage", usage: "/tokens", handler: tokensCommand },
  {
    name: "web",
    description: "Fetch URL content into context",
    usage: "/web <url>",
    handler: webCommand,
  },
  {
    name: "skill",
    description: "List or activate a skill",
    usage: "/skill [name]",
    handler: skillCommand,
  },
  {
    name: "agents",
    description: "List available agents",
    usage: "/agents",
    handler: agentsCommand,
  },
  {
    name: "read-only",
    description: "Add file as read-only reference context",
    usage: "/read-only <file>",
    handler: readOnlyCommand,
  },
  {
    name: "compact",
    description: "Condense conversation to free context space",
    usage: "/compact",
    handler: compactCommand,
  },
  {
    name: "architect",
    description: "Toggle plan-first architect mode",
    usage: "/architect",
    handler: architectCommand,
  },
  {
    name: "worktree",
    description: "Create git worktree for isolation",
    usage: "/worktree",
    handler: worktreeCommand,
  },
  {
    name: "sandbox",
    description: "Toggle sandbox mode on/off",
    usage: "/sandbox",
    handler: sandboxCommand,
  },
  {
    name: "silent",
    description: "Toggle silent mode (compact progress only)",
    usage: "/silent",
    handler: silentCommand,
  },
  {
    name: "autoforge",
    description: "Run autoforge IAL loop on active file",
    usage: "/autoforge [--silent] [--persist]",
    handler: autoforgeCommand,
  },
  {
    name: "oss",
    description: "OSS research pipeline — scan, search, harvest, implement, autoforge",
    usage: "/oss [focus-area]",
    handler: ossCommand,
  },
  {
    name: "party",
    description: "Multi-agent coordination — parallel lanes for complex tasks",
    usage: "/party <task>",
    handler: partyCommand,
  },
];

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Routes a slash command string to its handler and executes it.
 *
 * @param input - The full slash command string including the leading `/`.
 * @param state - The current REPL state.
 * @returns The output string from the command handler, or an error message.
 */
export async function routeSlashCommand(input: string, state: ReplState): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return `${RED}Not a slash command: ${trimmed}${RESET}`;
  }

  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");
  const commandName =
    spaceIndex === -1
      ? withoutSlash.toLowerCase()
      : withoutSlash.slice(0, spaceIndex).toLowerCase();
  const args = spaceIndex === -1 ? "" : withoutSlash.slice(spaceIndex + 1);

  const command = SLASH_COMMANDS.find((c) => c.name === commandName);
  if (!command) {
    return `${RED}Unknown command: /${commandName}${RESET}\n${DIM}Type /help to see available commands.${RESET}`;
  }

  return command.handler(args, state);
}

/**
 * Returns true if the input string looks like a slash command.
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith("/");
}
