import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModelV1 } from "ai";
import { ModelRouterImpl } from "./model-router.js";
import type { ModelConfig, ModelRouterConfig } from "@dantecode/config-types";

/**
 * Integration tests for the model router with a real HTTP mock server.
 *
 * These tests start a local HTTP server that mimics the OpenAI chat completion
 * API, then exercise the full pipeline: provider construction → HTTP request →
 * response parsing → audit logging.
 */

let server: Server;
let baseURL: string;
let requestCount = 0;
let lastRequestBody: RecordedRequestBody | null = null;

interface RecordedRequestBody {
  model?: string;
  messages?: unknown;
  [key: string]: unknown;
}

function createOpenAIModelConfig(
  modelId: string,
  overrides: Partial<ModelConfig> = {},
): ModelConfig {
  return {
    provider: "openai",
    modelId,
    apiKey: "test-key",
    baseUrl: baseURL,
    maxTokens: 100,
    temperature: 0,
    contextWindow: 128_000,
    supportsVision: false,
    supportsToolCalls: true,
    ...overrides,
  };
}

function getLastRequestBody(): RecordedRequestBody {
  expect(lastRequestBody).not.toBeNull();
  return lastRequestBody ?? {};
}

function createMockResponse(content: string) {
  return JSON.stringify({
    id: `chatcmpl-test-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse) {
  requestCount++;
  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    try {
      lastRequestBody = JSON.parse(body) as RecordedRequestBody;
    } catch {
      lastRequestBody = null;
    }

    if (req.url === "/v1/chat/completions") {
      const parsed = lastRequestBody;
      // Return 401 for model names starting with "fail-" (4xx = no retries)
      if (parsed && typeof parsed.model === "string" && parsed.model.startsWith("fail-")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: { message: "Simulated auth error", type: "invalid_api_key" } }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(createMockResponse("Hello from mock server!"));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });
}

describe("model router — HTTP integration", () => {
  beforeAll(async () => {
    server = createServer(handleRequest);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseURL = `http://127.0.0.1:${addr.port}/v1`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("mock server responds to chat completion requests", async () => {
    const provider = createOpenAI({
      apiKey: "test-key",
      baseURL,
      compatibility: "compatible",
    });
    const model: LanguageModelV1 = provider("mock-model");

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Say hello" }],
    });

    expect(result.text).toBe("Hello from mock server!");
    expect(result.usage?.totalTokens).toBe(15);
  });

  it("model router generates text via real HTTP call", async () => {
    const config: ModelRouterConfig = {
      default: createOpenAIModelConfig("mock-model"),
      fallback: [],
      overrides: {},
    };

    const router = new ModelRouterImpl(config, "/tmp/test-project", "test-session");
    const text = await router.generate([{ role: "user", content: "Hello" }]);

    expect(text).toBe("Hello from mock server!");
    expect(router.getLogs().length).toBeGreaterThanOrEqual(2);
    expect(router.getLogs().some((l) => l.action === "attempt")).toBe(true);
    expect(router.getLogs().some((l) => l.action === "success")).toBe(true);
  });

  it("model router records provider and modelId in logs", async () => {
    const config: ModelRouterConfig = {
      default: createOpenAIModelConfig("mock-model"),
      fallback: [],
      overrides: {},
    };

    const router = new ModelRouterImpl(config, "/tmp/test-project", "sess-123");
    await router.generate([{ role: "user", content: "Test" }]);

    const logs = router.getLogs();
    expect(logs[0]?.provider).toBe("openai");
    expect(logs[0]?.modelId).toBe("mock-model");
  });

  it("model router sends correct messages to the API", async () => {
    requestCount = 0;
    lastRequestBody = null;

    const config: ModelRouterConfig = {
      default: createOpenAIModelConfig("mock-model", {
        maxTokens: 200,
        temperature: 0.5,
      }),
      fallback: [],
      overrides: {},
    };

    const router = new ModelRouterImpl(config, "/tmp/test-project", "sess-456");
    await router.generate([{ role: "user", content: "What is 2+2?" }], {
      system: "You are a math tutor.",
    });

    expect(requestCount).toBeGreaterThan(0);
    const requestBody = getLastRequestBody();
    // Verify the API received the correct model
    expect(requestBody.model).toBe("mock-model");
    // Verify messages were sent (the AI SDK serializes them)
    expect(requestBody.messages).toBeDefined();
  });

  it("model router falls back when primary fails", async () => {
    const config: ModelRouterConfig = {
      default: createOpenAIModelConfig("fail-primary"),
      fallback: [createOpenAIModelConfig("fallback-model")],
      overrides: {},
    };

    const router = new ModelRouterImpl(config, "/tmp/test-project", "sess-fallback");
    const text = await router.generate([{ role: "user", content: "Hello" }]);

    expect(text).toBe("Hello from mock server!");
    const logs = router.getLogs();
    expect(logs.some((l) => l.action === "error")).toBe(true);
    expect(logs.some((l) => l.action === "fallback")).toBe(true);
    expect(logs.some((l) => l.action === "success")).toBe(true);
  });

  it("model router uses task type overrides", async () => {
    lastRequestBody = null;

    const config: ModelRouterConfig = {
      default: createOpenAIModelConfig("default-model"),
      fallback: [],
      overrides: {
        codegen: createOpenAIModelConfig("codegen-model", {
          maxTokens: 500,
          temperature: 0.2,
        }),
      },
    };

    const router = new ModelRouterImpl(config, "/tmp/test-project", "sess-override");
    await router.generate([{ role: "user", content: "Write code" }], {
      taskType: "codegen",
    });

    // The codegen override model should have been used
    const requestBody = getLastRequestBody();
    expect(requestBody.model).toBe("codegen-model");
  });

  it("model router throws when all providers fail", async () => {
    const config: ModelRouterConfig = {
      default: createOpenAIModelConfig("fail-primary"),
      fallback: [createOpenAIModelConfig("fail-secondary")],
      overrides: {},
    };

    const router = new ModelRouterImpl(config, "/tmp/test-project", "sess-allfail");
    await expect(router.generate([{ role: "user", content: "Hello" }])).rejects.toThrow();

    const logs = router.getLogs();
    expect(logs.filter((l) => l.action === "error").length).toBe(2);
  });
});
