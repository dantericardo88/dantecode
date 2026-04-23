// ============================================================================
// @dantecode/cli — Slash Command Router for the REPL
// Each slash command is a function that operates on the REPL state.
// ============================================================================

import * as readline from "node:readline";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createSelfImprovementContext,
  getProviderCatalogEntry,
  getContextUtilization,
  parseModelReference,
  readAuditEvents,
  MultiAgent,
  ModelRouterImpl,
  SessionStore,
  AutoforgeCheckpointManager,
  TaskCircuitBreaker,
  RecoveryEngine,
  EventSourcedCheckpointer,
  LoopDetector,
  parseSkillWaves,
  createWaveState,
  generateRepoMemory,
  BoundedRepairLoop,
  runSecurityAudit,
  chaosTester,
} from "@dantecode/core";
import { skillsManager } from "./skills-manager.js";
import type { MultiAgentProgressCallback, WaveOrchestratorState } from "@dantecode/core";
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
import { testMCPIntegration } from "@dantecode/mcp";
import type { MCPClientManager } from "@dantecode/mcp";
import {
  getStatus,
  getDiff,
  autoCommit,
  revertLastCommit,
  createWorktree,
  mergeWorktree,
  removeWorktree,
} from "@dantecode/git-engine";
import type {
  Session,
  SessionMessage,
  DanteCodeState,
  ModelConfig,
  ModelRouterConfig,
} from "@dantecode/config-types";
import { SandboxBridge } from "./sandbox-bridge.js";
import { runAgentLoop } from "./agent-loop.js";

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

const CYAN = "\x1b[36m";
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
  mcpClient: MCPClientManager | null;
  /** Background agent runner (lazily initialized by /bg). */
  _bgRunner?: unknown;
  /** Code index (lazily initialized by /index and /search). */
  _codeIndex?: unknown;
  /** Currently active skill name, or null. Used to enable universal pipeline continuation. */
  activeSkill: string | null;
  /** Wave orchestrator state for step-by-step skill execution (Claude Workflow Mode). */
  waveState: WaveOrchestratorState | null;
  /**
   * Permissions for destructive actions. Defaults to edit: "ask", bash: "ask", tools: "allow".
   * - "allow": always allow execution
   * - "ask": prompt user for approval before execution
   * - "deny": always block execution
   */
  permissions?: {
    edit: "allow" | "ask" | "deny";
    bash: "allow" | "ask" | "deny";
    tools: "allow" | "ask" | "deny";
  };
  /** Readline interface for interactive prompts (used for 'ask' permissions). */
  rl?: readline.Interface;
  /** Latest cost estimate from the most recent agent loop run. Updated via onCostUpdate. */
  lastCostEstimate?: import("@dantecode/config-types").CostEstimate & { provider?: string };
}

/** A single slash command handler. */
interface SlashCommand {
  name: string;
  description: string;
  usage: string;
  handler: (args: string, state: ReplState) => Promise<string>;
}

