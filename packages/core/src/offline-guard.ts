// packages/core/src/offline-guard.ts
// Offline mode detection and auto-routing to local Ollama.
//
// Closes dim 25 (offline mode) gap: when cloud providers fail or are
// unconfigured, DanteCode automatically falls back to locally-running
// Ollama models rather than surfacing API key errors.
//
// Tabby-inspired: Tabby is fully offline-first; this gives DanteCode
// graceful degradation when network is unavailable.

export interface OllamaModel {
  name: string;
  /** Model size in bytes */
  size?: number;
  /** ISO timestamp when model was last modified */
  modifiedAt?: string;
}

export interface OllamaHealthResult {
  running: boolean;
  baseUrl: string;
  models: OllamaModel[];
  /** Round-trip latency in ms (-1 if not running) */
  latencyMs: number;
  checkedAt: string;
}

export interface OfflineGuardOptions {
  /** Ollama base URL. Defaults to OLLAMA_HOST env or http://localhost:11434 */
  ollamaBaseUrl?: string;
  /** Cache TTL in ms. Defaults to 30_000 (30s) */
  cacheTtlMs?: number;
  /** Timeout for the health check request in ms. Defaults to 2_000 */
  timeoutMs?: number;
}

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_CACHE_TTL = 30_000;  // 30 seconds
const DEFAULT_TIMEOUT = 2_000;     // 2 seconds

// ─── Recommended offline models (ordered by capability) ──────────────────────

const RECOMMENDED_CODE_MODELS = [
  "qwen2.5-coder:7b",
  "qwen2.5-coder:3b",
  "codellama:7b",
  "codellama:13b",
  "deepseek-coder:6.7b",
  "mistral:7b",
  "llama3.2:3b",
];

const RECOMMENDED_CHAT_MODELS = [
  "llama3.1:8b",
  "llama3.2:3b",
  "mistral:7b",
  "qwen2.5:7b",
  "phi3.5:3.8b",
];

/**
 * Detects if Ollama is running locally and which models are available.
 * Result is cached to avoid hammering localhost on every request.
 */
export class OllamaHealthProbe {
  private _cache: OllamaHealthResult | null = null;
  private _cacheExpiry = 0;
  private readonly _baseUrl: string;
  private readonly _cacheTtlMs: number;
  private readonly _timeoutMs: number;

  constructor(options: OfflineGuardOptions = {}) {
    this._baseUrl = options.ollamaBaseUrl
      ?? process.env["OLLAMA_HOST"]
      ?? DEFAULT_OLLAMA_URL;
    this._cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL;
    this._timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  /** Check Ollama health, returning cached result if still fresh. */
  async check(): Promise<OllamaHealthResult> {
    if (this._cache && Date.now() < this._cacheExpiry) {
      return this._cache;
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this._timeoutMs);

      const response = await fetch(`${this._baseUrl}/api/tags`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return this._setCache({ running: false, baseUrl: this._baseUrl, models: [], latencyMs: -1, checkedAt: new Date().toISOString() });
      }

      const json = (await response.json()) as { models?: Array<{ name: string; size?: number; modified_at?: string }> };
      const models: OllamaModel[] = (json.models ?? []).map((m) => ({
        name: m.name,
        size: m.size,
        modifiedAt: m.modified_at,
      }));

      return this._setCache({ running: true, baseUrl: this._baseUrl, models, latencyMs, checkedAt: new Date().toISOString() });
    } catch {
      return this._setCache({ running: false, baseUrl: this._baseUrl, models: [], latencyMs: -1, checkedAt: new Date().toISOString() });
    }
  }

  /** Invalidate the cache (force a fresh check on next call). */
  invalidate(): void {
    this._cache = null;
    this._cacheExpiry = 0;
  }

  private _setCache(result: OllamaHealthResult): OllamaHealthResult {
    this._cache = result;
    this._cacheExpiry = Date.now() + this._cacheTtlMs;
    return result;
  }
}

// ─── Offline Guard ────────────────────────────────────────────────────────────

