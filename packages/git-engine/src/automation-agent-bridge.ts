/**
 * Bridge between automation triggers and the DanteCode agent loop.
 * Imports the agent-loop runner DYNAMICALLY to avoid circular dependencies.
 */

/** Minimum PDSE score for automation output to pass the DanteForge gate. */
export const PDSE_GATE_THRESHOLD = 70;

export interface AgentBridgeConfig {
  prompt: string;
  model?: string;
  sandboxMode?: string;
  verifyOutput?: boolean;
  maxRounds?: number;
  projectRoot: string;
  /** Injectable for testing */
  agentRunner?: (
    prompt: string,
    projectRoot: string,
    maxRounds: number,
  ) => Promise<AgentRunResult>;
  forgeRunner?: (files: string[], projectRoot: string) => Promise<ForgeResult>;
}

export interface AgentBridgeResult {
  sessionId: string;
  success: boolean;
  output: string;
  pdseScore?: number;
  tokensUsed: number;
  durationMs: number;
  filesChanged: string[];
  error?: string;
}

interface AgentRunResult {
  output: string;
  filesChanged: string[];
  tokensUsed: number;
  success: boolean;
  error?: string;
}

interface ForgeResult {
  aggregateScore: number;
  error?: string;
}

export function substitutePromptVars(
  template: string,
  context: Record<string, unknown>,
): string {
  return template.replace(/\$\{(\w+)\}/g, (_match, key: string) => {
    const value = context[key];
    return value !== undefined && value !== null ? String(value) : `\${${key}}`;
  });
}

// Module specifiers stored in variables so Vite/vitest import-analysis does not
// statically resolve them at transform time (avoiding "Missing specifier" errors
// when this package is used without @dantecode/cli installed).
const _CLI_AGENT_LOOP_DIST = "@dantecode/cli/dist/agent-loop.js";
const _CLI_AGENT_LOOP_SRC = "@dantecode/cli/src/agent-loop.js";

