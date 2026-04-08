// ============================================================================
// @dantecode/core — HealingAgent
//
// Minimal single-purpose LLM driver for autonomous code repair.
// Called by SelfHealingLoop as the fixFn — receives a stage + repair prompt,
// calls the LLM with streaming tool support, executes returned code edits,
// and returns so SelfHealingLoop can re-verify automatically.
//
// Design origin:
//   - Aider: single LLM call per repair cycle, error output injected verbatim
//   - SWE-agent: observation IS the next prompt context
//   - OpenHands CodeActAgent: typed function calls → deque of actions → re-invoke
//
// The HealingAgent does NOT re-verify — that is SelfHealingLoop's job.
// It just: build prompt → stream LLM → execute tool calls → return.
// ============================================================================

import type { CoreMessage, CoreTool, StreamTextResult, ToolResultPart } from "ai";
import type { ModelRouterImpl } from "./model-router.js";
import type { VerificationStage } from "./verification-engine.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single tool call emitted by the LLM during a healing round. */
export interface HealingToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Injectable tool executor — implemented in the CLI layer to call executeTool().
 * Keeps @dantecode/core independent of @dantecode/cli.
 */
export type HealingToolExecutor = (
  calls: HealingToolCall[],
) => Promise<HealingExecutionResult>;

/** Result returned by the HealingToolExecutor after executing a batch of tool calls. */
export interface HealingExecutionResult {
  /** Number of files that were modified (Read/Glob/Grep don't count). */
  filesModified: number;
  /** Per-call output or error strings (parallel to calls array). */
  outputs: string[];
  /** Human-readable summary. */
  summary: string;
}

/** Options for HealingAgent. */
export interface HealingAgentOptions {
  /** Max tokens to generate per LLM call. Default: 4096. */
  maxTokens?: number;
  /** Max LLM rounds (each round = one streamWithTools call). Default: 2. */
  maxLlmRounds?: number;
  /** Write text deltas to stdout. Default: true. */
  streamOutput?: boolean;
  /** Override the system prompt entirely. */
  systemPromptOverride?: string;
}

/** Result returned after a full HealingAgent run. */
export interface HealingRunResult {
  /** Total tool calls executed across all rounds. */
  toolCallCount: number;
  /** Total files modified. */
  filesModified: number;
  /** Number of LLM rounds used. */
  llmRounds: number;
  /** Human-readable summary. */
  summary: string;
  /** True if the LLM emitted no tool calls in the first round — nothing to fix. */
  aborted: boolean;
}

// ----------------------------------------------------------------------------
// Tool name allow-list
// ----------------------------------------------------------------------------

/**
 * Only expose the tools a repair agent needs.
 * No SubAgent, no GitCommit, no destructive ops.
 */
export const HEALING_TOOL_NAMES = new Set<string>([
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Glob",
  "Grep",
]);

/**
 * Filter an all-tools map down to the healing-safe subset.
 */
export function getHealingTools<T extends Record<string, CoreTool>>(
  allTools: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(allTools).filter(([name]) => HEALING_TOOL_NAMES.has(name)),
  ) as Partial<T>;
}

// ----------------------------------------------------------------------------
// Stage guidance strings
// ----------------------------------------------------------------------------

const STAGE_GUIDANCE: Record<VerificationStage, string> = {
  typecheck:
    "Fix TypeScript type errors. Resolve types correctly — never add `any` casts unless the type is genuinely unknown.",
  lint: "Fix ESLint violations. Do not add eslint-disable comments — fix the root cause.",
  unit: "Fix failing unit tests. Align the implementation with the test expectations. Do not delete tests.",
  integration:
    "Fix integration test failures. Check API contracts and data flow between modules.",
  smoke:
    "Fix smoke test failures. The basic happy-path must work end-to-end.",
};

// ----------------------------------------------------------------------------
// HealingAgent
// ----------------------------------------------------------------------------

/**
 * HealingAgent
 *
 * Drives one repair cycle: prompt → LLM stream → tool calls → execute.
 * After run() returns, SelfHealingLoop re-verifies automatically.
 *
 * Usage:
 * ```ts
 * const agent = new HealingAgent(modelRouter, toolExecutor, { maxLlmRounds: 2 });
 * const result = await agent.run("typecheck", repairPrompt, 1, "src/foo.ts");
 * // SelfHealingLoop now re-runs the stage automatically
 * ```
 */
export class HealingAgent {
  private readonly maxTokens: number;
  private readonly maxLlmRounds: number;
  private readonly streamOutput: boolean;
  private readonly systemPromptOverride: string | undefined;

  constructor(
    private readonly modelRouter: ModelRouterImpl,
    private readonly toolExecutor: HealingToolExecutor,
    options: HealingAgentOptions = {},
  ) {
    this.maxTokens = options.maxTokens ?? 4096;
    this.maxLlmRounds = options.maxLlmRounds ?? 2;
    this.streamOutput = options.streamOutput !== false;
    this.systemPromptOverride = options.systemPromptOverride;
  }

