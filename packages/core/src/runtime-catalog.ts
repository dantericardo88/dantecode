import type { ModelProvider } from "@dantecode/config-types";

export type ProviderSupportTier = "tier1" | "advanced";
export type SurfaceReleaseRing = "ga" | "preview" | "experimental";

export interface ProviderCatalogEntry {
  id: ModelProvider;
  label: string;
  shortLabel: string;
  envVars: string[];
  docsUrl?: string;
  requiresApiKey: boolean;
  supportTier: ProviderSupportTier;
  localOnly: boolean;
}

export interface ModelCatalogEntry {
  id: string;
  provider: ModelProvider;
  modelId: string;
  label: string;
  groupLabel: string;
  supportTier: ProviderSupportTier;
  defaultSelected?: boolean;
}

export interface SurfaceReleaseEntry {
  id: "cli" | "vscode" | "desktop";
  label: string;
  releaseRing: SurfaceReleaseRing;
  role: "primary" | "secondary";
  shipTarget: boolean;
}

export const DEFAULT_MODEL_ID = "grok/grok-3";

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    id: "grok",
    label: "xAI / Grok",
    shortLabel: "Grok",
    envVars: ["XAI_API_KEY", "GROK_API_KEY"],
    docsUrl: "https://console.x.ai/",
    requiresApiKey: true,
    supportTier: "tier1",
    localOnly: false,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "Anthropic",
    envVars: ["ANTHROPIC_API_KEY"],
    docsUrl: "https://console.anthropic.com/",
    requiresApiKey: true,
    supportTier: "tier1",
    localOnly: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    shortLabel: "OpenAI",
    envVars: ["OPENAI_API_KEY"],
    docsUrl: "https://platform.openai.com/api-keys",
    requiresApiKey: true,
    supportTier: "tier1",
    localOnly: false,
  },
  {
    id: "google",
    label: "Google AI",
    shortLabel: "Google",
    envVars: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
    docsUrl: "https://aistudio.google.com/apikey",
    requiresApiKey: true,
    supportTier: "tier1",
    localOnly: false,
  },
  {
    id: "ollama",
    label: "Local (Ollama)",
    shortLabel: "Ollama",
    envVars: ["OLLAMA_BASE_URL"],
    docsUrl: "https://ollama.com/",
    requiresApiKey: false,
    supportTier: "tier1",
    localOnly: true,
  },
  {
    id: "groq",
    label: "Groq",
    shortLabel: "Groq",
    envVars: ["GROQ_API_KEY"],
    docsUrl: "https://console.groq.com/keys",
    requiresApiKey: true,
    supportTier: "advanced",
    localOnly: false,
  },
  {
    id: "custom",
    label: "Custom OpenAI-Compatible",
    shortLabel: "Custom",
    envVars: [],
    requiresApiKey: false,
    supportTier: "advanced",
    localOnly: false,
  },
];

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "grok/grok-4.20-beta-0309-non-reasoning",
    provider: "grok",
    modelId: "grok-4.20-beta-0309-non-reasoning",
    label: "Grok 4.20 Beta",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-4.20-beta-0309-reasoning",
    provider: "grok",
    modelId: "grok-4.20-beta-0309-reasoning",
    label: "Grok 4.20 Beta (Reasoning)",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-4.20-multi-agent-beta-0309",
    provider: "grok",
    modelId: "grok-4.20-multi-agent-beta-0309",
    label: "Grok 4.20 Multi-Agent",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-4-0709",
    provider: "grok",
    modelId: "grok-4-0709",
    label: "Grok 4",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-4-1-fast-reasoning",
    provider: "grok",
    modelId: "grok-4-1-fast-reasoning",
    label: "Grok 4.1 Fast (Reasoning)",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-4-1-fast-non-reasoning",
    provider: "grok",
    modelId: "grok-4-1-fast-non-reasoning",
    label: "Grok 4.1 Fast",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-4-fast-reasoning",
    provider: "grok",
    modelId: "grok-4-fast-reasoning",
    label: "Grok 4 Fast (Reasoning)",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-4-fast-non-reasoning",
    provider: "grok",
    modelId: "grok-4-fast-non-reasoning",
    label: "Grok 4 Fast",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "grok/grok-code-fast-1",
    provider: "grok",
    modelId: "grok-code-fast-1",
    label: "Grok Code Fast",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: DEFAULT_MODEL_ID,
    provider: "grok",
    modelId: "grok-3",
    label: "Grok 3",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
    defaultSelected: true,
  },
  {
    id: "grok/grok-3-mini",
    provider: "grok",
    modelId: "grok-3-mini",
    label: "Grok 3 Mini",
    groupLabel: "xAI / Grok",
    supportTier: "tier1",
  },
  {
    id: "anthropic/claude-opus-4-6",
    provider: "anthropic",
    modelId: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    groupLabel: "Anthropic",
    supportTier: "tier1",
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    groupLabel: "Anthropic",
    supportTier: "tier1",
  },
  {
    id: "anthropic/claude-haiku-4-5",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    groupLabel: "Anthropic",
    supportTier: "tier1",
  },
  {
    id: "openai/gpt-4.1",
    provider: "openai",
    modelId: "gpt-4.1",
    label: "GPT-4.1",
    groupLabel: "OpenAI",
    supportTier: "tier1",
  },
  {
    id: "openai/o3-pro",
    provider: "openai",
    modelId: "o3-pro",
    label: "o3-pro",
    groupLabel: "OpenAI",
    supportTier: "tier1",
  },
  {
    id: "google/gemini-2.5-pro",
    provider: "google",
    modelId: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    groupLabel: "Google",
    supportTier: "tier1",
  },
  {
    id: "google/gemini-2.5-flash",
    provider: "google",
    modelId: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    groupLabel: "Google",
    supportTier: "tier1",
  },
  {
    id: "groq/llama-3.3-70b-versatile",
    provider: "groq",
    modelId: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    groupLabel: "Groq",
    supportTier: "advanced",
  },
  {
    id: "ollama/llama3.1:8b",
    provider: "ollama",
    modelId: "llama3.1:8b",
    label: "Llama 3.1 8B (local)",
    groupLabel: "Local (Ollama)",
    supportTier: "tier1",
  },
  {
    id: "ollama/qwen2.5-coder:7b",
    provider: "ollama",
    modelId: "qwen2.5-coder:7b",
    label: "Qwen 2.5 Coder 7B (local)",
    groupLabel: "Local (Ollama)",
    supportTier: "tier1",
  },
  {
    id: "ollama/mistral:7b",
    provider: "ollama",
    modelId: "mistral:7b",
    label: "Mistral 7B (local)",
    groupLabel: "Local (Ollama)",
    supportTier: "tier1",
  },
];

