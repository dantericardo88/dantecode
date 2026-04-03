// ============================================================================
// @dantecode/core - Embedding Provider Abstraction
// ============================================================================

import type { ModelProvider } from "@dantecode/config-types";

export type EmbeddingProviderName = Extract<ModelProvider, "ollama" | "openai" | "google">;

export interface EmbeddingProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  dimensions?: number;
}

export interface EmbeddingProviderInfo {
  provider: EmbeddingProviderName;
  modelId: string;
  dimensions?: number;
}

export interface EmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  embed(texts: string[]): Promise<number[][]>;
  embedSingle(text: string): Promise<number[]>;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  abstract readonly info: EmbeddingProviderInfo;

  abstract embed(texts: string[]): Promise<number[][]>;

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    if (!embedding) {
      throw new Error("Embedding provider returned no embedding for single input");
    }
    return embedding;
  }

  protected validateEmbeddings(embeddings: number[][], expected: number): number[][] {
    if (embeddings.length !== expected) {
      throw new Error(
        `Embedding provider returned ${embeddings.length} vectors for ${expected} inputs`,
      );
    }
    for (const embedding of embeddings) {
      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("Embedding provider returned an empty embedding vector");
      }
    }
    return embeddings;
  }

  protected async readJson<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `Embedding request failed (${response.status} ${response.statusText})` +
          (errorText ? `: ${errorText.slice(0, 300)}` : ""),
      );
    }
    return (await response.json()) as T;
  }
}

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

class OpenAIEmbeddingProvider extends BaseEmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: EmbeddingProviderConfig = {}) {
    super();
    this.apiKey = config.apiKey ?? process.env["OPENAI_API_KEY"] ?? "";
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_OPENAI_BASE_URL);
    this.info = {
      provider: "openai",
      modelId: config.modelId ?? "text-embedding-3-small",
      ...(config.dimensions ? { dimensions: config.dimensions } : {}),
    };

    if (!this.apiKey) {
      throw new Error(
        "OpenAI API key not found. Set OPENAI_API_KEY or provide embedding config.apiKey.",
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.info.modelId,
        input: texts,
        ...(this.info.dimensions ? { dimensions: this.info.dimensions } : {}),
      }),
    });
    const json = await this.readJson<OpenAIEmbeddingResponse>(response);
    const embeddings = (json.data ?? []).map((entry) => entry.embedding ?? []);
    return this.validateEmbeddings(embeddings, texts.length);
  }
}

class GoogleEmbeddingProvider extends BaseEmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: EmbeddingProviderConfig = {}) {
    super();
    this.apiKey =
      config.apiKey ?? process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"] ?? "";
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_GOOGLE_BASE_URL);
    this.info = {
      provider: "google",
      modelId: config.modelId ?? "text-embedding-004",
      ...(config.dimensions ? { dimensions: config.dimensions } : {}),
    };

    if (!this.apiKey) {
      throw new Error(
        "Google API key not found. Set GOOGLE_API_KEY/GEMINI_API_KEY or provide embedding config.apiKey.",
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.info.modelId,
        input: texts,
        ...(this.info.dimensions ? { dimensions: this.info.dimensions } : {}),
      }),
    });
    const json = await this.readJson<OpenAIEmbeddingResponse>(response);
    const embeddings = (json.data ?? []).map((entry) => entry.embedding ?? []);
    return this.validateEmbeddings(embeddings, texts.length);
  }
}

interface OllamaEmbeddingResponse {
  embedding?: number[];
}

class OllamaEmbeddingProvider extends BaseEmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  private readonly baseUrl: string;

  constructor(config: EmbeddingProviderConfig = {}) {
    super();
    this.baseUrl = normalizeOllamaBaseUrl(
      config.baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? DEFAULT_OLLAMA_BASE_URL,
    );
    this.info = {
      provider: "ollama",
      modelId: config.modelId ?? "nomic-embed-text",
      ...(config.dimensions ? { dimensions: config.dimensions } : {}),
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const embeddings: number[][] = [];
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.info.modelId,
          prompt: text,
        }),
      });
      const json = await this.readJson<OllamaEmbeddingResponse>(response);
      embeddings.push(json.embedding ?? []);
    }

    return this.validateEmbeddings(embeddings, texts.length);
  }
}

export function createEmbeddingProvider(
  provider: EmbeddingProviderName,
  config: EmbeddingProviderConfig = {},
): EmbeddingProvider {
  switch (provider) {
    case "ollama":
      return new OllamaEmbeddingProvider(config);
    case "openai":
      return new OpenAIEmbeddingProvider(config);
    case "google":
      return new GoogleEmbeddingProvider(config);
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported embedding provider: ${String(exhaustive)}`);
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/v1$/, "");
}
