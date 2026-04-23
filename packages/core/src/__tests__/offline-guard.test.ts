// packages/core/src/__tests__/offline-guard.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OllamaHealthProbe, OfflineGuard } from "../offline-guard.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("OllamaHealthProbe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns running=false when fetch throws (Ollama not running)", async () => {
    mockFetch.mockRejectedValue(new Error("connection refused"));
    const probe = new OllamaHealthProbe({ cacheTtlMs: 0 });
    const result = await probe.check();
    expect(result.running).toBe(false);
    expect(result.latencyMs).toBe(-1);
    expect(result.models).toHaveLength(0);
  });

  it("returns running=false when response is not ok", async () => {
    mockFetch.mockResolvedValue({ ok: false } as Response);
    const probe = new OllamaHealthProbe({ cacheTtlMs: 0 });
    const result = await probe.check();
    expect(result.running).toBe(false);
  });

  it("returns running=true with model list when Ollama is healthy", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "qwen2.5-coder:7b", size: 4_000_000_000 },
          { name: "llama3.2:3b", size: 2_000_000_000 },
        ],
      }),
    } as unknown as Response);
    const probe = new OllamaHealthProbe({ cacheTtlMs: 0 });
    const result = await probe.check();
    expect(result.running).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.models[0]!.name).toBe("qwen2.5-coder:7b");
  });

  it("caches the result and doesn't call fetch twice within TTL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as unknown as Response);
    const probe = new OllamaHealthProbe({ cacheTtlMs: 60_000 });
    await probe.check();
    await probe.check();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("calls fetch again after cache TTL expires", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as unknown as Response);
    const probe = new OllamaHealthProbe({ cacheTtlMs: 1 });
    await probe.check();
    await new Promise((r) => setTimeout(r, 5));
    await probe.check();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("invalidate() forces a fresh check", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as unknown as Response);
    const probe = new OllamaHealthProbe({ cacheTtlMs: 60_000 });
    await probe.check();
    probe.invalidate();
    await probe.check();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("records latencyMs as positive number when running", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    } as unknown as Response);
    const probe = new OllamaHealthProbe({ cacheTtlMs: 0 });
    const result = await probe.check();
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("OfflineGuard", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["GROQ_API_KEY"];
    delete process.env["DEEPSEEK_API_KEY"];
    delete process.env["MISTRAL_API_KEY"];
    delete process.env["OPENROUTER_API_KEY"];
    delete process.env["DANTECODE_OFFLINE"];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("isOfflineMode() returns true when DANTECODE_OFFLINE=1", () => {
    process.env["DANTECODE_OFFLINE"] = "1";
    const guard = new OfflineGuard();
    expect(guard.isOfflineMode()).toBe(true);
  });

  it("isOfflineMode() returns true when no cloud keys set", () => {
    const guard = new OfflineGuard();
    expect(guard.isOfflineMode()).toBe(true);
  });

  it("isOfflineMode() returns false when ANTHROPIC_API_KEY set", () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    const guard = new OfflineGuard();
    expect(guard.isOfflineMode()).toBe(false);
  });

  it("selectLocalModel prefers recommended code models that are available", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "llama3.2:3b" },
          { name: "qwen2.5-coder:7b" }, // preferred for code
        ],
      }),
    } as unknown as Response);
    const guard = new OfflineGuard({ cacheTtlMs: 0 });
    const route = await guard.selectLocalModel("code");
    expect(route.provider).toBe("ollama");
    expect(route.modelId).toBe("qwen2.5-coder:7b");
  });

  it("selectLocalModel falls back to first available model", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "some-custom-model:latest" }],
      }),
    } as unknown as Response);
    const guard = new OfflineGuard({ cacheTtlMs: 0 });
    const route = await guard.selectLocalModel("code");
    expect(route.modelId).toBe("some-custom-model:latest");
  });

  it("selectLocalModel returns recommended model even when Ollama not running", async () => {
    mockFetch.mockRejectedValue(new Error("not running"));
    const guard = new OfflineGuard({ cacheTtlMs: 0 });
    const route = await guard.selectLocalModel("code");
    expect(route.ollamaConfirmed).toBe(false);
    expect(typeof route.modelId).toBe("string");
  });

  it("isModelAvailable returns true when model name matches", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "qwen2.5-coder:7b" }],
      }),
    } as unknown as Response);
    const guard = new OfflineGuard({ cacheTtlMs: 0 });
    expect(await guard.isModelAvailable("qwen2.5-coder:7b")).toBe(true);
  });

  it("isModelAvailable returns false when model not present", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.2:3b" }] }),
    } as unknown as Response);
    const guard = new OfflineGuard({ cacheTtlMs: 0 });
    expect(await guard.isModelAvailable("qwen2.5-coder:7b")).toBe(false);
  });

  it("formatOfflineStatus mentions Ollama URL when running", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "qwen2.5-coder:7b" }],
      }),
    } as unknown as Response);
    const guard = new OfflineGuard({ cacheTtlMs: 0 });
    const status = await guard.formatOfflineStatus();
    expect(status).toContain("localhost:11434");
    expect(status).toContain("qwen2.5-coder:7b");
  });

  it("formatOfflineStatus advises install when Ollama not running", async () => {
    mockFetch.mockRejectedValue(new Error("not running"));
    const guard = new OfflineGuard({ cacheTtlMs: 0 });
    const status = await guard.formatOfflineStatus();
    expect(status).toContain("not running");
  });
});
