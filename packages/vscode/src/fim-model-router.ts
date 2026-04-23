// ============================================================================
// packages/vscode/src/fim-model-router.ts
//
// FimModelRouter — singleton router cache + Ollama health probe.
//
// Solves two root causes of high FIM latency:
//  1. New ModelRouterImpl created per request → TCP reconnect overhead.
//     Fix: cache one router instance per (modelString, projectRoot) key.
//  2. No local model detection → users default to remote models (150-500ms TTFB).
//     Fix: background Ollama health probe; selectModel() returns local when healthy.
//
// OSS pattern: Tabby keep-alive + local model detection.
// ============================================================================

import { ModelRouterImpl, parseModelReference } from "@dantecode/core";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";

const DEFAULT_CONTEXT_WINDOW = 131_072;
const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 300;

export interface FimModelRouterProbeConfig {
  ollamaUrl: string;
  localModel: string;
  autoDetect: boolean;
  /** Optional draft model for speculative decoding (e.g. "qwen2.5-coder:0.5b") */
  draftModel?: string;
  /** Optional next-edit model for ML-based next-edit prediction */
  nextEditModel?: string;
}

export interface FimModelRouterSelectConfig {
  defaultModel: string;
  fimModel: string;
  autoDetect: boolean;
}

/**
 * Singleton router cache and Ollama health probe.
 *
 * Usage in extension.ts:
 *   const fimModelRouter = new FimModelRouter();
 *   fimModelRouter.startHealthProbe({ ollamaUrl, localModel, autoDetect });
 *   context.subscriptions.push(fimModelRouter);
 *
 * Usage in inline-completion.ts:
 *   const router = fimModelRouter.getRouter(modelString, projectRoot);
 *   // reuses existing connection instead of creating new one
 */
export class FimModelRouter {
  private readonly _routers = new Map<string, ModelRouterImpl>();
  private _localModelId: string | null = null;
  private _draftModelId: string | null = null;
  private _nextEditModelId: string | null = null;
  private _ollamaUrl: string | undefined;
  private _probeInterval: ReturnType<typeof setInterval> | null = null;
  private readonly _fetchFn: typeof globalThis.fetch;

  constructor(
    /** Injected for testability — defaults to globalThis.fetch */
    fetchFn?: typeof globalThis.fetch,
  ) {
    this._fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  // ── Router cache ─────────────────────────────────────────────────────────────

  /**
   * Returns a cached `ModelRouterImpl` for the given model string and project root.
   * Creates a new instance only on the first call for each (modelString, projectRoot) pair.
   * Subsequent calls reuse the same instance → TCP connection pooling.
   */
  getRouter(
    modelString: string,
    projectRoot: string,
    maxTokens = 512,
  ): ModelRouterImpl {
    const key = `${modelString}:${projectRoot}`;
    let router = this._routers.get(key);
    if (!router) {
      const parsed = parseModelReference(modelString);
      const modelConfig: ModelConfig = {
        provider: parsed.provider as ModelConfig["provider"],
        modelId: parsed.modelId,
        maxTokens,
        temperature: 0.1,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        supportsVision: false,
        supportsToolCalls: false,
      };
      const routerConfig: ModelRouterConfig = {
        default: modelConfig,
        fallback: [],
        overrides: {},
      };
      router = new ModelRouterImpl(routerConfig, projectRoot, "inline-completion");
      this._routers.set(key, router);
    }
    return router;
  }

  // ── Ollama health probe ───────────────────────────────────────────────────────

  /**
   * Probe an Ollama instance at `baseUrl/api/tags` for available models.
   *
   * If `pattern` is provided, returns the first model whose name includes it.
   * Otherwise, auto-detects: prefers any `*coder*` model, then falls back to
   * the first available model.
   *
   * Returns null if Ollama is unreachable, times out, or has no models.
   */
  async probeOllama(baseUrl: string, pattern?: string): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await this._fetchFn(`${baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models ?? [];
      if (models.length === 0) return null;

      if (pattern) {
        const found = models.find((m) => m.name.includes(pattern));
        return found?.name ?? null;
      }

      // Auto-detect: prefer *coder* models (Qwen2.5-Coder, CodeLlama, etc.)
      const coderModel = models.find((m) => m.name.toLowerCase().includes("coder"));
      return coderModel?.name ?? models[0]?.name ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Start a background health probe at 30-second intervals.
   * The first probe fires immediately (async, no-await).
   * Has no effect if `autoDetect` is false.
   */
  startHealthProbe(config: FimModelRouterProbeConfig): void {
    if (!config.autoDetect) return;
    if (this._probeInterval !== null) return; // already running

    this._ollamaUrl = config.ollamaUrl;

    const probe = async () => {
      const pattern = config.localModel.trim() || undefined;
      this._localModelId = await this.probeOllama(config.ollamaUrl, pattern);
      if (config.draftModel?.trim()) {
        this._draftModelId = await this.probeOllama(config.ollamaUrl, config.draftModel.trim());
      }
      if (config.nextEditModel?.trim()) {
        this._nextEditModelId = await this.probeOllama(config.ollamaUrl, config.nextEditModel.trim());
      }
    };

    void probe(); // immediate first probe
    this._probeInterval = setInterval(() => void probe(), PROBE_INTERVAL_MS);
  }

  /**
   * Select the best model for FIM right now.
   * Returns the local Ollama model when healthy, otherwise the configured FIM
   * model (or the default chat model as fallback).
   */
  selectModel(config: FimModelRouterSelectConfig): string {
    if (config.autoDetect && this._localModelId) {
      return `ollama/${this._localModelId}`;
    }
    return config.fimModel.trim() || config.defaultModel;
  }

  /** True when a local Ollama model has been detected and is healthy. */
  get hasLocalModel(): boolean {
    return this._localModelId !== null;
  }

  /** The detected local model ID (without provider prefix), or null. */
  get localModelId(): string | null {
    return this._localModelId;
  }

  /** The Ollama base URL, set during startHealthProbe. */
  get ollamaUrl(): string | undefined {
    return this._ollamaUrl;
  }

  /** Draft model ID for speculative decoding, or null if not probed. */
  get draftModelId(): string | null {
    return this._draftModelId;
  }

  /** Next-edit model ID for ML prediction, or null if not probed. */
  get nextEditModelId(): string | null {
    return this._nextEditModelId;
  }

  /** True when a draft model has been confirmed available (enables speculative decode). */
  get specDecodeAvailable(): boolean {
    return this._draftModelId !== null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  dispose(): void {
    if (this._probeInterval !== null) {
      clearInterval(this._probeInterval);
      this._probeInterval = null;
    }
    this._routers.clear();
    this._localModelId = null;
    this._draftModelId = null;
    this._nextEditModelId = null;
  }
}
