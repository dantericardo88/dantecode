/**
 * model-capabilities.ts — DTR Phase 5: Model Capability Registry
 *
 * Unified registry of per-provider, per-model capabilities.
 * Solves the problem where Ollama/vLLM/LM Studio need separate code paths:
 * instead, callers query the registry and get correct behavior automatically.
 *
 * Design: static defaults + runtime override (from STATE.yaml or env vars).
 */

// ─── Capability Profile ───────────────────────────────────────────────────────

export type ProviderKind = 'cloud' | 'local';

export interface ModelCapabilityProfile {
  /** Provider identifier (matches PROVIDER_BUILDERS key) */
  readonly provider: string;
  /** Whether the model is local (Ollama, vLLM, LM Studio) or cloud (Anthropic, OpenAI, Grok) */
  readonly kind: ProviderKind;
  /** Model ID pattern — matched against the actual modelId (prefix or exact) */
  readonly modelIdPattern: string | RegExp;
  /** Whether the model supports native tool/function calling */
  readonly supportsToolCalls: boolean;
  /** Whether the model supports streaming (SSE) */
  readonly supportsStreaming: boolean;
  /** Whether the model is safe to use as the autonomous planner in /autoforge and /party */
  readonly safeForPlanner: boolean;
  /** Maximum context window in tokens (null = unknown) */
  readonly contextWindowTokens: number | null;
  /** Per-request timeout in ms (default: 120_000) */
  readonly timeoutMs: number;
  /** Retry profile for transient failures */
  readonly retryProfile: RetryProfile;
  /** Base URL for local providers (optional — falls back to env vars) */
  readonly defaultBaseUrl?: string;
  /** Human-readable notes */
  readonly notes?: string;
}

export interface RetryProfile {
  /** Maximum retry attempts for transient errors */
  maxRetries: number;
  /** Initial backoff in ms (doubles each retry) */
  initialBackoffMs: number;
  /** Maximum backoff cap in ms */
  maxBackoffMs: number;
}

// ─── Static Registry ──────────────────────────────────────────────────────────

const DEFAULT_RETRY: RetryProfile = {
  maxRetries: 3,
  initialBackoffMs: 500,
  maxBackoffMs: 30_000,
};

const LOCAL_RETRY: RetryProfile = {
  maxRetries: 2,
  initialBackoffMs: 200,
  maxBackoffMs: 5_000,
};

/**
 * Built-in capability profiles. More specific patterns should appear before
 * broader ones (registry searches top-to-bottom, returns first match).
 */
