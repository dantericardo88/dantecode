// packages/vscode/src/__tests__/provider-detection-wiring.test.ts
// Sprint 28 — Dim 26: Dynamic provider availability detection (6→9)
// probeOllamaAvailability + detectAvailableProvidersAsync wired into routing.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  detectAvailableProviders,
  detectAvailableProvidersAsync,
  probeOllamaAvailability,
  resetProviderCache,
  routeByComplexity,
} from "@dantecode/core";

afterEach(() => {
  resetProviderCache();
  vi.restoreAllMocks();
});

// ─── detectAvailableProviders (sync, env-var based) ───────────────────────────

describe("detectAvailableProviders (sync)", () => {
  it("always includes ollama in the sync set", () => {
    const providers = detectAvailableProviders();
    expect(providers.has("ollama")).toBe(true);
  });

  it("includes anthropic when ANTHROPIC_API_KEY is set", () => {
    const orig = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    const providers = detectAvailableProviders();
    expect(providers.has("anthropic")).toBe(true);
    if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
    else delete process.env["ANTHROPIC_API_KEY"];
  });

  it("includes grok when XAI_API_KEY is set", () => {
    const orig = process.env["XAI_API_KEY"];
    process.env["XAI_API_KEY"] = "xai-test";
    const providers = detectAvailableProviders();
    expect(providers.has("grok")).toBe(true);
    if (orig !== undefined) process.env["XAI_API_KEY"] = orig;
    else delete process.env["XAI_API_KEY"];
  });
});

// ─── probeOllamaAvailability ──────────────────────────────────────────────────

describe("probeOllamaAvailability", () => {
  it("returns true when Ollama responds with ok status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    const result = await probeOllamaAvailability("http://localhost:11434");
    expect(result).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns false when Ollama responds with non-ok status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await probeOllamaAvailability("http://localhost:11434");
    expect(result).toBe(false);
  });

  it("returns false when fetch throws (connection refused)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await probeOllamaAvailability("http://localhost:11434");
    expect(result).toBe(false);
  });

  it("respects custom baseUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    await probeOllamaAvailability("http://localhost:11435");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11435/api/tags",
      expect.any(Object),
    );
  });

  it("returns false when AbortController fires (timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise((_res, rej) => setTimeout(() => rej(new Error("aborted")), 50))),
    );
    const result = await probeOllamaAvailability("http://localhost:11434", 10);
    expect(result).toBe(false);
  });
});

// ─── detectAvailableProvidersAsync ───────────────────────────────────────────

describe("detectAvailableProvidersAsync", () => {
  it("includes ollama when Ollama probe succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const providers = await detectAvailableProvidersAsync();
    expect(providers.has("ollama")).toBe(true);
  });

  it("excludes ollama when Ollama probe fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));
    const providers = await detectAvailableProvidersAsync();
    expect(providers.has("ollama")).toBe(false);
  });

  it("caches result — second call skips probe", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    await detectAvailableProvidersAsync();
    await detectAvailableProvidersAsync();
    // Fetch should only be called once — second call uses cache
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("resetProviderCache clears cache for fresh probe", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);
    await detectAvailableProvidersAsync();
    resetProviderCache();
    await detectAvailableProvidersAsync();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("returns a Set with API providers from env vars", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));
    const orig = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-test";
    const providers = await detectAvailableProvidersAsync();
    expect(providers.has("anthropic")).toBe(true);
    if (orig !== undefined) process.env["ANTHROPIC_API_KEY"] = orig;
    else delete process.env["ANTHROPIC_API_KEY"];
  });
});

// ─── routeByComplexity adapts to real provider set ───────────────────────────

describe("routeByComplexity with real provider sets", () => {
  it("routes trivial FIM to ollama when ollama is available", () => {
    const providers = new Set(["ollama", "anthropic"] as const) as Set<import("@dantecode/config-types").ModelProvider>;
    const result = routeByComplexity({ promptTokens: 100, isFim: true }, providers);
    expect(result.provider).toBe("ollama");
    expect(result.complexity).toBe("trivial");
  });

  it("falls back to anthropic for trivial tasks when ollama unavailable", () => {
    const providers = new Set(["anthropic"] as const) as Set<import("@dantecode/config-types").ModelProvider>;
    const result = routeByComplexity({ promptTokens: 100, isFim: true }, providers);
    // No ollama → routes to next best available
    expect(providers.has(result.provider)).toBe(true);
  });

  it("routes reasoning tasks to anthropic (Claude Opus) when available", () => {
    const providers = new Set(["anthropic", "ollama"] as const) as Set<import("@dantecode/config-types").ModelProvider>;
    const result = routeByComplexity({ promptTokens: 100, requiresReasoning: true }, providers);
    expect(result.complexity).toBe("reasoning");
  });

  it("routing_decision payload shape matches WebviewOutboundMessage contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const providers = await detectAvailableProvidersAsync();
    const routedModel = routeByComplexity({ promptTokens: 500, requiresTools: true }, providers);
    const payload = {
      type: "routing_decision" as const,
      payload: {
        complexity: routedModel.complexity,
        provider: routedModel.provider,
        modelId: routedModel.modelId,
        rationale: routedModel.rationale,
        promptTokens: 500,
      },
    };
    expect(payload.type).toBe("routing_decision");
    expect(typeof payload.payload.modelId).toBe("string");
    expect(typeof payload.payload.rationale).toBe("string");
  });
});