  /**
   * Run one repair cycle for the given stage.
   *
   * Rounds:
   *   1. Build system + user messages.
   *   2. Call modelRouter.streamWithTools() — collect text + tool-call events.
   *   3. If tool calls: execute via toolExecutor, append tool results, continue.
   *   4. If no tool calls: stop (LLM is done or cannot find anything to fix).
   *
   * @param stage       - Which verification stage is failing.
   * @param repairPrompt - Targeted repair prompt from RepairStrategyEngine.
   * @param attempt     - Attempt number (1-based, for prompt context).
   * @param targetFile  - Primary file to repair (may be empty string).
   */
  async run(
    stage: VerificationStage,
    repairPrompt: string,
    attempt: number,
    targetFile: string,
  ): Promise<HealingRunResult> {
    const systemPrompt = this.systemPromptOverride ?? this.buildSystemPrompt(stage, targetFile);
    const userMessage = this.buildUserMessage(stage, repairPrompt, attempt, targetFile);

    const messages: CoreMessage[] = [{ role: "user", content: userMessage }];
    let totalToolCalls = 0;
    let totalFilesModified = 0;
    let llmRounds = 0;
    let firstRoundHadToolCalls = false;

    for (let round = 0; round < this.maxLlmRounds; round++) {
      llmRounds++;
      const toolCalls: HealingToolCall[] = [];
      let responseText = "";

      // Stream with tools — the router returns a StreamTextResult with fullStream
      let streamResult: StreamTextResult<Record<string, CoreTool>, never>;
      try {
        streamResult = await this.modelRouter.streamWithTools(
          messages,
          {} as Record<string, CoreTool>, // Tools injected by executor; schema not needed in core
          {
            system: systemPrompt,
            maxTokens: this.maxTokens,
            cacheSystemPrompt: true,
            taskType: "repair",
          },
        );
      } catch (err) {
        // If the model doesn't support tool calls, bail gracefully
        break;
      }

      for await (const part of streamResult.fullStream) {
        if (part.type === "text-delta") {
          responseText += part.textDelta;
          if (this.streamOutput) {
            process.stdout.write(part.textDelta);
          }
        } else if (part.type === "tool-call") {
          toolCalls.push({
            id: part.toolCallId,
            name: part.toolName,
            input: part.args as Record<string, unknown>,
          });
        }
      }

      // Track whether the first round produced any tool calls
      if (round === 0) {
        firstRoundHadToolCalls = toolCalls.length > 0;
      }

      // If the LLM produced no tool calls, it is done
      if (toolCalls.length === 0) break;

      // Execute all tool calls
      const execResult = await this.toolExecutor(toolCalls);
      totalToolCalls += toolCalls.length;
      totalFilesModified += execResult.filesModified;

      // Append assistant turn + tool results for multi-turn continuation
      messages.push({ role: "assistant", content: responseText || " " });

      // Build tool-result message (CoreToolMessage with role "tool")
      const toolResultContent: ToolResultPart[] = toolCalls.map((tc, i) => ({
        type: "tool-result" as const,
        toolCallId: tc.id,
        toolName: tc.name,
        result: execResult.outputs[i] ?? "ok",
      }));
      messages.push({ role: "tool", content: toolResultContent });
    }

    const summary =
      totalToolCalls === 0
        ? `No tool calls — LLM found nothing to repair (${llmRounds} round(s))`
        : `${totalToolCalls} tool call(s), ${totalFilesModified} file(s) modified in ${llmRounds} round(s)`;

    return {
      toolCallCount: totalToolCalls,
      filesModified: totalFilesModified,
      llmRounds,
      summary,
      aborted: !firstRoundHadToolCalls,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private buildSystemPrompt(stage: VerificationStage, targetFile: string): string {
    const guidance = STAGE_GUIDANCE[stage] ?? `Fix ${stage} failures.`;
    const fileContext = targetFile ? ` Your primary target file is: ${targetFile}.` : "";
    return [
      `You are a code repair specialist.${fileContext}`,
      guidance,
      `Available tools: Read (inspect files), Edit (apply targeted edits), Write (create/replace files), Bash (run verification commands), Glob (find files), Grep (search content).`,
      `Strategy: Read the failing file first to understand context, then apply the minimal edit that fixes each error.`,
      `Constraints: Do not add unnecessary changes. Fix exactly what is failing. Do not add eslint-disable comments. Do not cast to 'any' without a documented reason.`,
    ].join("\n");
  }

  private buildUserMessage(
    stage: VerificationStage,
    repairPrompt: string,
    attempt: number,
    targetFile: string,
  ): string {
    const parts: string[] = [
      `## Repair Request — ${stage} (attempt ${attempt})`,
    ];
    if (targetFile) {
      parts.push(`**Target file:** ${targetFile}`);
    }
    parts.push("", repairPrompt);
    return parts.join("\n");
  }
}