export const BUILTIN_CAPABILITY_PROFILES: ModelCapabilityProfile[] = [
  // ── Anthropic ────────────────────────────────────────────────────────────
  {
    provider: 'anthropic',
    kind: 'cloud',
    modelIdPattern: /^claude-/,
    supportsToolCalls: true,
    supportsStreaming: true,
    safeForPlanner: true,
    contextWindowTokens: 200_000,
    timeoutMs: 120_000,
    retryProfile: DEFAULT_RETRY,
    notes: 'Claude family — native tool use, 200K context',
  },

  // ── Grok (xAI) ───────────────────────────────────────────────────────────
  {
    provider: 'grok',
    kind: 'cloud',
    modelIdPattern: /^grok-/,
    supportsToolCalls: true,
    supportsStreaming: true,
    safeForPlanner: true,
    contextWindowTokens: 131_072,
    timeoutMs: 120_000,
    retryProfile: DEFAULT_RETRY,
    notes: 'Grok family — tool calling supported, may confabulate (use anti-confab guards)',
  },

  // ── OpenAI ────────────────────────────────────────────────────────────────
  {
    provider: 'openai',
    kind: 'cloud',
    modelIdPattern: /^gpt-4/,
    supportsToolCalls: true,
    supportsStreaming: true,
    safeForPlanner: true,
    contextWindowTokens: 128_000,
    timeoutMs: 120_000,
    retryProfile: DEFAULT_RETRY,
  },
  {
    provider: 'openai',
    kind: 'cloud',
    modelIdPattern: /^gpt-3\.5/,
    supportsToolCalls: true,
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: 16_385,
    timeoutMs: 60_000,
    retryProfile: DEFAULT_RETRY,
    notes: 'GPT-3.5 — tool calling supported, not recommended for planning',
  },
  {
    provider: 'openai',
    kind: 'cloud',
    modelIdPattern: /^o[13]-/,
    supportsToolCalls: true,
    supportsStreaming: false,
    safeForPlanner: true,
    contextWindowTokens: 200_000,
    timeoutMs: 300_000, // reasoning models can take longer
    retryProfile: DEFAULT_RETRY,
    notes: 'OpenAI reasoning models (o1, o3) — no streaming, extended reasoning',
  },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  {
    provider: 'google',
    kind: 'cloud',
    modelIdPattern: /^gemini-/,
    supportsToolCalls: true,
    supportsStreaming: true,
    safeForPlanner: true,
    contextWindowTokens: 1_000_000,
    timeoutMs: 120_000,
    retryProfile: DEFAULT_RETRY,
    notes: 'Gemini family — very large context window',
  },

  // ── Groq ─────────────────────────────────────────────────────────────────
  {
    provider: 'groq',
    kind: 'cloud',
    modelIdPattern: /^llama/,
    supportsToolCalls: true,
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: 8_192,
    timeoutMs: 30_000,
    retryProfile: { maxRetries: 2, initialBackoffMs: 200, maxBackoffMs: 5_000 },
    notes: 'Groq-hosted Llama — fast inference, small context, not for planning',
  },
  {
    provider: 'groq',
    kind: 'cloud',
    modelIdPattern: /.*/,
    supportsToolCalls: false,
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: 8_192,
    timeoutMs: 30_000,
    retryProfile: { maxRetries: 2, initialBackoffMs: 200, maxBackoffMs: 5_000 },
    notes: 'Groq default — no tool calling guarantee',
  },

  // ── Ollama (local) ────────────────────────────────────────────────────────
  {
    provider: 'ollama',
    kind: 'local',
    modelIdPattern: /^llama3/,
    supportsToolCalls: true, // llama3.1+ supports tool calling via Ollama
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: 128_000,
    timeoutMs: 300_000, // local inference can be slow
    retryProfile: LOCAL_RETRY,
    defaultBaseUrl: 'http://localhost:11434/v1',
    notes: 'Llama 3.1+ via Ollama — tool calling supported',
  },
  {
    provider: 'ollama',
    kind: 'local',
    modelIdPattern: /^qwen/,
    supportsToolCalls: true,
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: 32_768,
    timeoutMs: 300_000,
    retryProfile: LOCAL_RETRY,
    defaultBaseUrl: 'http://localhost:11434/v1',
    notes: 'Qwen via Ollama — tool calling supported',
  },
  {
    provider: 'ollama',
    kind: 'local',
    modelIdPattern: /.*/,
    supportsToolCalls: false, // conservative fallback for unknown Ollama models
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: null,
    timeoutMs: 300_000,
    retryProfile: LOCAL_RETRY,
    defaultBaseUrl: 'http://localhost:11434/v1',
    notes: 'Ollama fallback — assume no tool calling, use XML extraction',
  },

  // ── vLLM (local, OpenAI-compatible) ──────────────────────────────────────
  {
    provider: 'custom',
    kind: 'local',
    modelIdPattern: /vllm/i,
    supportsToolCalls: false, // depends on model; conservative default
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: null,
    timeoutMs: 300_000,
    retryProfile: LOCAL_RETRY,
    defaultBaseUrl: 'http://localhost:8000/v1',
    notes: 'vLLM — check model-specific tool support; use XML fallback',
  },

  // ── LM Studio (local, OpenAI-compatible) ─────────────────────────────────
  {
    provider: 'custom',
    kind: 'local',
    modelIdPattern: /lm.?studio/i,
    supportsToolCalls: false,
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: null,
    timeoutMs: 300_000,
    retryProfile: LOCAL_RETRY,
    defaultBaseUrl: 'http://localhost:1234/v1',
    notes: 'LM Studio — OpenAI-compatible; tool support depends on loaded model',
  },

  // ── Generic custom (OpenAI-compatible) ────────────────────────────────────
  {
    provider: 'custom',
    kind: 'cloud',
    modelIdPattern: /.*/,
    supportsToolCalls: false,
    supportsStreaming: true,
    safeForPlanner: false,
    contextWindowTokens: null,
    timeoutMs: 120_000,
    retryProfile: DEFAULT_RETRY,
    notes: 'Unknown custom provider — conservative defaults',
  },
];

