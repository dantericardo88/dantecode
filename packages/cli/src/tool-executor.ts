// ============================================================================
// @dantecode/cli — Tool Execution Batch Processor
// Extracted from agent-loop.ts: processes a batch of tool calls with all
// safety checks, dispatch logic, result processing, and post-loop gates.
// ============================================================================

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  globalToolScheduler,
  adaptToolResult,
  formatEvidenceSummary,
  globalApprovalGateway,
  analyzeBashCommand,
  detectPlatformSandbox,
  buildSandboxedCommand,
} from "@dantecode/core";
import type { PlatformSandboxResult } from "@dantecode/core";
import type { ExecutionPolicyEngine, SecurityEngine, SecretsScanner } from "@dantecode/core";
import type { DurableRunStore } from "@dantecode/core";
import type {
  ExecutionEvidence,
  Session,
  SessionMessage,
  SelfImprovementContext,
} from "@dantecode/config-types";
import { getStatus, autoCommit } from "@dantecode/git-engine";
import { executeTool } from "./tools.js";
import { normalizeAndCheckBash } from "./safety.js";
import { SandboxBridge } from "./sandbox-bridge.js";
import { getWrittenFilePath, getAllWrittenFilePath } from "./danteforge-pipeline.js";
import { isPlanModeBlocked, planModeBlockedMessage } from "./plan-mode-guard.js";
import {
  createSubAgentExecutor,
  extractBackgroundTaskId,
  formatBackgroundWaitNotice,
  getBackgroundResumeNextAction,
} from "./background-task-manager.js";
import {
  buildExecutionEvidence,
  isMajorEditBatch,
  runMajorEditBatchGate,
} from "./verification-pipeline.js";
import type { MajorEditBatchGateResult } from "./verification-pipeline.js";
import type { ExtractedToolCall } from "./tool-call-parser.js";
import type { AgentLoopConfig } from "./agent-loop.js";
import {
  YELLOW,
  GREEN,
  RED,
  DIM,
  BOLD,
  RESET,
  PROGRESS_EMIT_INTERVAL,
  DESTRUCTIVE_GIT_RE,
  RM_SOURCE_RE,
  REFLECTION_CHECKPOINT_INTERVAL,
  REFLECTION_PROMPT,
  WRITE_SIZE_WARNING_THRESHOLD,
} from "./agent-loop-constants.js";

// ----------------------------------------------------------------------------
// Platform Sandbox — lazy singleton
// ----------------------------------------------------------------------------

let _platformSandbox: PlatformSandboxResult | null = null;

