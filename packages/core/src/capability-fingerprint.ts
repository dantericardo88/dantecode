/**
 * capability-fingerprint.ts
 *
 * Model capability database and selection engine.
 * Stores and queries per-model capability profiles (context window, vision,
 * function-calling, cost, latency, strengths/weaknesses) and provides an
 * intelligent `findBestModel` selector that scores candidates against free-form
 * task descriptions via Jaccard-like keyword matching.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ModelCapabilities {
  modelId: string;
  provider: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  supportedLanguages: string[];
  averageLatencyMs: number;
  costPer1kInputTokens: number;
  costPer1kOutputTokens: number;
  maxOutputTokens: number;
  strengths: string[];
  weaknesses: string[];
  lastUpdated: string;
}

export interface ModelSelectionCriteria {
  task: string;
  requiresVision?: boolean;
  requiresFunctionCalling?: boolean;
  maxCostPer1kTokens?: number;
  maxLatencyMs?: number;
  minContextWindow?: number;
  preferredProviders?: string[];
}

export interface CapabilityFingerprintOptions {
  storageDir?: string;
  fsFn?: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
  };
}

// ─── Built-in Seed Data ───────────────────────────────────────────────────────

const BUILT_IN_FINGERPRINTS: ModelCapabilities[] = [
  {
    modelId: "claude-opus-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en", "fr", "de", "es", "zh", "ja", "ko", "pt"],
    averageLatencyMs: 3200,
    costPer1kInputTokens: 0.015,
    costPer1kOutputTokens: 0.075,
    maxOutputTokens: 8192,
    strengths: [
      "reasoning",
      "code",
      "analysis",
      "long-context",
      "instruction-following",
      "complex tasks",
      "nuanced writing",
    ],
    weaknesses: ["cost", "latency"],
    lastUpdated: "2026-03-01",
  },
  {
    modelId: "claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en", "fr", "de", "es", "zh", "ja", "ko", "pt"],
    averageLatencyMs: 1800,
    costPer1kInputTokens: 0.003,
    costPer1kOutputTokens: 0.015,
    maxOutputTokens: 8192,
    strengths: [
      "reasoning",
      "code",
      "balanced performance",
      "cost-effective",
      "analysis",
      "instruction-following",
    ],
    weaknesses: ["very complex reasoning vs opus"],
    lastUpdated: "2026-03-01",
  },
  {
    modelId: "claude-haiku-4-5",
    provider: "anthropic",
    contextWindow: 200_000,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en", "fr", "de", "es", "zh", "ja"],
    averageLatencyMs: 700,
    costPer1kInputTokens: 0.00025,
    costPer1kOutputTokens: 0.00125,
    maxOutputTokens: 4096,
    strengths: ["speed", "cost-effective", "simple tasks", "summarization", "classification"],
    weaknesses: ["complex reasoning", "long outputs"],
    lastUpdated: "2026-03-01",
  },
  {
    modelId: "gpt-4o",
    provider: "openai",
    contextWindow: 128_000,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en", "fr", "de", "es", "zh", "ja", "ko", "pt", "it"],
    averageLatencyMs: 2500,
    costPer1kInputTokens: 0.005,
    costPer1kOutputTokens: 0.015,
    maxOutputTokens: 4096,
    strengths: [
      "reasoning",
      "code",
      "vision",
      "multimodal",
      "function calling",
      "structured output",
    ],
    weaknesses: ["cost vs smaller models", "latency"],
    lastUpdated: "2026-03-01",
  },
  {
    modelId: "gpt-4o-mini",
    provider: "openai",
    contextWindow: 128_000,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en", "fr", "de", "es", "zh", "ja"],
    averageLatencyMs: 900,
    costPer1kInputTokens: 0.00015,
    costPer1kOutputTokens: 0.0006,
    maxOutputTokens: 4096,
    strengths: ["cost-effective", "speed", "simple tasks", "classification", "extraction"],
    weaknesses: ["complex reasoning", "large context performance"],
    lastUpdated: "2026-03-01",
  },
  {
    modelId: "gemini-1.5-pro",
    provider: "google",
    contextWindow: 1_000_000,
    supportsVision: true,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en", "fr", "de", "es", "zh", "ja", "ko", "pt", "it", "ar"],
    averageLatencyMs: 2800,
    costPer1kInputTokens: 0.0035,
    costPer1kOutputTokens: 0.0105,
    maxOutputTokens: 8192,
    strengths: [
      "very long context",
      "multimodal",
      "video understanding",
      "code",
      "document analysis",
    ],
    weaknesses: ["consistency", "instruction-following"],
    lastUpdated: "2026-03-01",
  },
  {
    modelId: "llama-3.1-70b",
    provider: "meta",
    contextWindow: 128_000,
    supportsVision: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en", "fr", "de", "es", "zh", "pt", "it"],
    averageLatencyMs: 1500,
    costPer1kInputTokens: 0.0009,
    costPer1kOutputTokens: 0.0009,
    maxOutputTokens: 4096,
    strengths: ["open-weight", "cost-effective", "code", "multilingual", "reasoning"],
    weaknesses: ["vision", "requires self-hosting or API provider"],
    lastUpdated: "2026-03-01",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Tokenise a string into a lower-case word set for Jaccard comparison.
 */
function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[\s,.\-_/]+/)
      .filter((t) => t.length > 2),
  );
}

/**
 * Jaccard similarity between two token sets: |A ∩ B| / |A ∪ B|.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── Main Class ───────────────────────────────────────────────────────────────

/**
 * `CapabilityFingerprint` manages a per-project JSON store of model capability
 * profiles, merging them with an opinionated set of built-in fingerprints for
 * the most popular models.
 *
 * @example
 * ```ts
 * const fp = new CapabilityFingerprint("/project");
 * await fp.load();
 * const best = fp.findBestModel({ task: "summarize long legal docs" });
 * ```
 */