// ─── Registry Class ───────────────────────────────────────────────────────────

export class ModelCapabilityRegistry {
  private readonly _profiles: ModelCapabilityProfile[];

  constructor(extraProfiles: ModelCapabilityProfile[] = []) {
    // Extra profiles take priority (placed before builtins)
    this._profiles = [...extraProfiles, ...BUILTIN_CAPABILITY_PROFILES];
  }

  /**
   * Look up capabilities for a given provider + modelId.
   * Returns the first matching profile, or a safe-fallback if none match.
   */
  lookup(provider: string, modelId: string): ModelCapabilityProfile {
    for (const profile of this._profiles) {
      if (profile.provider !== provider) continue;
      const pattern = profile.modelIdPattern;
      const matches =
        pattern instanceof RegExp ? pattern.test(modelId) : modelId.startsWith(pattern);
      if (matches) return profile;
    }
    return this._fallbackProfile(provider, modelId);
  }

  /** Whether the given model supports native tool calls */
  supportsToolCalls(provider: string, modelId: string): boolean {
    return this.lookup(provider, modelId).supportsToolCalls;
  }

  /** Whether the given model supports streaming */
  supportsStreaming(provider: string, modelId: string): boolean {
    return this.lookup(provider, modelId).supportsStreaming;
  }

  /** Whether the given model is safe to use as the autonomous planner */
  safeForPlanner(provider: string, modelId: string): boolean {
    return this.lookup(provider, modelId).safeForPlanner;
  }

  /** Is this a local (on-device) provider? */
  isLocal(provider: string, modelId: string): boolean {
    return this.lookup(provider, modelId).kind === 'local';
  }

  /** Get the per-request timeout for this model */
  timeoutMs(provider: string, modelId: string): number {
    return this.lookup(provider, modelId).timeoutMs;
  }

  /** Get the retry profile for this model */
  retryProfile(provider: string, modelId: string): RetryProfile {
    return this.lookup(provider, modelId).retryProfile;
  }

  /**
   * Register a custom profile at runtime (e.g., from STATE.yaml overrides).
   * Custom profiles take priority over builtins.
   */
  register(profile: ModelCapabilityProfile): void {
    this._profiles.unshift(profile);
  }

  /** All registered profiles (read-only snapshot) */
  allProfiles(): readonly ModelCapabilityProfile[] {
    return this._profiles;
  }

  private _fallbackProfile(provider: string, _modelId: string): ModelCapabilityProfile {
    return {
      provider,
      kind: 'cloud',
      modelIdPattern: /.*/,
      supportsToolCalls: false,
      supportsStreaming: true,
      safeForPlanner: false,
      contextWindowTokens: null,
      timeoutMs: 120_000,
      retryProfile: DEFAULT_RETRY,
      notes: `Auto-fallback for unknown provider "${provider}" — conservative defaults`,
    };
  }
}

/** Module-level singleton */
export const globalModelRegistry = new ModelCapabilityRegistry();
