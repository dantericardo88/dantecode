// ============================================================================
// @dantecode/cli — Slash Command Router for the REPL
// Each slash command is a function that operates on the REPL state.
// ============================================================================

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  getProviderCatalogEntry,
  getContextUtilization,
  parseModelReference,
  readAuditEvents,
  MultiAgent,
  ModelRouterImpl,
} from "@dantecode/core";
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
import type {
  Session,
  SessionMessage,
  DanteCodeState,
  ModelConfig,
  ModelRouterConfig,
} from "@dantecode/config-types";
import { SandboxBridge } from "./sandbox-bridge.js";

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
  /** Live sandbox bridge when sandbox mode is enabled. */
  sandboxBridge: SandboxBridge | null;
  /** MCP client manager for external tool integration. */
  mcpClient?: {
    isConnected: () => boolean;
    getConnectedServers: () => string[];
    listTools: () => Array<{ name: string; description: string; serverName: string }>;
  };
  /** Background agent runner (lazily initialized by /bg). */
  _bgRunner?: unknown;
  /** Code index (lazily initialized by /index and /search). */
  _codeIndex?: unknown;
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
  const modelReference = args.trim();
  if (!modelReference) {
    const current = state.state.model.default;
    return `${DIM}Current model:${RESET} ${BOLD}${current.provider}/${current.modelId}${RESET}\n\n${DIM}Usage: /model <provider/modelId> (e.g. /model grok/grok-3)${RESET}`;
  }

  const parsed = parseModelReference(modelReference, state.state.model.default.provider);
  const providerEntry = getProviderCatalogEntry(parsed.provider);

  if (!providerEntry) {
    return `${RED}Unknown provider:${RESET} ${parsed.provider}`;
  }

  const newModelConfig: ModelConfig = {
    ...state.state.model.default,
    provider: parsed.provider,
    modelId: parsed.modelId,
  };

  state.state.model.default = newModelConfig;
  state.session.model = newModelConfig;

  return `${GREEN}Model switched to${RESET} ${BOLD}${parsed.id}${RESET} ${DIM}(${providerEntry.label})${RESET}`;
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
  const messageCount = state.session.messages.length;
  const contextWindow = state.state.model.default.contextWindow;

  // Use the Context Guardian utilization function for accurate estimation
  const util = getContextUtilization(
    state.session.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })),
    contextWindow,
  );

  const tierColor = util.tier === "green" ? GREEN : util.tier === "yellow" ? YELLOW : RED;
  const tierLabel = `${tierColor}${util.tier.toUpperCase()}${RESET}`;

  const lines = [
    `${BOLD}Token Usage${RESET}`,
    "",
    `  Messages:       ${messageCount}`,
    `  Est. tokens:    ${util.tokens.toLocaleString()}`,
    `  Context window: ${contextWindow.toLocaleString()}`,
    `  Utilization:    ${util.percent}% [${tierLabel}]`,
    "",
    `  Context: ${util.percent}% (${util.tier}) — ${util.tokens}/${util.maxTokens} tokens`,
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
  if (before <= 12) {
    return `${DIM}Context is small enough (${before} messages) — no compaction needed.${RESET}`;
  }

  // Tier 3 aggressive compaction: keep first message + last 10, replace middle with summary
  const KEEP_RECENT = 10;
  const first = state.session.messages[0]!;
  const last = state.session.messages.slice(-KEEP_RECENT);
  const removed = before - KEEP_RECENT - 1;

  const summaryMsg: SessionMessage = {
    id: randomUUID(),
    role: "system",
    content: `[${removed} earlier messages compacted to save context]`,
    timestamp: new Date().toISOString(),
  };

  state.session.messages = [first, summaryMsg, ...last];
  return `${GREEN}Compacted:${RESET} ${before} → ${state.session.messages.length} messages (${removed} removed)`;
}