export class CapabilityFingerprint {
  private readonly storageDir: string;
  private readonly storagePath: string;
  private capabilities: Map<string, ModelCapabilities> = new Map();

  /** Injected fs functions — defaults to real node:fs/promises. */
  private readonly fs: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
  };

  constructor(projectRoot: string, options: CapabilityFingerprintOptions = {}) {
    this.storageDir = options.storageDir ?? join(projectRoot, ".danteforge");
    this.storagePath = join(this.storageDir, "capability-fingerprints.json");
    this.fs = options.fsFn ?? { readFile, writeFile, mkdir };

    // Seed with built-ins immediately so the instance is usable before load().
    for (const cap of BUILT_IN_FINGERPRINTS) {
      this.capabilities.set(cap.modelId, { ...cap });
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  /**
   * Load persisted fingerprints from disk, merging them on top of built-ins.
   * Safe to call multiple times (idempotent: subsequent calls re-merge).
   * ENOENT is silently ignored — built-ins remain.
   */
  async load(): Promise<void> {
    try {
      const raw = await this.fs.readFile(this.storagePath, "utf-8");
      const parsed: ModelCapabilities[] = JSON.parse(raw as string);
      // Merge: persisted values override built-ins entry-by-entry.
      for (const cap of parsed) {
        this.capabilities.set(cap.modelId, cap);
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      // File not found — use built-ins only.
    }
  }

  /**
   * Persist the current capability map to disk as JSON.
   */
  async save(): Promise<void> {
    await this.fs.mkdir(this.storageDir, { recursive: true });
    const data = JSON.stringify([...this.capabilities.values()], null, 2);
    await this.fs.writeFile(this.storagePath, data, "utf-8");
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  /**
   * Return capability record for `modelId`, or `undefined` if unknown.
   */
  getCapability(modelId: string): ModelCapabilities | undefined {
    return this.capabilities.get(modelId);
  }

  /**
   * Find the best model that satisfies all hard constraints in `criteria`.
   *
   * Scoring (higher = better):
   *  1. Jaccard similarity between task keywords and model strengths (×3 weight)
   *  2. Cost efficiency: 1 / (avgCostPer1kTokens + ε)
   *  3. Latency efficiency: 1 / (avgLatencyMs / 1000 + ε)
   *
   * Preferred providers receive a +0.2 bonus.
   */
  findBestModel(criteria: ModelSelectionCriteria): ModelCapabilities | undefined {
    const taskTokens = tokenSet(criteria.task);

    const candidates = [...this.capabilities.values()].filter((m) => {
      if (criteria.requiresVision && !m.supportsVision) return false;
      if (criteria.requiresFunctionCalling && !m.supportsFunctionCalling) return false;
      if (
        criteria.maxCostPer1kTokens !== undefined &&
        (m.costPer1kInputTokens + m.costPer1kOutputTokens) / 2 > criteria.maxCostPer1kTokens
      )
        return false;
      if (criteria.maxLatencyMs !== undefined && m.averageLatencyMs > criteria.maxLatencyMs)
        return false;
      if (criteria.minContextWindow !== undefined && m.contextWindow < criteria.minContextWindow)
        return false;
      return true;
    });

    if (candidates.length === 0) return undefined;

    const scored = candidates.map((m) => {
      const strengthTokens = tokenSet(m.strengths.join(" "));
      const taskScore = jaccard(taskTokens, strengthTokens);

      const avgCost = (m.costPer1kInputTokens + m.costPer1kOutputTokens) / 2;
      const costScore = 1 / (avgCost + 1e-6);
      const latencyScore = 1 / (m.averageLatencyMs / 1000 + 1e-3);

      const providerBonus = criteria.preferredProviders?.includes(m.provider) ? 0.2 : 0;

      const total = taskScore * 3 + costScore * 0.0001 + latencyScore * 0.01 + providerBonus;

      return { model: m, score: total };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.model;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  /**
   * Apply partial updates to an existing capability entry and persist.
   */
  async updateCapability(modelId: string, updates: Partial<ModelCapabilities>): Promise<void> {
    const existing = this.capabilities.get(modelId);
    if (!existing) {
      throw new Error(`Unknown modelId: ${modelId}`);
    }
    this.capabilities.set(modelId, {
      ...existing,
      ...updates,
      modelId, // prevent accidental modelId change
    });
    await this.save();
  }

  /**
   * Add a new fingerprint (or overwrite an existing one) and persist.
   */
  async addFingerprint(cap: ModelCapabilities): Promise<void> {
    this.capabilities.set(cap.modelId, { ...cap });
    await this.save();
  }

  // ── Listing ───────────────────────────────────────────────────────────────

  /**
   * List all known models, optionally filtered by `provider`.
   */
  listModels(provider?: string): ModelCapabilities[] {
    const all = [...this.capabilities.values()];
    return provider ? all.filter((m) => m.provider === provider) : all;
  }

  /**
   * Return sorted unique provider names across all registered models.
   */
  getProviders(): string[] {
    return [...new Set([...this.capabilities.values()].map((m) => m.provider))].sort();
  }

  // ── Cost Estimation ───────────────────────────────────────────────────────

  /**
   * Estimate the dollar cost of a call to `modelId` given token counts.
   * Returns 0 if the model is not registered.
   *
   * @param inputTokens  Number of prompt tokens
   * @param outputTokens Number of completion tokens
   */
  estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
    const m = this.capabilities.get(modelId);
    if (!m) return 0;
    return (
      (inputTokens / 1000) * m.costPer1kInputTokens +
      (outputTokens / 1000) * m.costPer1kOutputTokens
    );
  }
}