function cloneSessionForTask(
  session: Session,
  projectRoot: string,
  taskId: string,
  snapshot?: Session,
): Session {
  if (snapshot) {
    return JSON.parse(JSON.stringify(snapshot)) as Session;
  }

  return {
    ...JSON.parse(JSON.stringify(session)),
    id: `bg-${taskId}`,
    projectRoot,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Session;
}

function collectTouchedFilesFromSession(session: Session, projectRoot: string): string[] {
  const touched = new Set<string>();

  for (const message of session.messages) {
    const filePath = message.toolUse?.input?.["file_path"];
    if (
      message.toolUse &&
      (message.toolUse.name === "Write" || message.toolUse.name === "Edit") &&
      typeof filePath === "string"
    ) {
      touched.add(resolve(projectRoot, filePath));
    }
  }

  return Array.from(touched);
}

function getLastAssistantText(session: Session): string {
  const lastAssistant = [...session.messages]
    .reverse()
    .find((message) => message.role === "assistant" && typeof message.content === "string");
  return (lastAssistant?.content as string | undefined) ?? "Background task completed.";
}

async function ensureBackgroundRunner(state: ReplState) {
  const { BackgroundAgentRunner } = await import("@dantecode/core");

  if (!state._bgRunner) {
    state._bgRunner = new BackgroundAgentRunner(1, state.projectRoot);
  }

  const runner = state._bgRunner as InstanceType<typeof BackgroundAgentRunner>;
  const hasConfiguredWorkFn =
    typeof (runner as { hasWorkFn?: () => boolean }).hasWorkFn === "function"
      ? (runner as { hasWorkFn: () => boolean }).hasWorkFn()
      : false;

  if (!hasConfiguredWorkFn) {
    runner.setWorkFn(async (prompt, onProgress, context) => {
      const latestCheckpoint = context.getLatestCheckpoint?.();
      const taskProjectRoot = context.task.worktreeDir ?? state.projectRoot;
      const workingSession = cloneSessionForTask(
        state.session,
        taskProjectRoot,
        context.task.id,
        latestCheckpoint?.sessionSnapshot,
      );

      onProgress(
        latestCheckpoint
          ? `Resuming from checkpoint ${latestCheckpoint.id}`
          : "Starting autonomous agent loop...",
      );

      await context.saveCheckpoint?.(
        latestCheckpoint ? "resume-start" : "task-start",
        workingSession,
      );

      const completedSession = await runAgentLoop(prompt, workingSession, {
        state: state.state,
        verbose: state.verbose,
        enableGit: state.enableGit,
        enableSandbox: state.enableSandbox,
        silent: true,
        sandboxBridge: state.sandboxBridge ?? undefined,
        selfImprovement: context.task.selfImprovement,
      });

      await context.saveCheckpoint?.("post-run", completedSession);

      return {
        output: getLastAssistantText(completedSession),
        touchedFiles: collectTouchedFilesFromSession(completedSession, taskProjectRoot),
      };
    });
  }

  return runner;
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

  // Append cost block
  lines.push("");
  lines.push(`${BOLD}Cost${RESET}`);
  lines.push("");
  const modelId = `${state.state.model.default.provider}/${state.state.model.default.modelId}`;
  lines.push(`  Provider:       ${modelId}`);
  const ce = state.lastCostEstimate;
  if (!ce) {
    lines.push(`  Cost:           (run a prompt first)`);
  } else {
    const lastReq = ce.lastRequestUsd > 0 ? `$${ce.lastRequestUsd.toFixed(4)}` : "$0.0000";
    const sessTotal = ce.sessionTotalUsd > 0 ? `$${ce.sessionTotalUsd.toFixed(4)}` : "$0.0000";
    lines.push(`  Last request:   ${lastReq}`);
    lines.push(`  Session cost:   ${sessTotal}  (${ce.tokensUsedSession.toLocaleString()} tokens)`);
    const budgetUsd = state.state.model.budget?.sessionMaxUsd;
    if (budgetUsd !== undefined && budgetUsd > 0) {
      const pct = Math.min(100, Math.round((ce.sessionTotalUsd / budgetUsd) * 100));
      const filled = Math.round(pct / 10);
      const bar = "█".repeat(filled) + "░".repeat(10 - filled);
      const barColor = pct >= 80 ? RED : pct >= 50 ? YELLOW : GREEN;
      lines.push(`  Budget:         ${barColor}${bar}${RESET}  ${pct}%  ($${ce.sessionTotalUsd.toFixed(4)} / $${budgetUsd.toFixed(2)})`);
      if (pct >= 80) lines.push(`                  ${YELLOW}⚠  Warning: ${pct}% of session budget consumed${RESET}`);
    }
    lines.push(`  ${DIM}Use /cost for full dashboard  •  /cost rates for provider rate table${RESET}`);
  }

  return lines.join("\n");
}

async function costCommand(args: string, state: ReplState): Promise<string> {
  const { loadCostHistory, formatCostDashboard, formatRateTable } = await import(
    "./cost-tracker.js"
  );

  if (args.trim() === "rates") {
    return formatRateTable();
  }

  const history = await loadCostHistory(state.projectRoot);
  const estimate = state.lastCostEstimate ?? {
    sessionTotalUsd: 0,
    lastRequestUsd: 0,
    modelTier: "fast" as const,
    tokensUsedSession: 0,
    budgetExceeded: false,
  };
  const provider =
    state.lastCostEstimate?.provider ??
    `${state.state.model.default.provider}/${state.state.model.default.modelId}`;
  return formatCostDashboard(
    estimate,
    provider,
    history,
    state.state.model.budget?.sessionMaxUsd,
  );
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

  // Parse skill instructions into waves for step-by-step orchestration.
  // If the skill has wave/step/phase structure, we feed one wave at a time
  // (Claude Workflow Mode). Otherwise, inject the full instructions with
  // a basic execution preamble.
  const waves = parseSkillWaves(skill.instructions);
  const hasWaves = waves.length > 1;

  if (hasWaves) {
    // Wave orchestration: store state, inject only metadata + first wave reference.
    // The actual wave prompt is injected by buildSystemPrompt via config.waveState.
    state.waveState = createWaveState(waves);

    const waveList = waves
      .map((w: { number: number; title: string }) => `  ${w.number}. ${w.title}`)
      .join("\n");

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: [
        `Activated skill "${skill.frontmatter.name}": ${skill.frontmatter.description}`,
        "",
        `This skill has ${waves.length} waves. You will receive ONE wave at a time.`,
        "",
        "Wave overview:",
        waveList,
        "",
        "You are starting with Wave 1. The full instructions for each wave will be",
        "provided in the system prompt. When a wave is complete, signal with [WAVE COMPLETE].",
      ].join("\n"),
      timestamp: new Date().toISOString(),
    });
  } else {
    // No wave structure: inject full instructions with execution preamble
    const skillPreamble = [
      `Activated skill "${skill.frontmatter.name}": ${skill.frontmatter.description}`,
      "",
      "## MANDATORY: Step-by-Step Execution",
      "",
      "Before reading the skill instructions below, understand these ABSOLUTE rules:",
      "",
      "1. Your FIRST action must be: use TodoWrite to decompose this skill into numbered steps.",
      "2. Then execute each step ONE AT A TIME with real tool calls.",
      "3. NEVER skip steps. NEVER narrate what you would do — actually DO it with tools.",
      "4. After each step, verify your work (Read the file, run a check, etc.).",
      '5. For GitHub search: `gh search repos "query" --limit 10 --json name,url,description,stargazersCount`',
      "6. For web content: `curl -sL 'url' | head -200`",
      "7. For cloning repos: `git clone --depth 1 'url' /tmp/oss-scan/name`",
      "8. Mark each TodoWrite step completed as you finish it.",
      "",
      "---",
      "",
      skill.instructions,
    ].join("\n");

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: skillPreamble,
      timestamp: new Date().toISOString(),
    });

    state.waveState = null;
  }

  // Track active skill so pipeline continuation protections apply universally
  state.activeSkill = skill.frontmatter.name;

  const waveInfo = hasWaves
    ? `\n${DIM}Detected ${waves.length} waves — Claude Workflow Mode active${RESET}`
    : "";
  return `${GREEN}Activated skill:${RESET} ${BOLD}${skill.frontmatter.name}${RESET}\n${DIM}${skill.frontmatter.description}${RESET}${waveInfo}`;
}

