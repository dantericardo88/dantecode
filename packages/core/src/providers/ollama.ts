// ============================================================================
// @dantecode/core — Ollama Provider (local OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Default Ollama API base URL when no override is specified.
 */
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_OLLAMA_CONTEXT_WINDOW = 8_192;
const DEFAULT_OLLAMA_GPU_LAYERS = 99;

type FetchInput = Parameters<typeof globalThis.fetch>[0];
type FetchInit = Parameters<typeof globalThis.fetch>[1];
type FetchBody = NonNullable<FetchInit>["body"];

/**
 * Builds an Ollama language model provider using the OpenAI-compatible API
 * exposed by Ollama's local server.
 *
 * Resolves the base URL from `config.baseUrl`, the `OLLAMA_BASE_URL` environment
 * variable, or falls back to `http://localhost:11434/v1`.
 *
 * Ollama runs locally and does not require an API key. A dummy key value of
 * "ollama" is provided to satisfy the OpenAI SDK's requirement.
 *
 * @param config - Model configuration specifying modelId and optional baseUrl.
 * @returns A configured LanguageModelV1 instance for the specified Ollama model.
 */
export function buildOllamaProvider(config: ModelConfig): LanguageModelV1 {
  const baseURL = normalizeOllamaBaseUrl(
    config.baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? DEFAULT_OLLAMA_BASE_URL,
  );

  const provider = createOpenAI({
    apiKey: "ollama",
    baseURL,
    compatibility: "compatible",
    fetch: createOllamaFetch(config),
  });

  return provider(config.modelId);
}

function normalizeOllamaBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function createOllamaFetch(config: ModelConfig): typeof fetch {
  const runtimeOptions = {
    num_ctx: resolveOllamaContextWindow(config),
    num_gpu: resolveOllamaGpuLayers(),
  };

  return async (input, init) => {
    const url = getRequestUrl(input);
    const body = parseJsonBody(init?.body);

    if (!isOllamaTextGenerationEndpoint(url) || body === undefined) {
      return globalThis.fetch(input, init);
    }

    const existingOptions = isRecord(body.options) ? body.options : {};
    return globalThis.fetch(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        options: {
          ...runtimeOptions,
          ...existingOptions,
        },
      }),
    });
  };
}

function resolveOllamaContextWindow(config: ModelConfig): number {
  return (
    parsePositiveInteger(process.env["OLLAMA_NUM_CTX"]) ??
    parsePositiveInteger(process.env["OLLAMA_CONTEXT_LENGTH"]) ??
    Math.min(config.contextWindow, DEFAULT_OLLAMA_CONTEXT_WINDOW)
  );
}

function resolveOllamaGpuLayers(): number {
  return parseNonNegativeInteger(process.env["OLLAMA_NUM_GPU"]) ?? DEFAULT_OLLAMA_GPU_LAYERS;
}

function getRequestUrl(input: FetchInput): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function isOllamaTextGenerationEndpoint(url: string): boolean {
  return /\/v1\/(?:chat\/completions|completions)(?:\?|$)/.test(url);
}

function parseJsonBody(body: FetchBody | null | undefined): Record<string, unknown> | undefined {
  if (typeof body !== "string") {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  const parsed = parseInteger(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const parsed = parseInteger(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
