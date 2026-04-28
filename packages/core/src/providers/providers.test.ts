import { describe, it, expect, vi, afterEach } from "vitest";
import type { ModelConfig } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Mock the AI SDK provider factories BEFORE importing the modules under test
// ---------------------------------------------------------------------------

const mockAnthropicModel = { modelId: "mock-anthropic", provider: "anthropic" };
const mockAnthropicFactory = vi.fn(() => mockAnthropicModel);
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn(() => mockAnthropicFactory),
}));

const mockOpenAIModel = { modelId: "mock-openai", provider: "openai" };
const mockOpenAIFactory = vi.fn(() => mockOpenAIModel);
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => mockOpenAIFactory),
}));

import { buildAnthropicProvider } from "./anthropic.js";
import { buildOpenAIProvider } from "./openai.js";
import { buildGrokProvider } from "./grok.js";
import { buildOllamaProvider } from "./ollama.js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

// ---------------------------------------------------------------------------
// Shared config builder
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    maxTokens: 8192,
    temperature: 0.1,
    contextWindow: 200000,
    supportsVision: true,
    supportsToolCalls: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Anthropic Provider
// ---------------------------------------------------------------------------

describe("providers", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe("buildAnthropicProvider", () => {
    it("throws when no API key is available", () => {
      delete process.env["ANTHROPIC_API_KEY"];
      expect(() => buildAnthropicProvider(makeConfig())).toThrow("Anthropic API key not found");
    });

    it("uses config.apiKey when provided", () => {
      delete process.env["ANTHROPIC_API_KEY"];
      const config = makeConfig({ apiKey: "sk-config-key" });
      const model = buildAnthropicProvider(config);
      expect(model).toBe(mockAnthropicModel);
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-config-key" });
      expect(mockAnthropicFactory).toHaveBeenCalledWith("claude-sonnet-4-6");
    });

    it("falls back to ANTHROPIC_API_KEY env var", () => {
      process.env["ANTHROPIC_API_KEY"] = "sk-env-key";
      const model = buildAnthropicProvider(makeConfig());
      expect(model).toBe(mockAnthropicModel);
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-env-key" });
    });

    it("prefers config.apiKey over env var", () => {
      process.env["ANTHROPIC_API_KEY"] = "sk-env-key";
      const config = makeConfig({ apiKey: "sk-config-key" });
      buildAnthropicProvider(config);
      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: "sk-config-key" });
    });

    it("error message includes setup instructions", () => {
      delete process.env["ANTHROPIC_API_KEY"];
      try {
        buildAnthropicProvider(makeConfig());
      } catch (err) {
        expect(String(err)).toContain("ANTHROPIC_API_KEY");
        expect(String(err)).toContain("console.anthropic.com");
      }
    });
  });

  // -------------------------------------------------------------------------
  // OpenAI Provider
  // -------------------------------------------------------------------------

  describe("buildOpenAIProvider", () => {
    it("throws when no API key is available", () => {
      delete process.env["OPENAI_API_KEY"];
      expect(() =>
        buildOpenAIProvider(makeConfig({ provider: "openai", modelId: "gpt-4.1" })),
      ).toThrow("OpenAI API key not found");
    });

    it("uses config.apiKey when provided", () => {
      delete process.env["OPENAI_API_KEY"];
      const config = makeConfig({ provider: "openai", modelId: "gpt-4.1", apiKey: "sk-oai-key" });
      const model = buildOpenAIProvider(config);
      expect(model).toBe(mockOpenAIModel);
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-oai-key" });
    });

    it("falls back to OPENAI_API_KEY env var", () => {
      process.env["OPENAI_API_KEY"] = "sk-oai-env";
      const model = buildOpenAIProvider(makeConfig({ provider: "openai", modelId: "gpt-4.1" }));
      expect(model).toBe(mockOpenAIModel);
      expect(createOpenAI).toHaveBeenCalledWith({ apiKey: "sk-oai-env" });
    });

    it("passes baseUrl when configured", () => {
      process.env["OPENAI_API_KEY"] = "sk-oai-env";
      buildOpenAIProvider(
        makeConfig({
          provider: "openai",
          modelId: "gpt-4.1",
          baseUrl: "https://my-proxy.example.com",
        }),
      );
      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: "sk-oai-env",
        baseURL: "https://my-proxy.example.com",
      });
    });

    it("does not pass baseURL when not configured", () => {
      process.env["OPENAI_API_KEY"] = "sk-oai-env";
      buildOpenAIProvider(makeConfig({ provider: "openai", modelId: "gpt-4.1" }));
      const callArgs = (createOpenAI as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(callArgs).not.toHaveProperty("baseURL");
    });

    it("error message includes setup instructions", () => {
      delete process.env["OPENAI_API_KEY"];
      try {
        buildOpenAIProvider(makeConfig({ provider: "openai", modelId: "gpt-4.1" }));
      } catch (err) {
        expect(String(err)).toContain("OPENAI_API_KEY");
        expect(String(err)).toContain("platform.openai.com");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Grok Provider
  // -------------------------------------------------------------------------

  describe("buildGrokProvider", () => {
    it("throws when no API key is available", () => {
      delete process.env["XAI_API_KEY"];
      delete process.env["GROK_API_KEY"];
      expect(() => buildGrokProvider(makeConfig({ provider: "grok", modelId: "grok-3" }))).toThrow(
        "Grok API key not found",
      );
    });

    it("uses config.apiKey when provided", () => {
      delete process.env["XAI_API_KEY"];
      delete process.env["GROK_API_KEY"];
      const config = makeConfig({ provider: "grok", modelId: "grok-3", apiKey: "xai-key" });
      const model = buildGrokProvider(config);
      expect(model).toBe(mockOpenAIModel);
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "xai-key",
          baseURL: "https://api.x.ai/v1",
          compatibility: "compatible",
        }),
      );
    });

    it("falls back to XAI_API_KEY env var first", () => {
      process.env["XAI_API_KEY"] = "xai-primary-env-key";
      buildGrokProvider(makeConfig({ provider: "grok", modelId: "grok-3" }));
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "xai-primary-env-key",
          baseURL: "https://api.x.ai/v1",
        }),
      );
    });

    it("falls back to GROK_API_KEY env var", () => {
      delete process.env["XAI_API_KEY"];
      process.env["GROK_API_KEY"] = "xai-env-key";
      buildGrokProvider(makeConfig({ provider: "grok", modelId: "grok-3" }));
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "xai-env-key",
          baseURL: "https://api.x.ai/v1",
        }),
      );
    });

    it("includes X-Client header", () => {
      delete process.env["XAI_API_KEY"];
      process.env["GROK_API_KEY"] = "xai-env-key";
      buildGrokProvider(makeConfig({ provider: "grok", modelId: "grok-3" }));
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { "X-Client": "dantecode/1.0.0" },
        }),
      );
    });

    it("error message includes setup instructions", () => {
      delete process.env["XAI_API_KEY"];
      delete process.env["GROK_API_KEY"];
      try {
        buildGrokProvider(makeConfig({ provider: "grok", modelId: "grok-3" }));
      } catch (err) {
        expect(String(err)).toContain("XAI_API_KEY");
        expect(String(err)).toContain("console.x.ai");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Ollama Provider
  // -------------------------------------------------------------------------

  describe("buildOllamaProvider", () => {
    it("does not require an API key", () => {
      delete process.env["OLLAMA_BASE_URL"];
      expect(() =>
        buildOllamaProvider(makeConfig({ provider: "ollama", modelId: "llama3" })),
      ).not.toThrow();
    });

    it("uses default localhost base URL", () => {
      delete process.env["OLLAMA_BASE_URL"];
      buildOllamaProvider(makeConfig({ provider: "ollama", modelId: "llama3" }));
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "ollama",
          baseURL: "http://localhost:11434/v1",
          compatibility: "compatible",
        }),
      );
    });

    it("uses OLLAMA_BASE_URL env var when set", () => {
      process.env["OLLAMA_BASE_URL"] = "http://remote-ollama:11434/v1";
      buildOllamaProvider(makeConfig({ provider: "ollama", modelId: "llama3" }));
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "http://remote-ollama:11434/v1",
        }),
      );
    });

    it("normalizes OLLAMA_BASE_URL values that omit /v1", () => {
      process.env["OLLAMA_BASE_URL"] = "http://remote-ollama:11434/";
      buildOllamaProvider(makeConfig({ provider: "ollama", modelId: "llama3" }));
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "http://remote-ollama:11434/v1",
        }),
      );
    });

    it("prefers config.baseUrl over env var", () => {
      process.env["OLLAMA_BASE_URL"] = "http://remote-ollama:11434/v1";
      buildOllamaProvider(
        makeConfig({
          provider: "ollama",
          modelId: "llama3",
          baseUrl: "http://config-ollama:11434/v1",
        }),
      );
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "http://config-ollama:11434/v1",
        }),
      );
    });

    it("normalizes config.baseUrl values that omit /v1", () => {
      buildOllamaProvider(
        makeConfig({
          provider: "ollama",
          modelId: "llama3",
          baseUrl: "http://config-ollama:11434",
        }),
      );
      expect(createOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: "http://config-ollama:11434/v1",
        }),
      );
    });

    it("returns the model from the factory", () => {
      delete process.env["OLLAMA_BASE_URL"];
      const model = buildOllamaProvider(makeConfig({ provider: "ollama", modelId: "llama3" }));
      expect(model).toBe(mockOpenAIModel);
      expect(mockOpenAIFactory).toHaveBeenCalledWith("llama3");
    });

    it("injects Ollama runtime options into OpenAI-compatible chat requests", async () => {
      delete process.env["OLLAMA_BASE_URL"];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
      );

      buildOllamaProvider(
        makeConfig({
          provider: "ollama",
          modelId: "llama3",
          contextWindow: 32768,
        }),
      );

      const callArgs = (createOpenAI as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      await callArgs.fetch("http://localhost:11434/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "llama3", messages: [] }),
      });

      const [, requestInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(String(requestInit?.body));
      expect(body.options).toEqual({
        num_ctx: 8192,
        num_gpu: 99,
      });
    });

    it("honors OLLAMA_NUM_CTX and OLLAMA_NUM_GPU when injecting runtime options", async () => {
      process.env["OLLAMA_NUM_CTX"] = "4096";
      process.env["OLLAMA_NUM_GPU"] = "12";
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
      );

      buildOllamaProvider(makeConfig({ provider: "ollama", modelId: "llama3" }));

      const callArgs = (createOpenAI as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      await callArgs.fetch("http://localhost:11434/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "llama3", messages: [] }),
      });

      const [, requestInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const body = JSON.parse(String(requestInit?.body));
      expect(body.options).toEqual({
        num_ctx: 4096,
        num_gpu: 12,
      });
    });
  });
});