async function agentsCommand(_args: string, state: ReplState): Promise<string> {
  const agentsDir = join(state.projectRoot, ".dantecode", "agents");

  try {
    const entries = await readdir(agentsDir);
    const agentFiles = entries.filter(
      (entry: string) => entry.endsWith(".yaml") || entry.endsWith(".yml") || entry.endsWith(".md"),
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
Clean up /tmp/oss-research-* directories when done.

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
  const selfImprove = flags.includes("--self-improve");
  const silentMode = flags.includes("--silent");
  const persistUntilGreen = flags.includes("--persist");
  const resumeSession = flags.find((f) => f.startsWith("--resume="))?.slice("--resume=".length);
  const hardCeiling = persistUntilGreen ? 200 : state.state.autoforge.maxIterations;

  if (selfImprove && !state.lastEditFile && state.session.activeFiles.length === 0) {
    state.pendingAgentPrompt =
      "/autoforge --self-improve improve codebase reliability from the repository root. Run repo-root typecheck, lint, and test after every major edit batch and stop on red.";
    return `${GREEN}${BOLD}Self-improvement autoforge queued.${RESET}\n${DIM}The next agent loop will run with explicit protected-write access.${RESET}`;
  }

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

  // Initialize checkpoint manager, circuit breaker, recovery engine,
  // event-sourced checkpointer (LangGraph+OpenHands), and loop detector (CrewAI-inspired)
  const sessionId = resumeSession ?? `af-${state.session.id}-${Date.now()}`;
  const checkpointMgr = new AutoforgeCheckpointManager(state.projectRoot, sessionId);
  const taskBreaker = new TaskCircuitBreaker({
    identicalFailureThreshold: 5,
    maxRecoveryAttempts: 2,
    initialBackoffMs: 125,
    maxBackoffMs: 60_000,
    retryTimeoutMs: 60_000,
  });
  const recovery = new RecoveryEngine({
    execSyncFn: (cmd, cwd) => execSync(cmd, { cwd, stdio: "pipe", encoding: "utf-8" }) as string,
  });
  const eventCheckpointer = new EventSourcedCheckpointer(state.projectRoot, sessionId);
  const loopDetector = new LoopDetector({
    maxIterations: hardCeiling,
    identicalThreshold: 3,
    patternWindowSize: 10,
  });

  // Attempt to resume from a previous session
  let startStep = 0;
  if (resumeSession) {
    const loaded = await checkpointMgr.loadSession(resumeSession);
    const eventCount = await eventCheckpointer.resume();
    if (loaded > 0) {
      const latest = checkpointMgr.getLatestCheckpoint();
      startStep = latest?.currentStep ?? 0;
      process.stdout.write(
        `${GREEN}Resumed from checkpoint ${latest?.id} (step ${startStep}, ${eventCount} events replayed)${RESET}\n`,
      );
    }
  }

  // Create initial event-sourced checkpoint with session state
  await eventCheckpointer.put(
    {
      targetFile: resolvedTargetFile,
      startStep,
      mode: selfImprove ? "self-improve" : "standard",
    },
    {
      source: "input",
      step: startStep,
      triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
    },
  );

  // Record before-hash for audit
  recovery.recordBeforeHash(resolvedTargetFile, code);

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

  const sessionStart = Date.now();

  // Start periodic checkpointing (every 15 minutes)
  checkpointMgr.startPeriodicCheckpoints(() => ({
    triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
    currentStep: startStep,
    elapsedMs: Date.now() - sessionStart,
    targetFilePath: resolvedTargetFile,
    targetFileContent: code,
    metadata: { silentMode, persistUntilGreen, hardCeiling },
  }));

  try {
    const autoforgeConfig = {
      ...state.state.autoforge,
      maxIterations: hardCeiling,
      enabled: true,
    } as import("@dantecode/config-types").BladeAutoforgeConfig;
    autoforgeConfig.silentMode = silentMode;
    autoforgeConfig.persistUntilGreen = persistUntilGreen;
    autoforgeConfig.hardCeiling = hardCeiling;

    let currentCode = code;
    let result: Awaited<ReturnType<typeof runAutoforgeIAL>> | null = null;
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount <= maxRetries) {
      // Loop detection: check for stuck patterns before each attempt
      const loopCheck = loopDetector.recordAction(
        "autoforge_attempt",
        `retry=${retryCount} step=${startStep + retryCount} file=${displayTargetFile}`,
      );
      if (loopCheck.stuck) {
        checkpointMgr.stopPeriodicCheckpoints();
        await eventCheckpointer.putWrite({
          taskId: `loop-break-${retryCount}`,
          channel: "loopDetection",
          value: { stuck: true, reason: loopCheck.reason, details: loopCheck.details },
          timestamp: new Date().toISOString(),
        });
        return `${RED}${BOLD}Autoforge LOOP DETECTED${RESET}: ${loopCheck.reason} — ${loopCheck.details}\n  Iterations: ${loopCheck.iterationCount}, consecutive repeats: ${loopCheck.consecutiveRepeats}\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
      }

      try {
        result = await runAutoforgeIAL(
          currentCode,
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

        // Record success in circuit breaker and event checkpointer
        taskBreaker.recordSuccess();
        await eventCheckpointer.putWrite({
          taskId: `success-${retryCount}`,
          channel: "ialResult",
          value: {
            succeeded: result.succeeded,
            iterations: result.iterations,
            score: result.finalScore?.overall,
          },
          timestamp: new Date().toISOString(),
        });
        break;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const failureAction = taskBreaker.recordFailure(errMsg, startStep + retryCount);

        // Record failure event
        await eventCheckpointer.putWrite({
          taskId: `failure-${retryCount}`,
          channel: "error",
          value: { error: errMsg, action: failureAction.action, step: startStep + retryCount },
          timestamp: new Date().toISOString(),
        });

        if (failureAction.action === "escalate") {
          // Save final checkpoint before aborting
          await checkpointMgr.createCheckpoint({
            label: "escalation",
            triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
            currentStep: startStep + retryCount,
            elapsedMs: Date.now() - sessionStart,
            targetFilePath: resolvedTargetFile,
            targetFileContent: currentCode,
            metadata: { escalated: true, error: errMsg },
          });
          checkpointMgr.stopPeriodicCheckpoints();
          return `${RED}${BOLD}Autoforge ESCALATED${RESET}: ${taskBreaker.getTotalFailures()} failures, recovery exhausted.\n  Last error: ${errMsg}\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
        }

        if (failureAction.action === "pause_and_recover") {
          // Apply exponential backoff before recovery (Aider-style)
          const backoff = taskBreaker.getBackoffDelay(errMsg);
          if (backoff.timedOut) {
            checkpointMgr.stopPeriodicCheckpoints();
            return `${RED}${BOLD}Autoforge TIMED OUT${RESET}: retry backoff exceeded ${taskBreaker.getRetryTimeoutMs()}ms cumulative delay.\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
          }
          if (backoff.delayMs > 0) {
            process.stdout.write(
              `\n${DIM}Backoff: waiting ${backoff.delayMs}ms before recovery (attempt ${backoff.attempt})...${RESET}\n`,
            );
            await new Promise((r) => setTimeout(r, backoff.delayMs));
          }

          process.stdout.write(
            `\n${YELLOW}Circuit breaker triggered — re-reading target file...${RESET}\n`,
          );
          const recoveryResult = await recovery.rereadAndRecover(
            resolvedTargetFile,
            state.projectRoot,
          );
          if (recoveryResult.recovered && recoveryResult.targetContent) {
            currentCode = recoveryResult.targetContent;
            process.stdout.write(
              `${GREEN}Recovery: re-read ${displayTargetFile} (${recoveryResult.contextFiles.length} context files)${RESET}\n`,
            );
          }
        }

        retryCount++;
        if (retryCount > maxRetries) {
          await checkpointMgr.createCheckpoint({
            label: "max-retries-reached",
            triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
            currentStep: startStep + retryCount,
            elapsedMs: Date.now() - sessionStart,
            targetFilePath: resolvedTargetFile,
            targetFileContent: currentCode,
            metadata: { error: errMsg },
          });
          checkpointMgr.stopPeriodicCheckpoints();
          return `${RED}Autoforge error after ${retryCount} retries: ${errMsg}${RESET}\n  Session: ${sessionId} (resume with --resume=${sessionId})`;
        }
      }
    }

    checkpointMgr.stopPeriodicCheckpoints();
    process.stdout.write("\n");

    if (!result) {
      return `${RED}Autoforge: no result produced${RESET}`;
    }

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
      // Self-edit path: run repo-root verification before writing
      if (selfImprove) {
        const verification = recovery.runRepoRootVerification(state.projectRoot);
        if (!verification.passed) {
          lines.push(
            `  ${RED}Repo-root verification FAILED: ${verification.failedSteps.join(", ")}${RESET}`,
          );
          lines.push(`  Disk state: unchanged — verification must pass before self-edit commit`);

          await checkpointMgr.createCheckpoint({
            label: "verification-blocked",
            triggerCommand: `/autoforge --self-improve`,
            currentStep: startStep + result.iterations,
            elapsedMs: Date.now() - sessionStart,
            targetFilePath: resolvedTargetFile,
            targetFileContent: result.finalCode,
            pdseScores: result.finalScore
              ? [
                  {
                    filePath: displayTargetFile,
                    overall: result.finalScore.overall,
                    passedGate: result.finalScore.passedGate ?? true,
                    iteration: result.iterations,
                  },
                ]
              : [],
            metadata: { verificationFailed: verification.failedSteps },
          });
          return lines.join("\n");
        }
      }

      await writeFile(resolvedTargetFile, result.finalCode, "utf-8");

      // Record after-hash for audit trail
      recovery.recordAfterHash(resolvedTargetFile, result.finalCode);

      state.lastEditFile = resolvedTargetFile;
      state.lastEditContent = code;
      if (!state.session.activeFiles.includes(resolvedTargetFile)) {
        state.session.activeFiles.push(resolvedTargetFile);
      }
      lines.push(`  Applied to disk: ${displayTargetFile}`);
    } else {
      lines.push(`  Disk state: unchanged (${displayTargetFile})`);
    }

    // Save final checkpoint
    await checkpointMgr.createCheckpoint({
      label: result.succeeded ? "completed" : "finished-not-passed",
      triggerCommand: `/autoforge${selfImprove ? " --self-improve" : ""}`,
      currentStep: startStep + result.iterations,
      elapsedMs: Date.now() - sessionStart,
      targetFilePath: resolvedTargetFile,
      targetFileContent: result.succeeded ? result.finalCode : code,
      pdseScores: result.finalScore
        ? [
            {
              filePath: displayTargetFile,
              overall: result.finalScore.overall,
              passedGate: result.finalScore.passedGate ?? true,
              iteration: result.iterations,
            },
          ]
        : [],
      metadata: { succeeded: result.succeeded, terminationReason: result.terminationReason },
    });

    lines.push(`  Session: ${sessionId}`);
    return lines.join("\n");
  } catch (err: unknown) {
    checkpointMgr.stopPeriodicCheckpoints();
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Autoforge error: ${msg}${RESET}`;
  }
}

async function partyCommand(args: string, state: ReplState): Promise<string> {
  const hasAutoforge = /(?:^|\s)--autoforge(?:\s|$)/.test(args);
  const filesMatch = args.match(/--files\s+([^\s]+)/);
  const scopedFiles = filesMatch?.[1]
    ? filesMatch[1]
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  const resumeMatch = args.match(/--resume=([^\s]+)/);
  const resumeSession = resumeMatch?.[1];
  const task = args
    .replace(/--autoforge/g, "")
    .replace(/--files\s+[^\s]+/g, "")
    .replace(/--resume=[^\s]+/g, "")
    .trim();

  if (!task) {
    return `${RED}Usage: /party [--autoforge] [--files a,b] [--resume=<session>] <task description>${RESET}\n${DIM}Spawns multi-agent coordination with parallel lanes.${RESET}`;
  }

  if (!hasAutoforge) {
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

  const lanes = ["orchestrator", "planner", "coder", "tester", "reviewer", "deployer"] as const;
  const baseBranch = execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: state.projectRoot,
    encoding: "utf-8",
  }).trim();

  const mergedLanes: string[] = [];
  const blockedLanes: string[] = [];

  // Initialize checkpoint manager, circuit breaker, recovery engine,
  // event-sourced checkpointer, and loop detector for party mode
  const sessionId = resumeSession ?? `party-${state.session.id}-${Date.now()}`;
  const checkpointMgr = new AutoforgeCheckpointManager(state.projectRoot, sessionId);
  const taskBreaker = new TaskCircuitBreaker({
    identicalFailureThreshold: 5,
    maxRecoveryAttempts: 2,
    initialBackoffMs: 125,
    maxBackoffMs: 60_000,
    retryTimeoutMs: 60_000,
  });
  const recoveryEng = new RecoveryEngine({
    execSyncFn: (cmd, cwd) => execSync(cmd, { cwd, stdio: "pipe", encoding: "utf-8" }) as string,
  });
  const partyCheckpointer = new EventSourcedCheckpointer(state.projectRoot, sessionId);
  const partyLoopDetector = new LoopDetector({
    maxIterations: lanes.length * 3,
    identicalThreshold: 3,
    patternWindowSize: lanes.length * 2,
  });
  const sessionStart = Date.now();

  // Resume from previous session if requested
  let completedLaneNames: string[] = [];
  if (resumeSession) {
    const loaded = await checkpointMgr.loadSession(resumeSession);
    const eventCount = await partyCheckpointer.resume();
    if (loaded > 0) {
      const latest = checkpointMgr.getLatestCheckpoint();
      completedLaneNames = (latest?.metadata?.completedLanes as string[]) ?? [];
      process.stdout.write(
        `${GREEN}Resumed from checkpoint ${latest?.id} — skipping lanes: ${completedLaneNames.join(", ") || "none"} (${eventCount} events replayed)${RESET}\n`,
      );
    }
  }

  // Create initial event-sourced checkpoint for party session
  await partyCheckpointer.put(
    { task, lanes: [...lanes], completedLanes: completedLaneNames },
    { source: "input", step: 0, triggerCommand: "/party --autoforge" },
  );

  // Start periodic checkpointing
  checkpointMgr.startPeriodicCheckpoints(() => ({
    triggerCommand: "/party --autoforge",
    currentStep: mergedLanes.length,
    elapsedMs: Date.now() - sessionStart,
    worktreeBranches: lanes.map((l) => `danteparty/${state.session.id}/${l}`),
    metadata: {
      mergedLanes: [...mergedLanes],
      blockedLanes: [...blockedLanes],
      completedLanes: [...mergedLanes, ...blockedLanes.map((b) => b.split(":")[0]!.trim())],
    },
  }));

  process.stdout.write(
    `\n${YELLOW}${BOLD}Party Autoforge${RESET} ${DIM}(isolated worktrees per lane)${RESET}\n\n`,
  );

  for (const lane of lanes) {
    // Skip lanes already completed in a previous session
    if (completedLaneNames.includes(lane)) {
      process.stdout.write(`  ${DIM}skipping ${lane} (completed in previous session)${RESET}\n`);
      continue;
    }

    const worktreeSessionId = `${state.session.id}-${lane}`;
    const branch = `danteparty/${state.session.id}/${lane}`;

    try {
      process.stdout.write(`  ${DIM}creating worktree for ${lane}...${RESET}\n`);
      const worktree = createWorktree({
        branch,
        baseBranch,
        sessionId: worktreeSessionId,
        directory: state.projectRoot,
      });

      const lanePrompt = [
        `You are the ${lane} lane in a /party --autoforge workflow.`,
        `Goal: ${task}`,
        scopedFiles.length > 0
          ? `Allowed files: ${scopedFiles.join(", ")}`
          : "Allowed files: repository-wide",
        "Acceptance criteria:",
        "- Stay within your lane scope.",
        "- Run repository-root verification after major edits.",
        "- Do not commit or merge if typecheck, lint, or test fails.",
      ].join("\n");

      const laneSession = cloneSessionForTask(
        state.session,
        worktree.directory,
        `${lane}-${Date.now()}`,
      );
      const laneResult = await runAgentLoop(lanePrompt, laneSession, {
        state: state.state,
        verbose: state.verbose,
        enableGit: false,
        enableSandbox: state.enableSandbox,
        silent: true,
        selfImprovement: createSelfImprovementContext(worktree.directory, {
          workflowId: "party-autoforge",
          triggerCommand: "/party --autoforge",
          targetFiles: scopedFiles,
          auditMetadata: { lane },
        }),
      });

      const gitStatus = getStatus(worktree.directory);
      const changedFiles = [
        ...gitStatus.staged.map((entry: { path: string }) => entry.path),
        ...gitStatus.unstaged.map((entry: { path: string }) => entry.path),
        ...gitStatus.untracked.map((entry: { path: string }) => entry.path),
      ];
      const uniqueChangedFiles = [...new Set(changedFiles)];

      const scopeViolation =
        scopedFiles.length > 0 &&
        uniqueChangedFiles.some(
          (filePath) =>
            !scopedFiles.some(
              (allowed) => filePath === allowed || filePath.startsWith(`${allowed}/`),
            ),
        );

      const pdseFailures: string[] = [];
      for (const filePath of uniqueChangedFiles) {
        try {
          const content = await readFile(resolve(worktree.directory, filePath), "utf-8");
          const score = runLocalPDSEScorer(content, worktree.directory);
          if (!score.passedGate || score.overall < state.state.pdse.threshold) {
            pdseFailures.push(`${filePath} (${score.overall})`);
          }
        } catch {
          pdseFailures.push(`${filePath} (unreadable)`);
        }
      }

      // Use RecoveryEngine for repo-root verification (consistent with autoforge path)
      const laneVerification = recoveryEng.runRepoRootVerification(worktree.directory);
      const lanePassed = !scopeViolation && pdseFailures.length === 0 && laneVerification.passed;

      if (!lanePassed) {
        const failureMsg =
          `${lane}: ${scopeViolation ? "scope violation" : ""}${pdseFailures.length > 0 ? ` PDSE failed (${pdseFailures.join(", ")})` : ""}${!laneVerification.passed ? ` verification failed (${laneVerification.failedSteps.join(", ")})` : ""}`.trim();
        blockedLanes.push(failureMsg);

        // Loop detection: track lane failures for stuck patterns
        const loopCheck = partyLoopDetector.recordAction("lane_failure", failureMsg);
        if (loopCheck.stuck) {
          process.stdout.write(
            `  ${RED}Loop detected in party lanes: ${loopCheck.reason} — ${loopCheck.details}${RESET}\n`,
          );
          removeWorktree(worktree.directory);
          checkpointMgr.stopPeriodicCheckpoints();
          break;
        }

        // Record failure in circuit breaker
        const failureAction = taskBreaker.recordFailure(failureMsg, mergedLanes.length);

        // Record failure event in event-sourced checkpoint
        await partyCheckpointer.putWrite({
          taskId: `lane-fail-${lane}`,
          channel: `lane.${lane}.error`,
          value: { failureMsg, action: failureAction.action },
          timestamp: new Date().toISOString(),
        });

        if (failureAction.action === "escalate") {
          process.stdout.write(
            `  ${RED}Circuit breaker escalated after repeated lane failures${RESET}\n`,
          );
          removeWorktree(worktree.directory);

          await checkpointMgr.createCheckpoint({
            label: "escalation",
            triggerCommand: "/party --autoforge",
            currentStep: mergedLanes.length,
            elapsedMs: Date.now() - sessionStart,
            worktreeBranches: lanes.map((l) => `danteparty/${state.session.id}/${l}`),
            metadata: { mergedLanes, blockedLanes, escalated: true },
          });
          checkpointMgr.stopPeriodicCheckpoints();
          break;
        }
        if (failureAction.action === "pause_and_recover") {
          // Apply exponential backoff before recovery (Aider-style)
          const backoff = taskBreaker.getBackoffDelay(failureMsg);
          if (!backoff.timedOut && backoff.delayMs > 0) {
            process.stdout.write(
              `  ${DIM}Backoff: waiting ${backoff.delayMs}ms before next lane...${RESET}\n`,
            );
            await new Promise((r) => setTimeout(r, backoff.delayMs));
          }
          process.stdout.write(
            `  ${YELLOW}Circuit breaker paused — attempting recovery for ${lane}...${RESET}\n`,
          );
        }

        removeWorktree(worktree.directory);
        continue;
      }

      // Record success in circuit breaker + loop detector + event-sourced checkpoint
      taskBreaker.recordSuccess();
      partyLoopDetector.recordAction("lane_success", lane);
      await partyCheckpointer.putWrite({
        taskId: `lane-ok-${lane}`,
        channel: `lane.${lane}.result`,
        value: { passed: true, changedFiles: uniqueChangedFiles.length },
        timestamp: new Date().toISOString(),
      });

      if (uniqueChangedFiles.length > 0) {
        // Hash audit before merge
        for (const filePath of uniqueChangedFiles) {
          try {
            const content = await readFile(resolve(worktree.directory, filePath), "utf-8");
            recoveryEng.recordBeforeHash(filePath, content);
          } catch {
            /* skip */
          }
        }

        mergeWorktree(worktree.directory, baseBranch, state.projectRoot);
        mergedLanes.push(lane);

        // Post-merge verification using RecoveryEngine
        const postMergeVerification = recoveryEng.runRepoRootVerification(state.projectRoot);
        if (!postMergeVerification.passed) {
          blockedLanes.push(
            `post-merge gate failed after ${lane} (${postMergeVerification.failedSteps.join(", ")})`,
          );
          break;
        }
      } else {
        removeWorktree(worktree.directory);
      }

      // Save checkpoint after each lane
      await checkpointMgr.createCheckpoint({
        label: `lane-${lane}-complete`,
        triggerCommand: "/party --autoforge",
        currentStep: mergedLanes.length,
        elapsedMs: Date.now() - sessionStart,
        worktreeBranches: lanes.map((l) => `danteparty/${state.session.id}/${l}`),
        metadata: {
          mergedLanes: [...mergedLanes],
          blockedLanes: [...blockedLanes],
          completedLanes: [...mergedLanes, ...blockedLanes.map((b) => b.split(":")[0]!.trim())],
        },
      });

      state.session.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: `## ${lane}\n\n${getLastAssistantText(laneResult)}`,
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      blockedLanes.push(`${lane}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  checkpointMgr.stopPeriodicCheckpoints();

  // Final verification using RecoveryEngine
  const finalVerification = recoveryEng.runRepoRootVerification(state.projectRoot);
  const statusLine =
    blockedLanes.length === 0 && finalVerification.passed
      ? `${GREEN}${BOLD}Party Autoforge Complete: PASSED${RESET}`
      : `${YELLOW}${BOLD}Party Autoforge Complete: PARTIAL${RESET}`;

  // Save final checkpoint
  await checkpointMgr.createCheckpoint({
    label: "party-complete",
    triggerCommand: "/party --autoforge",
    currentStep: mergedLanes.length,
    elapsedMs: Date.now() - sessionStart,
    worktreeBranches: [],
    metadata: { mergedLanes, blockedLanes, finalGstackPassed: finalVerification.passed },
  });

  return [
    "",
    statusLine,
    `  Base branch: ${baseBranch}`,
    `  Merged lanes: ${mergedLanes.length > 0 ? mergedLanes.join(", ") : "none"}`,
    `  Final GStack: ${finalVerification.passed ? `${GREEN}green${RESET}` : `${RED}red${RESET}`}`,
    blockedLanes.length > 0
      ? `  Blocked lanes: ${blockedLanes.join(" | ")}`
      : "  Blocked lanes: none",
    `  Session: ${sessionId}`,
    "",
  ].join("\n");
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

  const trimmed = args.trim();

  // Handle `/listen status` subcommand
  if (trimmed === "status") {
    const port = ((state as unknown as Record<string, unknown>)._listenPort as number) ?? 8080;
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      const data = (await res.json()) as Record<string, unknown>;
      const counts = (data.taskCounts as Record<string, number>) ?? {};
      return [
        "",
        `${GREEN}${BOLD}Event Gateway Status${RESET}`,
        `  Status:    ${data.status === "ok" ? `${GREEN}OK${RESET}` : `${RED}DOWN${RESET}`}`,
        `  Uptime:    ${data.uptime}s`,
        `  Active:    ${data.activeTasks ?? 0} tasks`,
        `  Running:   ${counts.running ?? 0}`,
        `  Queued:    ${counts.queued ?? 0}`,
        `  Completed: ${counts.completed ?? 0}`,
        `  Failed:    ${counts.failed ?? 0}`,
        "",
      ].join("\n");
    } catch {
      return `${RED}Event Gateway not running. Start with /listen [port]${RESET}`;
    }
  }

  const port = trimmed ? parseInt(trimmed, 10) : 8080;
  if (isNaN(port) || port < 1 || port > 65535) {
    return `${RED}Invalid port number. Usage: /listen [port | status]${RESET}`;
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

  // Build issue-to-PR config from environment if GitHub token is available
  const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const githubRepo = process.env.GITHUB_REPOSITORY;
  const issueToPRConfig =
    githubToken && githubRepo
      ? { githubToken, repository: githubRepo, baseBranch: "main" }
      : undefined;

  // Default agent executor: run prompt through the background runner
  const agentExecutor = issueToPRConfig
    ? async (prompt: string, _workdir: string) => {
        const taskId = runner.enqueue(prompt, { autoCommit: false, createPR: false });
        return new Promise<{ output: string; touchedFiles: string[] }>((resolve, reject) => {
          const check = setInterval(() => {
            const task = runner.getTask(taskId);
            if (!task) {
              clearInterval(check);
              reject(new Error("Task not found"));
              return;
            }
            if (task.status === "completed") {
              clearInterval(check);
              resolve({ output: task.output ?? "", touchedFiles: task.touchedFiles });
            } else if (task.status === "failed" || task.status === "cancelled") {
              clearInterval(check);
              reject(new Error(task.error ?? "Task failed"));
            }
          }, 2000);
        });
      }
    : undefined;

  const handle = createWebhookServer({
    port,
    eventRegistry: registry,
    backgroundRunner: runner,
    projectRoot: state.projectRoot,
    apiToken: process.env.DANTECODE_API_TOKEN,
    slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
    issueToPR: issueToPRConfig,
    agentExecutor,
  });

  try {
    await handle.start();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Failed to start webhook server: ${msg}${RESET}`;
  }

  // Store port for /listen status
  (state as unknown as Record<string, unknown>)._listenPort = port;

  const ghSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const slackSecret = process.env.SLACK_SIGNING_SECRET;
  const apiToken = process.env.DANTECODE_API_TOKEN;
  const check = (v: string | undefined) =>
    v ? `${GREEN}configured${RESET}` : `${RED}missing${RESET}`;

  const lines = [
    "",
    `${GREEN}${BOLD}DanteCode Event Gateway — listening on port ${port}${RESET}`,
    "",
    `${BOLD}Endpoints:${RESET}`,
    `  POST /webhooks/github  — GitHub webhook receiver`,
    `  POST /webhooks/slack   — Slack webhook receiver`,
    `  POST /api/tasks        — REST API task submission`,
    `  GET  /health           — Health check`,
    "",
    `${BOLD}Secrets:${RESET}`,
    `  GITHUB_WEBHOOK_SECRET: ${check(ghSecret)}`,
    `  SLACK_SIGNING_SECRET:  ${check(slackSecret)}`,
    `  DANTECODE_API_TOKEN:   ${check(apiToken)}`,
    "",
    `${BOLD}Issue-to-PR Pipeline:${RESET}`,
    `  GITHUB_TOKEN:          ${check(githubToken)}`,
    `  GITHUB_REPOSITORY:     ${githubRepo ? `${GREEN}${githubRepo}${RESET}` : `${RED}missing${RESET}`}`,
    `  Status:                ${issueToPRConfig ? `${GREEN}enabled${RESET} — issues → auto-PR` : `${DIM}disabled (set GITHUB_TOKEN + GITHUB_REPOSITORY)${RESET}`}`,
    "",
    `${DIM}To expose publicly: npx ngrok http ${port}${RESET}`,
    `${DIM}Check status: /listen status${RESET}`,
    "",
  ];

  return lines.join("\n");
}

async function bgCommand(args: string, state: ReplState): Promise<string> {
  const runner = await ensureBackgroundRunner(state);

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
          : task.status === "paused"
            ? `${YELLOW}⏸${RESET}`
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

  const resumeMatch = trimmed.match(/^--resume\s+(\S+)$/);
  if (resumeMatch?.[1]) {
    const resumed = await runner.resume(resumeMatch[1]);
    return resumed
      ? `${GREEN}Resuming background task ${resumeMatch[1]}.${RESET}`
      : `${RED}Could not resume task ${resumeMatch[1]}.${RESET}`;
  }

  // /bg <prompt> — enqueue a new task
  // Parse flags from the raw args string
  const hasPR = trimmed.includes("--pr");
  const hasCommit = trimmed.includes("--commit") || hasPR; // --pr implies --commit
  const hasDocker = trimmed.includes("--docker");
  const hasLong = trimmed.includes("--long");

  // Strip all known flags to extract the prompt text
  const prompt = trimmed
    .replace(/--pr/g, "")
    .replace(/--commit/g, "")
    .replace(/--docker/g, "")
    .replace(/--long/g, "")
    .trim();

  if (!prompt) {
    return `${RED}Usage: /bg [--docker] [--commit] [--pr] [--long] <task description> | /bg --resume <taskId>${RESET}`;
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
    longRunning: hasLong,
  });

  const parts: string[] = [`${GREEN}Background task ${taskId} queued.${RESET}`];
  if (hasDocker) parts.push(`${DIM}(Docker)${RESET}`);
  if (hasLong) parts.push(`${DIM}(Long-running checkpoints enabled)${RESET}`);
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
// History Command
// ----------------------------------------------------------------------------

async function historyCommand(args: string, state: ReplState): Promise<string> {
  const store = new SessionStore(state.projectRoot);
  const trimmed = args.trim();

  // /history clear — delete all sessions
  if (trimmed === "clear") {
    const entries = await store.list();
    if (entries.length === 0) {
      return `${DIM}No sessions to clear.${RESET}`;
    }
    const count = await store.deleteAll();
    return `${GREEN}Cleared ${count} session(s).${RESET}`;
  }

  // /history <id> — show details of a specific session
  if (trimmed.length > 0) {
    // Try to find session by prefix match
    const entries = await store.list();
    const match = entries.find((e) => e.id === trimmed || e.id.startsWith(trimmed));
    if (!match) {
      return `${RED}Session not found: ${trimmed}${RESET}\n${DIM}Use /history to see all sessions.${RESET}`;
    }

    const session = await store.load(match.id);
    if (!session) {
      return `${RED}Could not load session: ${match.id}${RESET}`;
    }

    // Generate summary if not cached
    let summary = session.summary;
    if (!summary) {
      summary = await store.summarize(session);
    }

    // Collect files touched
    const files = session.contextFiles.length > 0 ? session.contextFiles : [];

    // Message breakdown
    const userCount = session.messages.filter((m) => m.role === "user").length;
    const assistantCount = session.messages.filter((m) => m.role === "assistant").length;
    const toolCount = session.messages.filter((m) => m.role === "tool").length;

    const lines = [
      "",
      `${BOLD}Session Details${RESET}`,
      "",
      `  ${CYAN}ID:${RESET}        ${session.id}`,
      `  ${CYAN}Title:${RESET}     ${session.title}`,
      `  ${CYAN}Model:${RESET}     ${session.model}`,
      `  ${CYAN}Created:${RESET}   ${new Date(session.createdAt).toLocaleString()}`,
      `  ${CYAN}Updated:${RESET}   ${new Date(session.updatedAt).toLocaleString()}`,
      `  ${CYAN}Messages:${RESET}  ${session.messages.length} total (${userCount} user, ${assistantCount} assistant, ${toolCount} tool)`,
      "",
      `  ${CYAN}Summary:${RESET}   ${summary}`,
    ];

    if (files.length > 0) {
      lines.push("");
      lines.push(`  ${CYAN}Files:${RESET}`);
      for (const f of files.slice(0, 10)) {
        lines.push(`    ${DIM}- ${f}${RESET}`);
      }
      if (files.length > 10) {
        lines.push(`    ${DIM}... and ${files.length - 10} more${RESET}`);
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  // /history — list last 20 sessions
  const entries = await store.list();
  if (entries.length === 0) {
    return `${DIM}No saved sessions. Sessions are stored in .dantecode/sessions/.${RESET}`;
  }

  const recent = entries.slice(0, 20);
  const lines = [
    "",
    `${BOLD}Session History${RESET} ${DIM}(${entries.length} total, showing last ${recent.length})${RESET}`,
    "",
    `  ${DIM}${"ID".padEnd(12)} ${"Title".padEnd(30)} ${"Date".padEnd(20)} Msgs${RESET}`,
    `  ${DIM}${"─".repeat(12)} ${"─".repeat(30)} ${"─".repeat(20)} ${"─".repeat(4)}${RESET}`,
  ];

  for (const entry of recent) {
    const shortId = entry.id.slice(0, 10) + "..";
    const title = entry.title.length > 28 ? entry.title.slice(0, 27) + "..." : entry.title;
    const date = new Date(entry.updatedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    lines.push(
      `  ${CYAN}${shortId.padEnd(12)}${RESET} ${title.padEnd(30)} ${DIM}${date.padEnd(20)}${RESET} ${entry.messageCount}`,
    );
  }

  lines.push("");
  lines.push(`${DIM}Use /history <id> for details, /history clear to delete all.${RESET}`);
  lines.push("");

  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Slash Command Registry
// ----------------------------------------------------------------------------
async function repoMemoryCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const memory = await generateRepoMemory(state.projectRoot);
    return `${GREEN}Repo memory generated:${RESET}\n` +
           `  File nodes: ${memory.fileGraph.length}\n` +
           `  Symbol nodes: ${memory.symbolGraph.length}\n` +
           `  Test mappings: ${memory.testMap.length}\n` +
           `  Hotspots: ${memory.hotspots.length}\n` +
           `  Saved to: .dantecode/repo_memory.json`;
  } catch (error) {
    return `${RED}Failed to generate repo memory: ${error}${RESET}`;
  }
}

async function repairCommand(args: string, state: ReplState): Promise<string> {
  const repairLoop = new BoundedRepairLoop();
  const errorOutput = args || "Simulated error for testing";

  try {
    const attempt = await repairLoop.attemptRepair(errorOutput, state.projectRoot);
    if (attempt) {
      return `${GREEN}Repair attempt ${attempt.attemptNumber}:${RESET}\n` +
             `  Category: ${attempt.classification.category}\n` +
             `  Strategy: ${attempt.plan.strategy}\n` +
             `  Result: ${attempt.result}\n` +
             `  Prompt generated for repair.`;
    } else {
      return `${YELLOW}No repair attempted (max retries reached or not actionable)${RESET}`;
    }
  } catch (error) {
    return `${RED}Repair failed: ${error}${RESET}`;
  }
}

async function pluginsCommand(_args: string, _state: ReplState): Promise<string> {
  const plugins = skillsManager.listPlugins();
  const commands = skillsManager.listCommands();

  let output = `${GREEN}Loaded Plugins:${RESET}\n`;
  for (const plugin of plugins) {
    output += `  - ${plugin}\n`;
  }

  output += `\n${GREEN}Custom Commands:${RESET}\n`;
  for (const cmd of commands) {
    output += `  - /${cmd.name}: ${cmd.description}\n`;
  }

  return output;
}

async function benchmarkCommand(args: string, state: ReplState): Promise<string> {
  const maxInstances = args.trim() ? parseInt(args.trim(), 10) : undefined;

  try {
    const { runBuiltinBenchmark, formatBenchmarkReport } = await import(
      "./commands/benchmark.js"
    );
    const report = await runBuiltinBenchmark(state.projectRoot, { maxInstances });
    return formatBenchmarkReport(report);
  } catch (error) {
    return `${RED}Benchmark failed: ${error}${RESET}`;
  }
}

async function securityAuditCommand(_args: string, state: ReplState): Promise<string> {
  try {
    const audit = await runSecurityAudit(state.projectRoot);

    let output = `${GREEN}Security Audit Results:${RESET}\n`;
    output += `Compliance Score: ${audit.complianceScore}/100\n`;
    output += `Last Audit: ${audit.lastAudit}\n\n`;

    if (audit.vulnerabilities.length > 0) {
      output += `${RED}Vulnerabilities Found:${RESET}\n`;
      for (const vuln of audit.vulnerabilities) {
        output += `  ${vuln.severity.toUpperCase()}: ${vuln.description}\n`;
        output += `    Mitigation: ${vuln.mitigation}\n\n`;
      }
    } else {
      output += `${GREEN}No vulnerabilities detected${RESET}\n`;
    }

    return output;
  } catch (error) {
    return `${RED}Audit failed: ${error}${RESET}`;
  }
}

async function chaosTestCommand(_args: string, _state: ReplState): Promise<string> {
  try {
    const testFn = async () => {
      // Simple test: run a basic command
      return "Chaos test executed";
    };

    const result = await chaosTester.runChaosTest(testFn);

    let output = `${GREEN}Chaos Test Results:${RESET}\n`;
    output += `Overall Success: ${result.overallSuccess ? 'PASS' : 'FAIL'}\n\n`;

    for (const r of result.results) {
      output += `${r.fault}: ${r.success ? 'PASS' : 'FAIL'}`;
      if (r.error) output += ` (${r.error})`;
      output += `\n`;
    }

    return output;
  } catch (error) {
    return `${RED}Chaos test failed: ${error}${RESET}`;
  }
}

async function testMCPCommand(_args: string, _state: ReplState): Promise<string> {
  try {
    const success = await testMCPIntegration();
    if (success) {
      return `${GREEN}MCP Integration Test: PASSED${RESET}\nExternal tool calling and listing works correctly.`;
    } else {
      return `${RED}MCP Integration Test: FAILED${RESET}\nTool bridging or external connection failed.`;
    }
  } catch (error) {
    return `${RED}MCP test error: ${error}${RESET}`;
  }
}

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
    name: "history",
    description: "List past sessions, view details, or clear history",
    usage: "/history [id | clear]",
    handler: historyCommand,
  },
  {
    name: "clear",
    description: "Clear conversation history",
    usage: "/clear",
    handler: clearCommand,
  },
  { name: "tokens", description: "Show token usage", usage: "/tokens", handler: tokensCommand },
  {
    name: "cost",
    description: "Show cost dashboard with session spending and provider rates",
    usage: "/cost [rates]",
    handler: costCommand,
  },
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
    usage: "/autoforge [--self-improve] [--silent] [--persist]",
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
    usage: "/party [--autoforge] [--files a,b] <task>",
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
    usage: "/bg [--docker] [--commit] [--pr] [--long] [task | --resume <id> | cancel <id> | clear]",
    handler: bgCommand,
  },
  {
    name: "listen",
    description: "Start webhook server for GitHub/Slack events",
    usage: "/listen [port | status]",
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
  {
    name: "repo-memory",
    description: "Generate persistent repo intelligence maps",
    usage: "/repo-memory",
    handler: repoMemoryCommand,
  },
  {
    name: "repair",
    description: "Trigger bounded repair loop on recent failures",
    usage: "/repair [error-output]",
    handler: repairCommand,
  },
  {
    name: "plugins",
    description: "List loaded plugins and custom commands",
    usage: "/plugins",
    handler: pluginsCommand,
  },
  {
    name: "benchmark",
    description: "Run evaluation benchmarks",
    usage: "/benchmark [suite-name]",
    handler: benchmarkCommand,
  },
  {
    name: "security-audit",
    description: "Run security audit scan",
    usage: "/security-audit",
    handler: securityAuditCommand,
  },
  {
    name: "chaos-test",
    description: "Run chaos testing",
    usage: "/chaos-test",
    handler: chaosTestCommand,
  },
  {
    name: "test-mcp",
    description: "Test MCP integration",
    usage: "/test-mcp",
    handler: testMCPCommand,
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

  // Check built-in commands first
  let command = SLASH_COMMANDS.find((c) => c.name === commandName);

  // If not found, check custom plugin commands
  if (!command) {
    const customCommand = skillsManager.getCommand(commandName);
    if (customCommand) {
      return customCommand.handler(args, state);
    }
  }

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
