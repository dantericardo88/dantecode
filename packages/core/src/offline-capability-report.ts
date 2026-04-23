// packages/core/src/offline-capability-report.ts
// Sprint CD — Dim 26: Offline capability report for Ollama model inventory.

import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface OllamaModelInfo {
  modelId: string;
  supportsChat: boolean;
  supportsFIM: boolean;          // fill-in-middle completion
  contextWindowTokens: number;
  latencyEstimateMs: number;     // rough estimate based on model size
  qualityTier: "high" | "medium" | "low";
}

export interface OfflineCapabilityReport {
  ollamaAvailable: boolean;
  ollamaModels: OllamaModelInfo[];
  recommendedChatModel?: string;      // modelId best for chat
  recommendedFIMModel?: string;       // modelId best for FIM
  offlineReadinessScore: number;      // 0-1: 0 if no Ollama, higher with more capable models
  capabilities: {
    canDoChat: boolean;
    canDoFIM: boolean;
    canDoEmbeddings: boolean;
    estimatedThroughput: "fast" | "medium" | "slow";
  };
  generatedAt: string;
}

// Known FIM-capable model ID fragments
const FIM_CAPABLE_MODELS = ["deepseek-coder", "starcoder", "codellama", "qwen", "codegemma", "granite-code"];

const QUALITY_TIER_ORDER: Record<OllamaModelInfo["qualityTier"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function classifyOllamaModel(modelId: string): OllamaModelInfo {
  const lower = modelId.toLowerCase();

  const supportsChat = true;

  const supportsFIM = FIM_CAPABLE_MODELS.some((fragment) => lower.includes(fragment));

  // Context window: based on model size
  let contextWindowTokens: number;
  if (/70b/.test(lower) || /13b/.test(lower)) {
    contextWindowTokens = 32768;
  } else if (/7b|8b/.test(lower)) {
    contextWindowTokens = 8192;
  } else {
    contextWindowTokens = 4096;
  }

  // Latency estimate
  let latencyEstimateMs: number;
  if (/nano|small|1b/.test(lower)) {
    latencyEstimateMs = 200;
  } else if (/7b|8b/.test(lower)) {
    latencyEstimateMs = 500;
  } else if (/13b|70b/.test(lower)) {
    latencyEstimateMs = 1500;
  } else {
    latencyEstimateMs = 500;
  }

  // Quality tier
  let qualityTier: "high" | "medium" | "low";
  if (/70b/.test(lower)) {
    qualityTier = "high";
  } else if (/13b|8b|7b/.test(lower)) {
    qualityTier = "medium";
  } else {
    qualityTier = "low";
  }

  return {
    modelId,
    supportsChat,
    supportsFIM,
    contextWindowTokens,
    latencyEstimateMs,
    qualityTier,
  };
}

export function buildOfflineCapabilityReport(
  ollamaAvailable: boolean,
  availableModels: string[],
): OfflineCapabilityReport {
  if (!ollamaAvailable) {
    return {
      ollamaAvailable: false,
      ollamaModels: [],
      offlineReadinessScore: 0,
      capabilities: {
        canDoChat: false,
        canDoFIM: false,
        canDoEmbeddings: false,
        estimatedThroughput: "slow",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  const ollamaModels = availableModels.map(classifyOllamaModel);

  // Recommend best chat model (highest quality tier)
  const chatModels = ollamaModels.filter((m) => m.supportsChat);
  const bestChatModel = chatModels.sort(
    (a, b) => QUALITY_TIER_ORDER[b.qualityTier] - QUALITY_TIER_ORDER[a.qualityTier],
  )[0];
  const recommendedChatModel = bestChatModel?.modelId;

  // Recommend best FIM model (highest quality tier among FIM-capable)
  const fimModels = ollamaModels.filter((m) => m.supportsFIM);
  const bestFIMModel = fimModels.sort(
    (a, b) => QUALITY_TIER_ORDER[b.qualityTier] - QUALITY_TIER_ORDER[a.qualityTier],
  )[0];
  const recommendedFIMModel = bestFIMModel?.modelId;

  // Quality bonus based on best available model tier
  const topTier = bestChatModel?.qualityTier ?? "low";
  const qualityBonus = topTier === "high" ? 1.2 : topTier === "medium" ? 1.0 : 0.8;
  const n = ollamaModels.length;
  const offlineReadinessScore = Math.min(1.0, (n / (n + 2)) * qualityBonus);

  const canDoChat = ollamaModels.some((m) => m.supportsChat);
  const canDoFIM = ollamaModels.some((m) => m.supportsFIM);
  const canDoEmbeddings = availableModels.some((id) => {
    const lower = id.toLowerCase();
    return lower.includes("embed") || lower.includes("nomic") || lower.includes("mxbai");
  });

  // Throughput based on fastest model available
  const fastestLatency = Math.min(...ollamaModels.map((m) => m.latencyEstimateMs));
  let estimatedThroughput: "fast" | "medium" | "slow";
  if (fastestLatency <= 200) estimatedThroughput = "fast";
  else if (fastestLatency <= 500) estimatedThroughput = "medium";
  else estimatedThroughput = "slow";

  return {
    ollamaAvailable: true,
    ollamaModels,
    recommendedChatModel,
    recommendedFIMModel,
    offlineReadinessScore,
    capabilities: {
      canDoChat,
      canDoFIM,
      canDoEmbeddings,
      estimatedThroughput,
    },
    generatedAt: new Date().toISOString(),
  };
}

const OFFLINE_REPORT_PATH = ".danteforge/offline-capability-report.json";

export function recordOfflineCapabilityReport(report: OfflineCapabilityReport, projectRoot?: string): void {
  const root = projectRoot ?? process.cwd();
  const dir = join(root, ".danteforge");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(root, OFFLINE_REPORT_PATH);
  appendFileSync(filePath, JSON.stringify(report) + "\n", "utf8");
}

export function loadOfflineCapabilityReports(projectRoot?: string): OfflineCapabilityReport[] {
  const root = projectRoot ?? process.cwd();
  const filePath = join(root, OFFLINE_REPORT_PATH);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as OfflineCapabilityReport);
}