function getPlatformSandbox(): PlatformSandboxResult {
  if (!_platformSandbox) {
    _platformSandbox = detectPlatformSandbox();
  }
  return _platformSandbox;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Number of identical consecutive tool calls before stuck-loop detection fires. */
const STUCK_LOOP_THRESHOLD = 3;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Mutable state passed into the tool batch executor. */
export interface ToolExecutionContext {
  session: Session;
  config: AgentLoopConfig;
  roundCounter: number;
  maxToolRounds: number;
  durableRun: { id: string };
  durableRunStore: DurableRunStore;
  workflowName: string | undefined;
  isPipelineWorkflow: boolean;
  touchedFiles: string[];
  evidenceLedger: ExecutionEvidence[];
  lastConfirmedStep: string;
  lastSuccessfulTool: string | undefined;
  lastSuccessfulToolResult: string | undefined;
  filesModified: number;
  toolCallsThisTurn: number;
  executedToolsThisTurn: number;
  completedToolsThisTurn: Set<string>;
  recentToolSignatures: string[];
  readTracker: Map<string, string>;
  editAttempts: Map<string, number>;
  lastMajorEditGatePassed: boolean;
  effectiveSelfImprovement: SelfImprovementContext | null | undefined;
  executionPolicy: ExecutionPolicyEngine;
  securityEngine: SecurityEngine;
  secretsScanner: SecretsScanner;
  localSandboxBridge: SandboxBridge | null;
  testsRun: number;
  bashSucceeded: number;
  currentApproachToolCalls: number;
  toolErrorCounts: Map<string, number>;
  executionIntegrity: import("@dantecode/core").ExecutionIntegrityManager;
  messageId: string;
}

/** Maximum times a single tool type can fail before the model is told to stop using it. */
const MAX_PER_TOOL_ERRORS = 5;

/** Result returned from the tool batch executor. */
export interface ToolExecutionResult {
  action: "continue" | "return" | "proceed";
  toolResults: string[];
  filesModified: number;
  testsRun: number;
  bashSucceeded: number;
  executedToolsThisTurn: number;
  toolCallsThisTurn: number;
  currentApproachToolCalls: number;
  lastConfirmedStep: string;
  lastSuccessfulTool: string | undefined;
  lastSuccessfulToolResult: string | undefined;
  lastMajorEditGatePassed: boolean;
  localSandboxBridge: SandboxBridge | null;
  roundWrittenFiles: string[];
}

// ----------------------------------------------------------------------------
// Main entry point
// ----------------------------------------------------------------------------

/**
 * Execute a batch of tool calls with all safety checks, scheduling, evidence
 * collection, and post-loop gates. Returns a result indicating whether the
 * caller should continue the agent loop, return early, or proceed normally.
 */
export async function executeToolBatch(
  toolCalls: ExtractedToolCall[],
  toolCallParseErrors: string[],
  ctx: ToolExecutionContext,
  runAgentLoopFn: (prompt: string, session: Session, config: AgentLoopConfig) => Promise<Session>,
): Promise<ToolExecutionResult> {
  // Destructure mutable state from context — we mutate local copies and return them.
  const { session, config } = ctx;
  let {
    filesModified,
    toolCallsThisTurn,
    executedToolsThisTurn,
    currentApproachToolCalls,
    lastConfirmedStep,
    lastSuccessfulTool,
    lastSuccessfulToolResult,
    lastMajorEditGatePassed,
    localSandboxBridge,
    testsRun,
    bashSucceeded,
  } = ctx;
  const {
    roundCounter,
    maxToolRounds,
    durableRun,
    durableRunStore,
    workflowName,
    isPipelineWorkflow,
    touchedFiles,
    evidenceLedger,
    recentToolSignatures,
    readTracker,
    editAttempts,
    effectiveSelfImprovement,
    securityEngine,
    secretsScanner,
    completedToolsThisTurn,
  } = ctx;

  // Execute each tool call
  const toolResults: string[] = [];
  // If some <tool_use> blocks were valid but others were malformed, report the
  // malformed ones alongside valid tool results so the model can fix and retry.
  if (toolCallParseErrors.length > 0) {
    const errorSummary = toolCallParseErrors.map((e, i) => `  Block ${i + 1}: ${e}`).join("\n");
    toolResults.push(
      `SYSTEM ERROR: ${toolCallParseErrors.length} <tool_use> block(s) had malformed JSON — NOT executed:\n${errorSummary}\n` +
        `Fix JSON escaping and re-emit those tool calls in your next response.`,
    );
  }
  const roundWrittenFiles: string[] = [];
  let roundMajorEditGateResult: MajorEditBatchGateResult | null = null;
  let toolIndex = 0;

  for (const toolCall of toolCalls) {
    executedToolsThisTurn++;
    toolCallsThisTurn++;
    currentApproachToolCalls++;
    toolIndex++;

    // Enhanced retry detection using semantic similarity (upgraded from opencode pattern)
    const retryDecision = ctx.executionPolicy.assessToolCall({
      name: toolCall.name,
      args: toolCall.input,
    });

    if (retryDecision?.type === "retry_stuck") {
      const similarCount = Number(retryDecision.metadata?.similarCount ?? 0);
      process.stdout.write(
        `\n${RED}${BOLD}⚠️  Retry loop detected:${RESET} ${DIM}${toolCall.name} failed ${similarCount}+ times with similar errors. Breaking loop.${RESET}\n`,
      );
      toolResults.push(
        `SYSTEM: Retry loop detected — you have called ${toolCall.name} ${similarCount}+ times with similar arguments/errors. This approach is not working. Stop repeating this action and try a fundamentally different approach, or ask the user for help with the underlying issue.`,
      );
      break;
    }

    if (retryDecision?.type === "retry_warning") {
      const similarCount = Number(retryDecision.metadata?.similarCount ?? 0);
      process.stdout.write(
        `\n${YELLOW}${BOLD}🔄 Retry warning:${RESET} ${DIM}${toolCall.name} attempted ${similarCount}+ times.${RESET}\n`,
      );
    }

    // Keep the old signature tracking for backward compatibility
    const toolSig = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
    recentToolSignatures.push(toolSig);
    if (recentToolSignatures.length > STUCK_LOOP_THRESHOLD) {
      recentToolSignatures.shift();
    }

    // Approval gateway hard enforcement FIRST: non-consuming peek so auto_deny policies
    // are enforced as the primary layer. In plan mode the gateway has auto_deny rules
    // for Write/Edit/SubAgent, so this fires before the soft guard below.
    // Uses peekDecision so pre-approved fingerprints are not consumed before the
    // scheduler runs check() downstream.
    {
      const gatewayDecision = globalApprovalGateway.peekDecision(
        toolCall.name,
        toolCall.input as Record<string, unknown>,
      );
      if (gatewayDecision === "auto_deny") {
        const denyMsg =
          `APPROVAL GATEWAY DENIED: "${toolCall.name}" is permanently blocked by the current ` +
          `approval policy. Change the operator mode or switch to apply/yolo before retrying.`;
        if (!config.silent) {
          process.stdout.write(`\n${RED}${BOLD}[gateway-deny]${RESET} ${RED}${denyMsg}${RESET}\n`);
        }
        toolResults.push(denyMsg);
        continue;
      }
    }

    // Plan mode soft guard: fallback for cases where config.planModeActive is true
    // but the approval gateway was not configured in plan mode (mode drift).
    if (config.planModeActive && isPlanModeBlocked(toolCall.name)) {
      const blockMsg = planModeBlockedMessage(toolCall.name);
      toolResults.push(blockMsg);
      continue;
    }
    // Check taskMode from policy or context; integrate with new policy rules for observe-only
    const effectiveTaskMode = config.taskMode;
    if (
      effectiveTaskMode &&
      (effectiveTaskMode === "observe-only" || effectiveTaskMode === "diagnose-only")
    ) {
      const blockedTools = ["Write", "Edit", "Bash", "GitCommit", "SubAgent"];
      if (
        blockedTools.includes(toolCall.name) ||
        (toolCall.name === "Bash" &&
          /build|turbo|npm run|fallback/.test(String(toolCall.input?.command || "")))
      ) {
        const proposedMsg = `TASK BOUNDARY ENFORCED (${effectiveTaskMode}): No edits, builds, fallback or exploration. Proposed next step: report observations only and stop.`;
        toolResults.push(proposedMsg);
        continue;
      }
    }

    // Pre-tool safety hook (Ruflo/ccswarm pattern): block dangerous Bash commands
    if (toolCall.name === "Bash") {
      const bashCmd = toolCall.input["command"] as string | undefined;
      if (bashCmd) {
        const blockReason = normalizeAndCheckBash(bashCmd);
        if (blockReason) {
          process.stdout.write(
            `\n${RED}${BOLD}BLOCKED:${RESET} ${RED}${blockReason}${RESET}\n${DIM}Command: ${bashCmd.slice(0, 100)}${RESET}\n`,
          );
          toolResults.push(
            `SAFETY HOOK: Bash command blocked — ${blockReason}. Use a safer approach.`,
          );
          continue;
        }

        // Destructive-git pipeline guard: block git clean, git checkout --, git reset --hard
        // during ANY pipeline or workflow execution (applies to ALL models — Grok, GPT, Claude).
        // These commands wipe untracked/unstaged work, destroying everything written this session.
        if (isPipelineWorkflow && DESTRUCTIVE_GIT_RE.test(bashCmd)) {
          if (!config.silent) {
            process.stdout.write(
              `\n${RED}[pipeline-guard] BLOCKED destructive git command — \`${bashCmd.slice(0, 80)}\`${RESET}\n`,
            );
          }
          toolResults.push(
            `[PIPELINE GUARD] Destructive git command BLOCKED: \`${bashCmd}\`\n` +
              `This command would undo all in-progress work. During a pipeline/workflow you MUST NOT run:\n` +
              `  - git clean (removes untracked files)\n` +
              `  - git checkout -- . (discards unstaged changes)\n` +
              `  - git reset --hard / --merge (discards ALL changes)\n` +
              `  - git stash --include-untracked (stashes new files out of existence)\n` +
              `Instead: use Edit/Write/Read tools to make file changes. ` +
              `Use GitCommit only AFTER real file edits (Edit or Write tool results).`,
          );
          continue;
        }

        // rm -rf source directory guard: block deletion of package/source dirs during pipelines.
        // When typecheck fails on a newly-created package, Grok often runs `rm -rf packages/<name>`
        // to "clean up" the broken package — destroying all in-progress work.
        if (isPipelineWorkflow && RM_SOURCE_RE.test(bashCmd)) {
          if (!config.silent) {
            process.stdout.write(
              `\n${RED}[pipeline-guard] BLOCKED rm on source directory — \`${bashCmd.slice(0, 80)}\`${RESET}\n`,
            );
          }
          toolResults.push(
            `[PIPELINE GUARD] Destructive rm BLOCKED: \`${bashCmd}\`\n` +
              `Deleting package/source directories during a pipeline destroys all in-progress work.\n` +
              `Instead: fix the TypeScript errors in the new package using Edit. ` +
              `Read the failing file, then Edit to correct the type issues.`,
          );
          continue;
        }

        // Bash analysis (OpenCode pattern): pattern-based static analysis before execution.
        // Runs before SecurityEngine so critical commands are blocked before any external check.
        const bashAnalysis = analyzeBashCommand(bashCmd, session.projectRoot);
        if (bashAnalysis.estimatedRiskLevel === "critical") {
          if (!config.silent) {
            process.stdout.write(
              `\n${RED}${BOLD}[bash-analysis] BLOCKED (critical):${RESET} ${RED}${bashAnalysis.reason ?? "critical risk pattern"}${RESET}\n` +
                `${DIM}Command: ${bashCmd.slice(0, 100)}${RESET}\n`,
            );
          }
          toolResults.push(
            `BASH ANALYSIS: Command BLOCKED — critical risk detected. ${bashAnalysis.reason ?? ""}. ` +
              `This command could cause irreversible damage. Use a safer approach.`,
          );
          // Log to audit trail
          evidenceLedger.push({
            id: randomUUID(),
            kind: "blocked_action",
            success: false,
            label: `Bash blocked (critical): ${bashCmd.slice(0, 80)}`,
            timestamp: new Date().toISOString(),
            command: bashCmd,
            details: { reason: bashAnalysis.reason, riskLevel: "critical" },
          });
          continue;
        }

        if (bashAnalysis.requiresApproval && !config.silent) {
          process.stdout.write(
            `\n${YELLOW}[bash-analysis] high-risk command (${bashAnalysis.estimatedRiskLevel}):${RESET} ${DIM}${bashCmd.slice(0, 100)}${RESET}\n` +
              (bashAnalysis.reason ? `${DIM}  Reason: ${bashAnalysis.reason}${RESET}\n` : "") +
              (bashAnalysis.externalPaths.length > 0
                ? `${DIM}  External paths: ${bashAnalysis.externalPaths.join(", ")}${RESET}\n`
                : ""),
          );
        }

        if (bashAnalysis.estimatedRiskLevel === "medium" && !config.silent) {
          process.stdout.write(
            `${DIM}[bash-analysis] medium-risk: ${bashCmd.slice(0, 60)}${RESET}\n`,
          );
        }

        // SecurityEngine: zero-trust multi-layer check for Bash commands.
        // Evaluates command against built-in rules (critical: curl|sh, dd, mkfs, fork bomb, etc.)
        // and anomaly detection. Runs AFTER existing destructive guards to avoid double-blocking.
        const secCheckResult = securityEngine.checkAction({
          layer: "tool",
          tool: "Bash",
          command: bashCmd,
        });
        if (secCheckResult.decision === "block" || secCheckResult.decision === "quarantine") {
          if (secCheckResult.decision === "quarantine") {
            securityEngine.quarantineAction(
              { layer: "tool", tool: "Bash", command: bashCmd },
              secCheckResult,
            );
          }
          if (!config.silent) {
            process.stdout.write(
              `\n${RED}[security-engine] BLOCKED Bash (${secCheckResult.riskLevel}): ${secCheckResult.reasons.join("; ")}${RESET}\n`,
            );
          }
          toolResults.push(
            `SECURITY ENGINE: Bash command BLOCKED (risk: ${secCheckResult.riskLevel}). ` +
              `Reasons: ${secCheckResult.reasons.join("; ")}. ` +
              `Use a safer approach to accomplish this task.`,
          );
          continue;
        }

        // SecurityEngine: scan bash command content for secrets (e.g. tokens passed as env vars).
        const bashSecretScan = secretsScanner.scan(bashCmd);
        if (!bashSecretScan.clean) {
          if (!config.silent) {
            process.stdout.write(
              `\n${RED}[secrets-scanner] WARNING: Bash command may contain secrets — ${bashSecretScan.summary}${RESET}\n`,
            );
          }
          toolResults.push(
            `SECRETS WARNING: Bash command may contain secrets: ${bashSecretScan.summary}. ` +
              `Avoid passing secrets directly in command arguments. Use environment variables or files.`,
          );
          // Warn but do not block — bash commands legitimately use env vars by name
        }
      }
    }

    // Write size guard: block large Write payloads on existing files (force Edit).
    // Grok models try to rewrite entire files (50K+ chars) instead of using Edit.
    if (toolCall.name === "Write") {
      const writeContent = toolCall.input["content"] as string | undefined;
      if (writeContent && writeContent.length > WRITE_SIZE_WARNING_THRESHOLD) {
        const writeFilePath = toolCall.input["file_path"] as string | undefined;
        const fileExists =
          writeFilePath && readTracker.has(resolve(session.projectRoot, writeFilePath));
        if (fileExists) {
          // Block: model is rewriting an existing file with a massive payload
          if (!config.silent) {
            process.stdout.write(
              `\n${RED}[confab-guard] BLOCKED Write (${Math.round(writeContent.length / 1000)}K chars) to existing file. Use Edit for surgical changes.${RESET}\n`,
            );
          }
          toolResults.push(
            `SYSTEM: Write BLOCKED — your payload is ${Math.round(writeContent.length / 1000)}K characters, which will truncate and corrupt the file. ` +
              `The file "${writeFilePath}" already exists. Use the Edit tool for surgical changes instead of rewriting the entire file. ` +
              `Break your changes into multiple small Edit calls targeting specific sections.`,
          );
          continue;
        }
        // New file: warn but allow
        if (!config.silent) {
          process.stdout.write(
            `\n${YELLOW}[confab-guard] Write payload is ${Math.round(writeContent.length / 1000)}K chars — large file.${RESET}\n`,
          );
        }
      }

      // SecretsScanner: block Write if content contains detected secrets.
      // Runs on ALL Write tool calls (before execution) to prevent accidentally
      // persisting API keys, tokens, private keys, or passwords to disk.
      const writeContentToScan = toolCall.input["content"] as string | undefined;
      if (writeContentToScan) {
        const scanResult = secretsScanner.scan(writeContentToScan);
        if (!scanResult.clean) {
          const writeFilePath = toolCall.input["file_path"] as string | undefined;
          if (!config.silent) {
            process.stdout.write(
              `\n${RED}[secrets-scanner] BLOCKED Write to "${writeFilePath ?? "unknown"}" — ${scanResult.summary}${RESET}\n`,
            );
          }
          toolResults.push(
            `SYSTEM: Write BLOCKED — secrets detected in content: ${scanResult.summary}. ` +
              `Do NOT hardcode secrets (API keys, tokens, private keys, passwords) in source files. ` +
              `Use environment variables or a secrets manager instead. ` +
              `Remove the sensitive values before retrying the Write.`,
          );
          continue;
        }
      }
    }

    // Silent mode (Ruflo pattern): compact progress counter
    if (config.silent) {
      process.stdout.write(
        `\r${DIM}[${toolIndex}/${toolCalls.length} tools] ${toolCall.name}${RESET}` +
          " ".repeat(20),
      );
    } else {
      process.stdout.write(`\n${DIM}[tool: ${toolCall.name}]${RESET} `);
    }

    if (config.verbose && !config.silent) {
      process.stdout.write(`${DIM}${JSON.stringify(toolCall.input).slice(0, 200)}${RESET}\n`);
    }

    // Pre-mutation snapshot: before the FIRST Write/Edit to a file this session,
    // capture a Tier 1 persistent debug-trail snapshot so /undo has a reliable
    // restore target that survives session exit (not just the ephemeral in-memory fallback).
    if (toolCall.name === "Write" || toolCall.name === "Edit") {
      const preMutTarget = toolCall.input["file_path"] as string | undefined;
      if (preMutTarget) {
        const resolvedPreMut = resolve(session.projectRoot, preMutTarget);
        const snapshotted = config.replState?.preMutationSnapshotted;
        if (snapshotted && !snapshotted.has(resolvedPreMut)) {
          snapshotted.add(resolvedPreMut); // mark before async to prevent double-capture
          try {
            const trailMod = await import("@dantecode/debug-trail");
            const bridge = new trailMod.CliBridge(trailMod.getGlobalLogger());
            await bridge.debugSnapshot(resolvedPreMut);
            if (config.verbose) {
              process.stdout.write(
                `${DIM}[pre-mutation-snapshot] captured for ${preMutTarget}${RESET}\n`,
              );
            }
          } catch {
            snapshotted.delete(resolvedPreMut); // allow retry on next attempt
            if (!config.silent) {
              process.stderr.write(
                `\n${YELLOW}[pre-mutation-snapshot] warn: snapshot for ${preMutTarget} failed` +
                  ` — /undo Tier 1 unavailable for this file (in-memory fallback active)${RESET}\n`,
              );
            }
          }
        }
      }
    }

    // Dirty-commit-before-edit (aider pattern): if the agent is about to edit
    // a file that has uncommitted changes, commit those first so /undo works cleanly
    if (
      config.enableGit &&
      config.state.git.dirtyCommitBeforeEdit &&
      (toolCall.name === "Write" || toolCall.name === "Edit")
    ) {
      try {
        const targetPath = toolCall.input["file_path"] as string | undefined;
        if (targetPath) {
          const gitStatus = getStatus(session.projectRoot);
          const dirtyPaths = [
            ...gitStatus.unstaged.map((s: { path: string }) => s.path),
            ...gitStatus.staged.map((s: { path: string }) => s.path),
          ];
          const resolvedTarget = resolve(session.projectRoot, targetPath);
          const isDirty = dirtyPaths.some(
            (p) => resolve(session.projectRoot, p) === resolvedTarget,
          );
          if (isDirty) {
            autoCommit(
              {
                message: `dantecode: snapshot before agent edit of ${targetPath}`,
                footer: "",
                files: [targetPath],
                allowEmpty: false,
              },
              session.projectRoot,
            );
            if (config.verbose) {
              process.stdout.write(
                `${DIM}[dirty-commit: saved pre-edit state of ${targetPath}]${RESET}\n`,
              );
            }
          }
        }
      } catch {
        // Non-fatal: if the dirty commit fails, continue with the edit anyway
      }
    }

    // DTR Phase 6: ExecutionPolicy dependency gate — block tools whose declared
    // dependsOn tools have not yet completed in this turn.
    // Premature commit blocker: block GitCommit/GitPush when no files have been
    // modified this session. Grok models confabulate file edits in their narrative
    // text, then try to commit non-existent changes.
    if (
      (toolCall.name === "GitCommit" || toolCall.name === "GitPush") &&
      filesModified === 0 &&
      isPipelineWorkflow
    ) {
      if (!config.silent) {
        process.stdout.write(
          `\n${RED}[confab-guard] BLOCKED ${toolCall.name} — 0 files modified this session. Write/Edit files first.${RESET}\n`,
        );
      }
      toolResults.push(
        `SYSTEM: ${toolCall.name} BLOCKED — you have not modified any files in this session (filesModified === 0). ` +
          `You cannot commit or push changes that do not exist. Use Edit or Write tools to make real file changes first, ` +
          `then commit. Do NOT claim you already made changes — only tool results count.`,
      );
      continue;
    }

    if (toolCall.name === "GitCommit" || toolCall.name === "GitPush") {
      if (isMajorEditBatch(roundWrittenFiles, session.projectRoot) && !roundMajorEditGateResult) {
        roundMajorEditGateResult = await runMajorEditBatchGate(
          session.id,
          session.projectRoot,
          roundCounter,
          config.selfImprovement,
          readTracker,
          editAttempts,
        );
        lastMajorEditGatePassed = roundMajorEditGateResult.passed;

        if (!roundMajorEditGateResult.passed) {
          const failedSteps = roundMajorEditGateResult.failedSteps.join(", ");
          toolResults.push(
            `SYSTEM: ${toolCall.name} blocked. Major edit batch verification failed at the repository root (${failedSteps}). Fix typecheck, lint, and test before committing or pushing.`,
          );
          if (!config.silent) {
            process.stdout.write(`\n${RED}[gstack: blocked commit — ${failedSteps}]${RESET}\n`);
          }
          continue;
        }
      }

      if (!lastMajorEditGatePassed) {
        toolResults.push(
          `SYSTEM: ${toolCall.name} blocked because the last major edit batch failed repository-root verification. Fix the failing checks before attempting ${toolCall.name} again.`,
        );
        continue;
      }
    }

    // Route MCP tool calls to the MCP client
    const isMCPTool = toolCall.name.startsWith("mcp_") && config.mcpClient;

    // Route Bash commands through sandbox when available
    if (
      toolCall.name === "Bash" &&
      config.enableSandbox &&
      !config.sandboxBridge &&
      !localSandboxBridge
    ) {
      localSandboxBridge = new SandboxBridge(session.projectRoot, config.verbose);
    }

    const activeSandboxBridge = config.sandboxBridge ?? localSandboxBridge ?? undefined;
    const useSandbox =
      toolCall.name === "Bash" &&
      activeSandboxBridge &&
      typeof toolCall.input["command"] === "string";

    // Platform-native sandbox: wrap Bash commands with OS-level restrictions when
    // no DanteSandbox bridge is active (avoids double-wrapping).
    // Only applied in workspace-write mode (default) — does not override bridges.
    // On Windows the Job Object is applied at spawn time, not as a command wrapper,
    // so we skip command wrapping there.
    let effectiveToolCallInput = toolCall.input;
    if (
      toolCall.name === "Bash" &&
      !useSandbox &&
      typeof toolCall.input["command"] === "string"
    ) {
      const platformSandbox = getPlatformSandbox();
      if (platformSandbox.available && platformSandbox.platform !== "windows-job") {
        const rawCmd = toolCall.input["command"] as string;
        // Wrap via sh -c so the original shell command string is preserved intact
        const wrapped = buildSandboxedCommand(
          "sh",
          ["-c", rawCmd],
          { mode: "workspace-write", projectRoot: session.projectRoot },
          platformSandbox,
        );
        // Reconstruct as a single command string for tools.ts
        const wrappedCmd = [wrapped.command, ...wrapped.args]
          .map((a) => (a.includes(" ") ? `"${a.replace(/"/g, '\\"')}"` : a))
          .join(" ");
        effectiveToolCallInput = { ...toolCall.input, command: wrappedCmd };
      }
    }

    const _toolStartMs = Date.now();
    const [schedulerResult] = await globalToolScheduler.executeBatch(
      [
        {
          id: toolCall.id,
          toolName: toolCall.name,
          input: effectiveToolCallInput,
          dependsOn: toolCall.dependsOn,
        },
      ],
      {
        requestId: `round-${roundCounter}`,
        projectRoot: session.projectRoot,
        completedTools: completedToolsThisTurn,
        execute: async (scheduledToolCall) => {
          if (isMCPTool) {
            try {
              const mcpResult = await config.mcpClient!.callToolByName(
                scheduledToolCall.toolName,
                scheduledToolCall.input,
              );
              return { content: mcpResult, isError: false };
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              return { content: `MCP tool error: ${msg}`, isError: true };
            }
          }

          if (useSandbox) {
            return activeSandboxBridge.runInSandbox(
              scheduledToolCall.input["command"] as string,
              (scheduledToolCall.input["timeout"] as number | undefined) ?? 120000,
            );
          }

          return executeTool(
            scheduledToolCall.toolName,
            scheduledToolCall.input,
            session.projectRoot,
            {
              sessionId: session.id,
              roundId: `round-${roundCounter}`,
              sandboxEnabled: false,
              selfImprovement: effectiveSelfImprovement ?? undefined,
              readTracker,
              editAttempts,
              subAgentExecutor: createSubAgentExecutor(
                session,
                config,
                {
                  durableRunId: durableRun.id,
                  workflowName,
                },
                runAgentLoopFn,
              ),
              // Pass sandboxBridge into context so toolBash() can route through it
              // even when the tool scheduler doesn't take the useSandbox fast path.
              sandboxBridge: activeSandboxBridge,
              executionIntegrity: ctx.executionIntegrity,
              messageId: ctx.messageId,
            },
          );
        },
      },
    );

    if (schedulerResult?.record) {
      await durableRunStore.persistToolCallRecords(durableRun.id, [schedulerResult.record]);
    }

    if (!schedulerResult || !schedulerResult.executed || !schedulerResult.result) {
      const blockedReason = schedulerResult?.blockedReason ?? "Execution did not start.";
      if (schedulerResult?.record.status === "awaiting_approval") {
        await durableRunStore.persistPendingToolCalls(
          durableRun.id,
          toolCalls.slice(Math.max(toolIndex - 1, 0)).map((pendingToolCall) => ({
            id: pendingToolCall.id,
            name: pendingToolCall.name,
            input: pendingToolCall.input,
            dependsOn: pendingToolCall.dependsOn,
          })),
        );

        const approvalNotice =
          `Execution paused for durable run ${durableRun.id} because ${toolCall.name} requires approval. ` +
          `${blockedReason} Type continue or /resume ${durableRun.id} after approving the action.`;

        evidenceLedger.push({
          id: randomUUID(),
          kind: "blocked_action",
          success: false,
          label: `${toolCall.name} requires approval`,
          timestamp: new Date().toISOString(),
          command:
            typeof toolCall.input["command"] === "string" ? toolCall.input["command"] : undefined,
          filePath:
            typeof toolCall.input["file_path"] === "string"
              ? toolCall.input["file_path"]
              : undefined,
          sourceUrl: typeof toolCall.input["url"] === "string" ? toolCall.input["url"] : undefined,
          details: {
            reason: blockedReason,
            toolName: toolCall.name,
            toolCallId: toolCall.id,
          },
        });

        await durableRunStore.pauseRun(durableRun.id, {
          reason: "user_input_required",
          session,
          touchedFiles,
          lastConfirmedStep,
          lastSuccessfulTool,
          nextAction: "Approve the requested action and then continue the durable run.",
          message: approvalNotice,
          evidence: evidenceLedger,
          executionPolicyState: ctx.executionPolicy.snapshot(),
        });

        session.messages.push({
          id: randomUUID(),
          role: "assistant",
          content: approvalNotice,
          timestamp: new Date().toISOString(),
        });

        if (localSandboxBridge) {
          await localSandboxBridge.shutdown();
        }

        return {
          action: "return" as const,
          toolResults,
          filesModified,
          testsRun,
          bashSucceeded,
          executedToolsThisTurn,
          toolCallsThisTurn,
          currentApproachToolCalls,
          lastConfirmedStep,
          lastSuccessfulTool,
          lastSuccessfulToolResult,
          lastMajorEditGatePassed,
          localSandboxBridge,
          roundWrittenFiles,
        };
      }
      if (!config.silent) {
        process.stdout.write(`\n${RED}[dtr] ${toolCall.name} blocked — ${blockedReason}${RESET}\n`);
      }
      toolResults.push(`SYSTEM: ${toolCall.name} is blocked — ${blockedReason}.`);
      continue;
    }

    const result = schedulerResult.result;

    // Tool output truncation (opencode pattern): cap large outputs to avoid
    // blowing the context window. Truncate to 2000 lines / 50KB.
    const MAX_OUTPUT_LINES = 2000;
    const MAX_OUTPUT_BYTES = 50 * 1024;
    let outputContent = result.content;
    const outputLines = outputContent.split("\n");
    if (outputLines.length > MAX_OUTPUT_LINES) {
      outputContent =
        outputLines.slice(0, MAX_OUTPUT_LINES).join("\n") +
        `\n\n... (truncated, ${outputLines.length} total lines)`;
    }
    if (outputContent.length > MAX_OUTPUT_BYTES) {
      outputContent =
        outputContent.slice(0, MAX_OUTPUT_BYTES) +
        `\n\n... (truncated, ${result.content.length} total bytes)`;
    }

    // Track ALL files written (config, JSON, etc.) for touchedFiles + filesModified
    const anyWrittenFile = getAllWrittenFilePath(toolCall.name, toolCall.input);
    if (anyWrittenFile && !result.isError) {
      const resolvedAny = resolve(session.projectRoot, anyWrittenFile);
      if (!touchedFiles.includes(resolvedAny)) {
        touchedFiles.push(resolvedAny);
      }
      filesModified++;
    }

    // Track code files only for DanteForge PDSE pipeline (roundWrittenFiles)
    const writtenFile = getWrittenFilePath(toolCall.name, toolCall.input);
    if (writtenFile && !result.isError) {
      const resolvedPath = resolve(session.projectRoot, writtenFile);
      roundWrittenFiles.push(resolvedPath);
    }

    // Progress tracking: count test runs and successful Bash commands
    if (toolCall.name === "Bash") {
      const cmd = (toolCall.input["command"] as string) || "";
      if (/\b(test|jest|vitest|mocha|pytest|cargo\s+test)\b/i.test(cmd)) {
        testsRun++;
      }
      if (!result.isError) {
        bashSucceeded++;
      }
    }

    const evidence = buildExecutionEvidence(
      toolCall.name,
      toolCall.input,
      result,
      writtenFile ?? undefined,
    );
    evidenceLedger.push(evidence);
    if (!result.isError) {
      lastSuccessfulTool = toolCall.name;
      lastSuccessfulToolResult = outputContent.split("\n")[0] || undefined;
      lastConfirmedStep = writtenFile
        ? `Updated ${writtenFile}`
        : `Executed ${toolCall.name}${lastSuccessfulToolResult ? `: ${lastSuccessfulToolResult}` : ""}`;
    }

    const retryOutcome = ctx.executionPolicy.recordToolResult(
      { name: toolCall.name, args: toolCall.input },
      { isError: result.isError, content: result.content },
    );

    // DTR Phase 2: Wrap raw result with structured evidence for verbose logging.
    const dtrResult = adaptToolResult(toolCall.name, toolCall.input, result, _toolStartMs);
    const evidenceSuffix = config.verbose ? formatEvidenceSummary(dtrResult) : "";

    // Show result summary (suppressed in silent mode)
    if (!config.silent) {
      if (result.isError) {
        process.stdout.write(`${RED}error${RESET}\n`);
        if (config.verbose) {
          process.stdout.write(`${DIM}${result.content.slice(0, 300)}${RESET}\n`);
        }
      } else {
        const preview = result.content.split("\n")[0] || "(success)";
        process.stdout.write(
          `${GREEN}ok${RESET} ${DIM}${preview.slice(0, 100)}${RESET}` +
            (evidenceSuffix ? ` ${DIM}${evidenceSuffix}${RESET}` : "") +
            "\n",
        );
      }
    }

    // Per-tool error tracking: prevent infinite retries of failing tools
    if (result.isError) {
      const errorCount = (ctx.toolErrorCounts.get(toolCall.name) ?? 0) + 1;
      ctx.toolErrorCounts.set(toolCall.name, errorCount);
      if (errorCount >= MAX_PER_TOOL_ERRORS) {
        toolResults.push(
          `SYSTEM: ${toolCall.name} has failed ${errorCount} times this session. Stop using this tool and try a different approach.`,
        );
        if (!config.silent) {
          process.stdout.write(
            `\n${RED}[tool-limit] ${toolCall.name} hit ${MAX_PER_TOOL_ERRORS} error limit${RESET}\n`,
          );
        }
      }
    } else {
      // Reset on success — the tool is working, transient issues resolved
      ctx.toolErrorCounts.delete(toolCall.name);
    }

    toolResults.push(`Tool "${toolCall.name}" result:\n${outputContent}`);

    if (retryOutcome?.type === "retry_warning") {
      toolResults.push(
        retryOutcome.followupPrompt ??
          `SYSTEM: Retry warning â€” ${toolCall.name} has failed repeatedly. Avoid repeating it unchanged.`,
      );
    }

    if (retryOutcome?.type === "retry_stuck") {
      if (!config.silent) {
        process.stdout.write(
          `\n${RED}${BOLD}[retry-stuck]${RESET} ${DIM}${retryOutcome.displayText}${RESET}\n`,
        );
      }
      toolResults.push(
        retryOutcome.followupPrompt ??
          `SYSTEM: Retry loop detected â€” ${toolCall.name} is stuck. Stop repeating it and choose a different approach.`,
      );
      break;
    }

    if (schedulerResult.verificationMessage) {
      if (!config.silent) {
        process.stdout.write(
          `\n${RED}${schedulerResult.verificationMessage.split("\n")[0]}${RESET}\n`,
        );
      }
      toolResults.push(schedulerResult.verificationMessage);
    }

    // Record the tool call in the session
    const toolUseMessage: SessionMessage = {
      id: randomUUID(),
      role: "assistant",
      content: `Using tool: ${toolCall.name}`,
      timestamp: new Date().toISOString(),
      toolUse: {
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      },
    };
    session.messages.push(toolUseMessage);

    const toolResultMessage: SessionMessage = {
      id: randomUUID(),
      role: "tool",
      content: result.content,
      timestamp: new Date().toISOString(),
      toolResult: {
        toolUseId: toolCall.id,
        content: result.content,
        isError: result.isError,
      },
    };
    session.messages.push(toolResultMessage);

    const backgroundTaskId =
      !result.isError && toolCall.name === "SubAgent" && toolCall.input["background"] === true
        ? extractBackgroundTaskId(result.content)
        : null;

    if (backgroundTaskId) {
      lastConfirmedStep = `Launched background task ${backgroundTaskId}`;
      await durableRunStore.persistPendingToolCalls(
        durableRun.id,
        toolCalls.slice(toolIndex).map((pendingToolCall) => ({
          id: pendingToolCall.id,
          name: pendingToolCall.name,
          input: pendingToolCall.input,
          dependsOn: pendingToolCall.dependsOn,
        })),
      );
      const waitingNotice = formatBackgroundWaitNotice(durableRun.id, backgroundTaskId);
      await durableRunStore.pauseRun(durableRun.id, {
        reason: "user_input_required",
        session,
        touchedFiles,
        lastConfirmedStep,
        lastSuccessfulTool,
        nextAction: getBackgroundResumeNextAction(backgroundTaskId),
        message: waitingNotice,
        evidence: evidenceLedger,
        executionPolicyState: ctx.executionPolicy.snapshot(),
      });

      session.messages.push({
        id: randomUUID(),
        role: "assistant",
        content: waitingNotice,
        timestamp: new Date().toISOString(),
      });

      if (localSandboxBridge) {
        await localSandboxBridge.shutdown();
      }

      return {
        action: "return" as const,
        toolResults,
        filesModified,
        testsRun,
        bashSucceeded,
        executedToolsThisTurn,
        toolCallsThisTurn,
        currentApproachToolCalls,
        lastConfirmedStep,
        lastSuccessfulTool,
        lastSuccessfulToolResult,
        lastMajorEditGatePassed,
        localSandboxBridge,
        roundWrittenFiles,
      };
    }

    // Progress tracking: emit a progress line every PROGRESS_EMIT_INTERVAL tool calls
    if (toolCallsThisTurn > 0 && toolCallsThisTurn % PROGRESS_EMIT_INTERVAL === 0) {
      const progressLine = `[progress: ${toolCallsThisTurn} tool calls | ${filesModified} files modified | ${testsRun} tests run]`;
      process.stdout.write(`\n${DIM}${progressLine}${RESET}\n`);
      // Also inject a progress marker into the session for visibility
      session.messages.push({
        id: randomUUID(),
        role: "system" as "user",
        content: progressLine,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Reflection checkpoint: inject chain-of-thought reasoning prompt at intervals
  if (
    executedToolsThisTurn > 0 &&
    executedToolsThisTurn % REFLECTION_CHECKPOINT_INTERVAL === 0 &&
    maxToolRounds > 0
  ) {
    toolResults.push(`SYSTEM: ${REFLECTION_PROMPT}`);
    if (!config.silent) {
      process.stdout.write(
        `\n${DIM}[reflection checkpoint at ${executedToolsThisTurn} tool calls]${RESET}\n`,
      );
    }
  }

  // Clear silent mode progress line after tool loop
  if (config.silent && toolCalls.length > 0) {
    process.stdout.write(`\r${DIM}[${toolCalls.length}/${toolCalls.length} tools done]${RESET}\n`);
  }

  if (isMajorEditBatch(roundWrittenFiles, session.projectRoot) && !roundMajorEditGateResult) {
    roundMajorEditGateResult = await runMajorEditBatchGate(
      session.id,
      session.projectRoot,
      roundCounter,
      config.selfImprovement,
      readTracker,
      editAttempts,
    );
    lastMajorEditGatePassed = roundMajorEditGateResult.passed;

    const summary = roundMajorEditGateResult.passed
      ? "SYSTEM: Repository-root verification passed for this major edit batch (typecheck, lint, test). Commits and merges may proceed."
      : `SYSTEM: Repository-root verification failed for this major edit batch (${roundMajorEditGateResult.failedSteps.join(", ")}). Do not commit or merge until those checks are green.`;
    toolResults.push(summary);

    if (!config.silent) {
      process.stdout.write(
        roundMajorEditGateResult.passed
          ? `\n${GREEN}[gstack: repo-root gate passed]${RESET}\n`
          : `\n${RED}[gstack: repo-root gate failed — ${roundMajorEditGateResult.failedSteps.join(", ")}]${RESET}\n`,
      );
    }
  }

  return {
    action: "proceed" as const,
    toolResults,
    filesModified,
    testsRun,
    bashSucceeded,
    executedToolsThisTurn,
    toolCallsThisTurn,
    currentApproachToolCalls,
    lastConfirmedStep,
    lastSuccessfulTool,
    lastSuccessfulToolResult,
    lastMajorEditGatePassed,
    localSandboxBridge,
    roundWrittenFiles,
  };
}

// Re-export for callers that import analyzeBashCommand from this module
export type { BashAnalysisResult } from "@dantecode/core";