async function architectCommand(_args: string, state: ReplState): Promise<string> {
  const ARCHITECT_MARKER = "[ARCHITECT MODE]";
  const hasArchitect = state.session.messages.some(
    (m) =>
      m.role === "system" && typeof m.content === "string" && m.content.includes(ARCHITECT_MARKER),
  );

  if (hasArchitect) {
    state.session.messages = state.session.messages.filter(
      (m) =>
        !(
          m.role === "system" &&
          typeof m.content === "string" &&
          m.content.includes(ARCHITECT_MARKER)
        ),
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
  if (state.enableSandbox) {
    if (state.sandboxBridge) {
      await state.sandboxBridge.shutdown();
    }
    state.sandboxBridge = null;
    state.enableSandbox = false;
    return `${BOLD}Sandbox mode:${RESET} ${RED}OFF${RESET}`;
  }

  const bridge = new SandboxBridge(state.projectRoot, state.verbose);
  const dockerAvailable = await bridge.isAvailable();
  state.sandboxBridge = bridge;
  state.enableSandbox = true;

  if (dockerAvailable) {
    return `${BOLD}Sandbox mode:${RESET} ${GREEN}ON${RESET} ${DIM}(Docker isolation active for the next tool run)${RESET}`;
  }

  return `${BOLD}Sandbox mode:${RESET} ${YELLOW}HOST FALLBACK${RESET} ${DIM}(Docker unavailable; commands will run on the host until sandbox support is restored)${RESET}`;
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
  const resolvedTargetFile = resolve(state.projectRoot, targetFile);
  const displayTargetFile = relative(state.projectRoot, resolvedTargetFile) || resolvedTargetFile;
  let code: string;
  try {
    code = await readFile(resolvedTargetFile, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Error reading target file: ${msg}${RESET}`;
  }

  process.stdout.write(
    `${DIM}Starting Autoforge IAL on ${displayTargetFile} (max ${hardCeiling} iterations)...${RESET}\n`,
  );

  const routerConfig: ModelRouterConfig = {
    default: state.state.model.default,
    fallback: state.state.model.fallback,
    overrides: state.state.model.taskOverrides,
  };
  const modelRouter = new ModelRouterImpl(routerConfig, state.projectRoot, state.session.id);
  const router = {
    chat: async (prompt: string, opts?: { temperature?: number; maxTokens?: number }) =>
      modelRouter.generate([{ role: "user", content: prompt }], {
        maxTokens: opts?.maxTokens,
        taskType: "autoforge",
      }),
    getConfig: () => routerConfig,
    getCostEstimate: () => modelRouter.getCostEstimate(),
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
        taskDescription: `Autoforge quality improvement for ${displayTargetFile}`,
        filePath: resolvedTargetFile,
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

    const lastIteration = result.iterationHistory[result.iterationHistory.length - 1];
    const failedCommands = lastIteration?.gstackResults.filter((entry) => !entry.passed) ?? [];
    if (failedCommands.length > 0) {
      lines.push(`  Failed checks: ${failedCommands.map((entry) => entry.command).join(", ")}`);
    }
    if ((lastIteration?.lessonsInjected.length ?? 0) > 0) {
      lines.push(`  Lessons injected: ${lastIteration?.lessonsInjected.length ?? 0}`);
    }

    lines.push(`  Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);

    if (result.succeeded) {
      await writeFile(resolvedTargetFile, result.finalCode, "utf-8");
      state.lastEditFile = resolvedTargetFile;
      state.lastEditContent = code;
      if (!state.session.activeFiles.includes(resolvedTargetFile)) {
        state.session.activeFiles.push(resolvedTargetFile);
      }
      lines.push(`  Applied to disk: ${displayTargetFile}`);
    } else {
      lines.push(`  Disk state: unchanged (${displayTargetFile})`);
    }

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

async function mcpCommand(_args: string, state: ReplState): Promise<string> {
  if (!state.mcpClient || !state.mcpClient.isConnected()) {
    return `${DIM}No MCP servers connected.${RESET}\n${DIM}Configure servers in .dantecode/mcp.json:${RESET}\n${DIM}  { "servers": [{ "name": "fs", "transport": "stdio", "command": "mcp-fs", "enabled": true }] }${RESET}`;
  }

  const servers = state.mcpClient.getConnectedServers();
  const tools = state.mcpClient.listTools();
  const lines = ["", `${BOLD}MCP Servers${RESET} (${servers.length} connected)`, ""];

  for (const serverName of servers) {
    const serverTools = tools.filter((t) => t.serverName === serverName);
    lines.push(`  ${GREEN}${serverName}${RESET} — ${serverTools.length} tools`);
    for (const tool of serverTools) {
      lines.push(`    ${DIM}${tool.name}${RESET}: ${tool.description.slice(0, 80)}`);
    }
  }

  lines.push("", `${DIM}Total: ${tools.length} MCP tools available to the agent.${RESET}`);
  return lines.join("\n");
}

async function listenCommand(args: string, state: ReplState): Promise<string> {
  // Lazy import to avoid circular dependency
  const { BackgroundAgentRunner, EventTriggerRegistry, createWebhookServer } =
    await import("@dantecode/core");

  const port = args.trim() ? parseInt(args.trim(), 10) : 8080;
  if (isNaN(port) || port < 1 || port > 65535) {
    return `${RED}Invalid port number. Usage: /listen [port]${RESET}`;
  }

  // Reuse or create the background runner
  if (!state._bgRunner) {
    state._bgRunner = new BackgroundAgentRunner(1, state.projectRoot);
  }
  const runner = state._bgRunner as InstanceType<typeof BackgroundAgentRunner>;

  // Create the event trigger registry with env-based secrets
  const registry = new EventTriggerRegistry({
    enabledSources: ["github", "slack", "api", "manual"],
    githubSecret: process.env.GITHUB_WEBHOOK_SECRET,
    defaultPriority: "normal",
  });

  const handle = createWebhookServer({
    port,
    eventRegistry: registry,
    backgroundRunner: runner,
    projectRoot: state.projectRoot,
    apiToken: process.env.DANTECODE_API_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  });

  try {
    await handle.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Failed to start webhook server: ${msg}${RESET}`;
  }

  const lines = [
    "",
    `${GREEN}${BOLD}DanteCode webhook server started on port ${port}${RESET}`,
    "",
    `${BOLD}Endpoints:${RESET}`,
    `  POST ${DIM}http://localhost:${port}/webhooks/github${RESET}  — GitHub webhook receiver`,
    `  POST ${DIM}http://localhost:${port}/webhooks/slack${RESET}   — Slack webhook receiver`,
    `  POST ${DIM}http://localhost:${port}/api/tasks${RESET}        — REST API task submission`,
    `  GET  ${DIM}http://localhost:${port}/health${RESET}           — Health check`,
    "",
    `${DIM}To expose publicly (for GitHub webhooks):${RESET}`,
    `  ${DIM}npx ngrok http ${port}${RESET}`,
    "",
  ];

  return lines.join("\n");
}

async function bgCommand(args: string, state: ReplState): Promise<string> {
  // Lazy import to avoid circular dependency
  const { BackgroundAgentRunner } = await import("@dantecode/core");

  // Access or create the runner on the state
  if (!state._bgRunner) {
    state._bgRunner = new BackgroundAgentRunner(1, state.projectRoot);
  }
  const runner = state._bgRunner as InstanceType<typeof BackgroundAgentRunner>;

  const trimmed = args.trim();

  // /bg with no args — list tasks
  if (!trimmed) {
    const tasks = runner.listTasks();
    if (tasks.length === 0) {
      return `${DIM}No background tasks. Use /bg <task description> to start one.${RESET}`;
    }
    const lines = ["", `${BOLD}Background Tasks${RESET}`, ""];
    for (const task of tasks) {
      const icon =
        task.status === "running"
          ? `${YELLOW}⟳${RESET}`
          : task.status === "completed"
            ? `${GREEN}✓${RESET}`
            : task.status === "failed"
              ? `${RED}✗${RESET}`
              : task.status === "cancelled"
                ? `${DIM}⊘${RESET}`
                : `${DIM}…${RESET}`;
      lines.push(`  ${icon} [${task.id}] ${task.status} — ${task.prompt.slice(0, 60)}`);
      lines.push(`    ${DIM}${task.progress}${RESET}`);
    }
    return lines.join("\n");
  }

  // /bg cancel <id>
  if (trimmed.startsWith("cancel ")) {
    const taskId = trimmed.slice(7).trim();
    const cancelled = runner.cancel(taskId);
    return cancelled
      ? `${GREEN}Task ${taskId} cancelled.${RESET}`
      : `${RED}Could not cancel task ${taskId} (not found or already finished).${RESET}`;
  }

  // /bg clear
  if (trimmed === "clear") {
    const cleared = runner.clearFinished();
    return `${DIM}Cleared ${cleared} finished tasks.${RESET}`;
  }

  // /bg <prompt> — enqueue a new task
  // Parse flags from the raw args string
  const hasPR = trimmed.includes("--pr");
  const hasCommit = trimmed.includes("--commit") || hasPR; // --pr implies --commit
  const hasDocker = trimmed.includes("--docker");

  // Strip all known flags to extract the prompt text
  const prompt = trimmed
    .replace(/--pr/g, "")
    .replace(/--commit/g, "")
    .replace(/--docker/g, "")
    .trim();

  if (!prompt) {
    return `${RED}Usage: /bg [--docker] [--commit] [--pr] <task description>${RESET}`;
  }

  const dockerConfig = hasDocker
    ? {
        image: state.state.sandbox.defaultImage,
        networkMode: state.state.sandbox.networkMode,
        memoryLimitMb: state.state.sandbox.memoryLimitMb,
        cpuLimit: state.state.sandbox.cpuLimit,
        readOnlyMount: false,
      }
    : undefined;

  const taskId = runner.enqueue(prompt, {
    autoCommit: hasCommit,
    createPR: hasPR,
    docker: hasDocker,
    dockerConfig,
  });

  const parts: string[] = [`${GREEN}Background task ${taskId} queued.${RESET}`];
  if (hasDocker) parts.push(`${DIM}(Docker)${RESET}`);
  if (hasPR) {
    parts.push(`\n  ${DIM}Will auto-commit and create PR on completion.${RESET}`);
  } else if (hasCommit) {
    parts.push(`\n  ${DIM}Will auto-commit on completion.${RESET}`);
  }
  parts.push(`Use ${DIM}/bg${RESET} to check status.`);
  return parts.join(" ");
}

async function rememberCommand(args: string, state: ReplState): Promise<string> {
  const text = args.trim();
  if (!text) {
    return `${YELLOW}Usage: /remember <text to remember>${RESET}`;
  }

  const { appendFile, mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const danteNotesPath = resolve(state.projectRoot, ".dantecode", "DANTE.md");
  await mkdir(dirname(danteNotesPath), { recursive: true });
  await appendFile(danteNotesPath, `\n- ${text}\n`, "utf-8");
  return `${GREEN}Remembered: "${text}"${RESET}\n${DIM}Saved to .dantecode/DANTE.md — will be injected into future prompts.${RESET}`;
}

function parseEmbeddingProviderArg(args: string): "ollama" | "openai" | "google" | null {
  const trimmed = args.trim();
  if (!trimmed.includes("--embed")) {
    return null;
  }

  const inlineMatch = trimmed.match(/--embed(?:=|\s+)(ollama|openai|google)\b/i);
  if (inlineMatch?.[1]) {
    return inlineMatch[1].toLowerCase() as "ollama" | "openai" | "google";
  }

  return "ollama";
}

async function indexCommand(args: string, state: ReplState): Promise<string> {
  const { CodeIndex, createEmbeddingProvider } = await import("@dantecode/core");

  if (!state._codeIndex) {
    state._codeIndex = new CodeIndex();
  }
  const index = state._codeIndex as InstanceType<typeof CodeIndex>;
  const embeddingProviderName = parseEmbeddingProviderArg(args);

  let embeddingProvider: Awaited<ReturnType<typeof createEmbeddingProvider>> | null = null;
  if (embeddingProviderName) {
    embeddingProvider = createEmbeddingProvider(embeddingProviderName);
  }

  process.stdout.write(`${DIM}Building code index for ${state.projectRoot}...${RESET}\n`);
  const count = await index.buildIndex(
    state.projectRoot,
    {
      excludePatterns: state.state.project.excludePatterns,
      useEmbeddings: embeddingProvider !== null,
    },
    embeddingProvider,
  );

  await index.save(state.projectRoot);
  const modeLabel =
    embeddingProvider && index.hasEmbeddings
      ? `${DIM}(hybrid TF-IDF + ${embeddingProvider.info.provider} embeddings)${RESET}`
      : `${DIM}(TF-IDF only)${RESET}`;
  return `${GREEN}Indexed ${count} code chunks.${RESET} ${modeLabel} Use ${DIM}/search <query>${RESET} to search.`;
}

async function searchCommand(args: string, state: ReplState): Promise<string> {
  const { CodeIndex, createEmbeddingProvider } = await import("@dantecode/core");

  if (!args.trim()) {
    return `${RED}Usage: /search <query>${RESET}`;
  }

  if (!state._codeIndex) {
    state._codeIndex = new CodeIndex();
    // Try to load existing index
    const loaded = await (state._codeIndex as InstanceType<typeof CodeIndex>).load(
      state.projectRoot,
    );
    if (!loaded) {
      return `${YELLOW}No index found. Run /index first.${RESET}`;
    }
  }

  const index = state._codeIndex as InstanceType<typeof CodeIndex>;
  const embeddingInfo = index.getEmbeddingProviderInfo();
  let queryEmbedding: number[] | undefined;
  let searchMode = "TF-IDF";

  if (index.hasEmbeddings && embeddingInfo) {
    try {
      const provider = createEmbeddingProvider(embeddingInfo.provider, {
        modelId: embeddingInfo.modelId,
        ...(embeddingInfo.dimensions ? { dimensions: embeddingInfo.dimensions } : {}),
      });
      queryEmbedding = await provider.embedSingle(args.trim());
      searchMode = "Hybrid";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      process.stdout.write(
        `${DIM}[search: embedding fallback to TF-IDF â€” ${message.slice(0, 120)}]${RESET}\n`,
      );
    }
  }

  const results = index.search(args.trim(), 10, queryEmbedding);

  if (results.length === 0) {
    return `${DIM}No results for "${args.trim()}"${RESET}`;
  }

  const lines = [
    "",
    `${BOLD}Search Results${RESET} for "${args.trim()}" ${DIM}[${searchMode}]${RESET}`,
    "",
  ];
  for (let i = 0; i < results.length; i++) {
    const chunk = results[i]!;
    lines.push(`  ${GREEN}${i + 1}.${RESET} ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`);
    if (chunk.symbols.length > 0) {
      lines.push(`     ${DIM}symbols: ${chunk.symbols.slice(0, 5).join(", ")}${RESET}`);
    }
    // Show first 2 lines of content
    const preview = chunk.content.split("\n").slice(0, 2).join(" ").slice(0, 100);
    lines.push(`     ${DIM}${preview}${RESET}`);
  }
  return lines.join("\n");
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
    name: "remember",
    description: "Save a note to .dantecode/DANTE.md (persistent project memory)",
    usage: "/remember <text>",
    handler: rememberCommand,
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
  {
    name: "mcp",
    description: "List MCP servers and tools",
    usage: "/mcp",
    handler: mcpCommand,
  },
  {
    name: "bg",
    description: "Background agent tasks — run, list, cancel (--pr auto-creates PR)",
    usage: "/bg [--docker] [--commit] [--pr] [task | cancel <id> | clear]",
    handler: bgCommand,
  },
  {
    name: "listen",
    description: "Start webhook server for GitHub/Slack events",
    usage: "/listen [port]",
    handler: listenCommand,
  },
  {
    name: "index",
    description: "Build semantic code index for the project",
    usage: "/index [--embed[=provider]]",
    handler: indexCommand,
  },
  {
    name: "search",
    description: "Search code index for relevant code",
    usage: "/search <query>",
    handler: searchCommand,
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
