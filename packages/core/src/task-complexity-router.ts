// packages/core/src/task-complexity-router.ts
// Task-complexity-aware model selection — automatically routes to the
// cheapest model capable of handling the task's complexity level.
//
// Competitors like Cursor route all requests through expensive models.
// DanteCode routes intelligently: simple tasks → fast/cheap, complex → powerful.

import type { ModelProvider } from "@dantecode/config-types";

export type TaskComplexity = "trivial" | "simple" | "moderate" | "complex" | "reasoning";

export interface TaskSignals {
  /** Approximate token count of the prompt (prefix + context) */
  promptTokens: number;
  /** True if the task requires multi-step reasoning (plans, architecture) */
  requiresReasoning?: boolean;
  /** True if the task touches multiple files simultaneously */
  multiFile?: boolean;
  /** True if the task involves only FIM completion (not chat) */
  isFim?: boolean;
  /** True if the task needs external tool calls */
  requiresTools?: boolean;
  /** Explicit override from user config */
  forceComplexity?: TaskComplexity;
}

export interface RoutedModel {
  provider: ModelProvider;
  modelId: string;
  complexity: TaskComplexity;
  rationale: string;
}

/** Per-complexity model preferences, ordered by priority */
const COMPLEXITY_ROUTING_TABLE: Record<TaskComplexity, RoutedModel> = {
  trivial: {
    provider: "ollama",
    modelId: "qwen2.5-coder:7b",
    complexity: "trivial",
    rationale: "Single-line completion or trivial edit — local model, zero latency, zero cost",
  },
  simple: {
    provider: "mistral",
    modelId: "codestral-latest",
    complexity: "simple",
    rationale: "Short FIM or single-function edit — Codestral is best-in-class for code FIM at low cost",
  },
  moderate: {
    provider: "deepseek",
    modelId: "deepseek-chat",
    complexity: "moderate",
    rationale: "Multi-function change or chat — DeepSeek V3 is GPT-4-class at fraction of cost",
  },
  complex: {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    complexity: "complex",
    rationale: "Multi-file refactor or complex architecture — Claude Sonnet balances quality and cost",
  },
  reasoning: {
    provider: "anthropic",
    modelId: "claude-opus-4-6",
    complexity: "reasoning",
    rationale: "Deep reasoning, planning, or autonomous agent task — Claude Opus maximum quality",
  },
};

/** Fallback table when preferred provider API key is unavailable */
const FALLBACK_ROUTING_TABLE: Record<TaskComplexity, RoutedModel> = {
  trivial: { provider: "ollama", modelId: "qwen2.5-coder:7b", complexity: "trivial", rationale: "Fallback: local" },
  simple: { provider: "groq", modelId: "llama-3.3-70b-versatile", complexity: "simple", rationale: "Fallback: Groq fast" },
  moderate: { provider: "anthropic", modelId: "claude-haiku-4-5", complexity: "moderate", rationale: "Fallback: Haiku" },
  complex: { provider: "anthropic", modelId: "claude-sonnet-4-6", complexity: "complex", rationale: "Fallback: Sonnet" },
  reasoning: { provider: "anthropic", modelId: "claude-opus-4-6", complexity: "reasoning", rationale: "Fallback: Opus" },
};

/**
 * Classify task complexity from signals without calling the model.
 * O(1) — safe to call on every keystroke.
 */
export function classifyTaskComplexity(signals: TaskSignals): TaskComplexity {
  if (signals.forceComplexity) return signals.forceComplexity;

  if (signals.requiresReasoning) return "reasoning";
  if (signals.multiFile && signals.requiresTools) return "complex";
  if (signals.promptTokens > 8_000 || signals.multiFile) return "moderate";
  if (signals.isFim && signals.promptTokens < 500) return "trivial";
  if (signals.isFim && signals.promptTokens < 2_000) return "simple";
  if (signals.promptTokens > 4_000) return "moderate";

  return "simple";
}

/**
 * Route a task to the optimal model given complexity signals and available API keys.
 * Pass `availableProviders` as the set of providers with configured API keys.
 */
export function routeByComplexity(
  signals: TaskSignals,
  availableProviders: Set<ModelProvider>,
): RoutedModel {
  const complexity = classifyTaskComplexity(signals);
  const preferred = COMPLEXITY_ROUTING_TABLE[complexity];

  if (availableProviders.has(preferred.provider)) {
    return preferred;
  }

  // Try fallback
  const fallback = FALLBACK_ROUTING_TABLE[complexity];
  if (availableProviders.has(fallback.provider)) {
    return { ...fallback, rationale: `${fallback.rationale} (preferred unavailable)` };
  }

  // Last resort: any anthropic model (most likely to be configured)
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    complexity,
    rationale: "Last resort: Sonnet (no preferred provider available)",
  };
}

/**
 * Build the set of available providers from environment variables.
 * Ollama is assumed available — call detectAvailableProvidersAsync() for a real probe.
 */
export function detectAvailableProviders(): Set<ModelProvider> {
  const available = new Set<ModelProvider>();

  if (process.env["ANTHROPIC_API_KEY"]) available.add("anthropic");
  if (process.env["OPENAI_API_KEY"]) available.add("openai");
  if (process.env["XAI_API_KEY"] || process.env["GROK_API_KEY"]) available.add("grok");
  if (process.env["GOOGLE_API_KEY"] || process.env["GEMINI_API_KEY"]) available.add("google");
  if (process.env["GROQ_API_KEY"]) available.add("groq");
  if (process.env["DEEPSEEK_API_KEY"]) available.add("deepseek");
  if (process.env["MISTRAL_API_KEY"]) available.add("mistral");
  if (process.env["OPENROUTER_API_KEY"]) available.add("openrouter");
  // Ollama assumed available — probed asynchronously in detectAvailableProvidersAsync()
  available.add("ollama");

  return available;
}

/**
 * Probe the Ollama HTTP API to verify it is actually reachable.
 * Returns true if GET localhost:11434/api/tags responds within timeoutMs.
 */
export async function probeOllamaAvailability(
  baseUrl = "http://localhost:11434",
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}/api/tags`, { signal: ac.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Module-level cache — probed once per process lifetime. */
let _cachedProviders: Set<ModelProvider> | null = null;
let _probePromise: Promise<Set<ModelProvider>> | null = null;

/**
 * Detect available providers with real Ollama connectivity check.
 * Result is cached per process — subsequent calls return immediately.
 */
export async function detectAvailableProvidersAsync(
  ollamaUrl = "http://localhost:11434",
): Promise<Set<ModelProvider>> {
  if (_cachedProviders) return _cachedProviders;

  // Deduplicate concurrent callers
  if (_probePromise) return _probePromise;

  _probePromise = (async () => {
    const base = detectAvailableProviders();
    // Replace the assumed-available ollama with a real probe
    base.delete("ollama");
    const ollamaUp = await probeOllamaAvailability(ollamaUrl);
    if (ollamaUp) base.add("ollama");
    _cachedProviders = base;
    _probePromise = null;
    return base;
  })();

  return _probePromise;
}

/** Reset the provider cache (for testing). */
export function resetProviderCache(): void {
  _cachedProviders = null;
  _probePromise = null;
}