export const SURFACE_RELEASE_MATRIX: SurfaceReleaseEntry[] = [
  {
    id: "cli",
    label: "CLI",
    releaseRing: "ga",
    role: "primary",
    shipTarget: true,
  },
  {
    id: "vscode",
    label: "VS Code Extension",
    releaseRing: "preview",
    role: "primary",
    shipTarget: true,
  },
  {
    id: "desktop",
    label: "Desktop App",
    releaseRing: "experimental",
    role: "secondary",
    shipTarget: false,
  },
];

export function getProviderCatalogEntry(
  provider: ModelProvider | string,
): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.id === provider);
}

export function getModelCatalogEntry(model: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((entry) => entry.id === model);
}

export function getModelsForProvider(provider: ModelProvider): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter((entry) => entry.provider === provider);
}

export function inferProviderFromModelId(
  modelId: string,
  fallbackProvider: ModelProvider = "grok",
): ModelProvider {
  if (modelId.startsWith("grok")) return "grok";
  if (modelId.startsWith("claude")) return "anthropic";
  if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3"))
    return "openai";
  if (modelId.startsWith("gemini")) return "google";
  if (modelId.startsWith("llama") || modelId.startsWith("qwen") || modelId.startsWith("mistral")) {
    return "ollama";
  }
  return fallbackProvider;
}

export function parseModelReference(
  modelReference: string,
  fallbackProvider: ModelProvider = "grok",
): { id: string; provider: ModelProvider; modelId: string } {
  const trimmed = modelReference.trim();
  if (trimmed.length === 0) {
    return parseModelReference(DEFAULT_MODEL_ID, fallbackProvider);
  }

  const parts = trimmed.split("/");
  if (parts.length >= 2) {
    const provider = parts[0] as ModelProvider;
    const modelId = parts.slice(1).join("/");
    return {
      id: `${provider}/${modelId}`,
      provider,
      modelId,
    };
  }

  const provider = inferProviderFromModelId(trimmed, fallbackProvider);
  return {
    id: `${provider}/${trimmed}`,
    provider,
    modelId: trimmed,
  };
}

export function getDefaultModelCatalogEntry(): ModelCatalogEntry {
  return (
    MODEL_CATALOG.find((entry) => entry.defaultSelected) ??
    MODEL_CATALOG.find((entry) => entry.id === DEFAULT_MODEL_ID) ??
    MODEL_CATALOG[0]!
  );
}

export function groupCatalogModels(
  models: ModelCatalogEntry[] = MODEL_CATALOG,
): Array<{ groupLabel: string; models: ModelCatalogEntry[] }> {
  const groups = new Map<string, ModelCatalogEntry[]>();

  for (const model of models) {
    const existing = groups.get(model.groupLabel);
    if (existing) {
      existing.push(model);
    } else {
      groups.set(model.groupLabel, [model]);
    }
  }

  return Array.from(groups.entries()).map(([groupLabel, groupedModels]) => ({
    groupLabel,
    models: groupedModels,
  }));
}