export type OfflineRouteReason =
  | "no_cloud_keys"         // No API keys configured at all
  | "all_providers_failed"  // Cloud providers returned errors
  | "explicit_offline"      // User set DANTECODE_OFFLINE=1
  | "network_unavailable";  // Detected network failure

export interface OfflineRoute {
  /** Always "ollama" */
  provider: "ollama";
  /** Best available local model for the task */
  modelId: string;
  /** Why we routed offline */
  reason: OfflineRouteReason;
  /** Ollama base URL to use */
  baseUrl: string;
  /** Whether Ollama is actually confirmed running */
  ollamaConfirmed: boolean;
}

export interface OfflineGuardState {
  /** True if DANTECODE_OFFLINE=1 or no cloud keys are configured */
  isOfflineMode: boolean;
  /** Last health check result */
  ollamaHealth: OllamaHealthResult | null;
}

/**
 * Guards against cloud provider failures by detecting offline conditions
 * and routing to the best available local Ollama model.
 */
export class OfflineGuard {
  private readonly _probe: OllamaHealthProbe;

  constructor(options: OfflineGuardOptions = {}) {
    this._probe = new OllamaHealthProbe(options);
  }

  /** Returns true if DanteCode should operate in offline mode. */
  isOfflineMode(): boolean {
    if (process.env["DANTECODE_OFFLINE"] === "1") return true;
    // Check if any cloud API key is configured
    const cloudKeys = [
      "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY",
      "GEMINI_API_KEY", "GROQ_API_KEY", "DEEPSEEK_API_KEY",
      "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "XAI_API_KEY",
    ];
    return !cloudKeys.some((k) => process.env[k]);
  }

  /**
   * Selects the best local model for a given task type.
   * Prefers models that are already pulled on this machine.
   */
  async selectLocalModel(taskType: "code" | "chat" = "code"): Promise<OfflineRoute> {
    const health = await this._probe.check();
    const reason: OfflineRouteReason = process.env["DANTECODE_OFFLINE"] === "1"
      ? "explicit_offline"
      : "no_cloud_keys";

    const preferred = taskType === "code" ? RECOMMENDED_CODE_MODELS : RECOMMENDED_CHAT_MODELS;
    const available = new Set(health.models.map((m) => m.name));

    // Pick first recommended model that is available locally
    const match = preferred.find((m) => available.has(m) || available.has(m.split(":")[0]!));
    // Fall back to first available model, or the top recommended if none pulled
    const modelId = match
      ?? health.models[0]?.name
      ?? preferred[0]!;

    return {
      provider: "ollama",
      modelId,
      reason,
      baseUrl: health.baseUrl,
      ollamaConfirmed: health.running,
    };
  }

  /**
   * Format an offline status message for display to the user.
   */
  async formatOfflineStatus(): Promise<string> {
    const health = await this._probe.check();
    if (!health.running) {
      return [
        "⚠  Offline mode: no cloud API keys configured and Ollama is not running.",
        "   To use local models: install Ollama (https://ollama.ai) and run `ollama serve`.",
        "   To use cloud models: set ANTHROPIC_API_KEY or another provider key.",
      ].join("\n");
    }

    const modelList = health.models.slice(0, 5).map((m) => `  • ${m.name}`).join("\n");
    const more = health.models.length > 5 ? `\n  … and ${health.models.length - 5} more` : "";
    return [
      `✓  Offline mode: using Ollama at ${health.baseUrl} (${health.latencyMs}ms)`,
      `   Available models:\n${modelList}${more}`,
    ].join("\n");
  }

  /**
   * Checks if a specific model is available locally.
   */
  async isModelAvailable(modelId: string): Promise<boolean> {
    const health = await this._probe.check();
    return health.running && health.models.some(
      (m) => m.name === modelId || m.name.startsWith(modelId.split(":")[0]!)
    );
  }

  get probe(): OllamaHealthProbe {
    return this._probe;
  }
}

/** Module-level singleton for use across the application. */
export const globalOfflineGuard = new OfflineGuard();