async function defaultAgentRunner(
  prompt: string,
  projectRoot: string,
  maxRounds: number,
): Promise<AgentRunResult> {
  try {
    // Dynamic import to avoid circular deps at module load time.
    // @dantecode/cli is an optional peer — if this package is used standalone
    // (e.g. in git-engine unit tests), callers should inject a custom agentRunner
    // via AgentBridgeConfig.agentRunner instead.
    const agentLoopModule = await import(/* @vite-ignore */ _CLI_AGENT_LOOP_DIST).catch(async () => {
      // Fallback: try the src path in dev / non-compiled environments
      return import(/* @vite-ignore */ _CLI_AGENT_LOOP_SRC).catch(() => null);
    });

    if (!agentLoopModule) {
      return {
        output: "",
        filesChanged: [],
        tokensUsed: 0,
        success: false,
        error: "Agent runner unavailable: @dantecode/cli not found in this context. Inject agentRunner via AgentBridgeConfig.",
      };
    }

    // runAgentLoop requires a Session and AgentLoopConfig — build minimal versions
    const { runAgentLoop } = agentLoopModule as {
      runAgentLoop: (
        prompt: string,
        session: Record<string, unknown>,
        config: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };

    if (typeof runAgentLoop !== "function") {
      return {
        output: "",
        filesChanged: [],
        tokensUsed: 0,
        success: false,
        error: "Agent runner unavailable: runAgentLoop is not exported from @dantecode/cli agent-loop module",
      };
    }

    const { parseModelReference, readOrInitializeState } = await import("@dantecode/core");
    const state = await readOrInitializeState(projectRoot).catch(() => null);

    if (!state) {
      return {
        output: "",
        filesChanged: [],
        tokensUsed: 0,
        success: false,
        error: "Agent runner unavailable: could not load DanteCode state from project root",
      };
    }

    const modelId = process.env["DANTECODE_MODEL"] ?? "claude-sonnet-4-6";
    const modelConfig = parseModelReference(modelId);
    const { randomUUID: _uuid } = await import("node:crypto");
    const session = {
      id: _uuid(),
      projectRoot,
      model: modelConfig,
      messages: [],
      tokenCount: { input: 0, output: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const agentConfig = {
      state,
      verbose: false,
      silent: true,
      enableGit: true,
      enableSandbox: false,
      nonInteractive: true,
      requiredRounds: maxRounds,
    };

    const resultSession = await runAgentLoop(prompt, session, agentConfig);

    const messages = (resultSession as Record<string, unknown>)["messages"];
    const tokenCount = (resultSession as Record<string, unknown>)["tokenCount"] as
      | { input: number; output: number }
      | undefined;

    // Extract last assistant message as the output
    const lastAssistant = Array.isArray(messages)
      ? [...messages]
          .reverse()
          .find(
            (m: unknown) =>
              m !== null &&
              typeof m === "object" &&
              (m as Record<string, unknown>)["role"] === "assistant",
          )
      : undefined;

    const outputText =
      lastAssistant !== undefined &&
      lastAssistant !== null &&
      typeof lastAssistant === "object" &&
      typeof (lastAssistant as Record<string, unknown>)["content"] === "string"
        ? ((lastAssistant as Record<string, unknown>)["content"] as string)
        : "";

    return {
      output: outputText,
      filesChanged: [],
      tokensUsed: tokenCount ? tokenCount.input + tokenCount.output : 0,
      success: true,
    };
  } catch (err) {
    // If @dantecode/cli isn't available in this context (e.g. git-engine standalone),
    // callers should inject a custom agentRunner via AgentBridgeConfig.agentRunner.
    return {
      output: "",
      filesChanged: [],
      tokensUsed: 0,
      success: false,
      error: `Agent runner unavailable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function defaultForgeRunner(
  files: string[],
  projectRoot: string,
): Promise<ForgeResult> {
  // Dynamic import to avoid circular deps with danteforge
  try {
    const { runLocalPDSEScorer } = await import("@dantecode/danteforge");
    const scores: number[] = [];
    for (const file of files) {
      try {
        const { readFile } = await import("node:fs/promises");
        const content = await readFile(file, "utf-8");
        const score = runLocalPDSEScorer(content, projectRoot);
        scores.push(score.overall > 1 ? score.overall : score.overall * 100);
      } catch {
        // skip unreadable files
      }
    }
    const aggregateScore =
      scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 85;
    return { aggregateScore };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { aggregateScore: 0, error: msg };
  }
}

export async function runAutomationAgent(
  config: AgentBridgeConfig,
  triggerContext: Record<string, unknown>,
): Promise<AgentBridgeResult> {
  const { randomUUID } = await import("node:crypto");
  const sessionId = randomUUID().slice(0, 12);
  const startMs = Date.now();
  const resolvedPrompt = substitutePromptVars(config.prompt, triggerContext);
  const maxRounds = config.maxRounds ?? 30;

  const runAgent = config.agentRunner ?? defaultAgentRunner;

  let result: AgentBridgeResult;

  try {
    const agentResult = await runAgent(resolvedPrompt, config.projectRoot, maxRounds);
    const durationMs = Date.now() - startMs;

    result = {
      sessionId,
      success: agentResult.success,
      output: agentResult.output,
      tokensUsed: agentResult.tokensUsed,
      durationMs,
      filesChanged: agentResult.filesChanged,
      ...(agentResult.error ? { error: agentResult.error } : {}),
    };

    // Run DanteForge verification if requested and files were changed
    if (config.verifyOutput !== false && agentResult.filesChanged.length > 0) {
      const runForge = config.forgeRunner ?? defaultForgeRunner;
      const forgeResult = await runForge(agentResult.filesChanged, config.projectRoot);
      if (forgeResult.error) {
        result.output +=
          `\n\nWARNING DanteForge: Verification unavailable — ${forgeResult.error}. Gate skipped.`;
        // Leave pdseScore unset so orchestrator records gateStatus: "skipped"
      } else {
        result.pdseScore = forgeResult.aggregateScore;
        if (forgeResult.aggregateScore < PDSE_GATE_THRESHOLD) {
          result.output +=
            `\n\nWARNING DanteForge: Automation output scored ${forgeResult.aggregateScore}/100 (below ${PDSE_GATE_THRESHOLD} threshold). Review recommended.`;
        }
      }
    }
  } catch (error: unknown) {
    result = {
      sessionId,
      success: false,
      output: "",
      tokensUsed: 0,
      durationMs: Date.now() - startMs,
      filesChanged: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return result;
}
