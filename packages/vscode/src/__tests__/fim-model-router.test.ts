// ============================================================================
// packages/vscode/src/__tests__/fim-model-router.test.ts
// 15 tests for FimModelRouter.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@dantecode/core", () => {
  class ModelRouterImpl {
    readonly _modelString: string;
    constructor(_rc: unknown, _root: string, _session: string) {
      this._modelString = String(_root);
    }
  }
  function parseModelReference(model: string) {
    const [provider, ...rest] = model.split("/");
    return { provider: provider ?? "grok", modelId: rest.join("/") || model };
  }
  return { ModelRouterImpl, parseModelReference };
});

vi.mock("@dantecode/config-types", () => ({}));

import { FimModelRouter } from "../fim-model-router.js";
import { ModelRouterImpl } from "@dantecode/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOllamaFetch(models: string[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ models: models.map((name) => ({ name })) }),
  });
}

function makeFailFetch(status = 404) {
  return vi.fn().mockResolvedValue({ ok: false, status });
}

function makeTimeoutFetch() {
  // Fetch that blocks until abort signal fires — allows fake timers to control the timeout
  return vi.fn().mockImplementation(
    (_url: string, options?: { signal?: AbortSignal }) =>
      new Promise<never>((_, reject) => {
        const signal = options?.signal;
        if (signal) {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("AbortError"), { name: "AbortError" })), { once: true });
        }
      }),
  );
}

function makeRefusedFetch() {
  return vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FimModelRouter", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  // ── Router cache ───────────────────────────────────────────────────────────

  it("getRouter returns same instance for same modelId and projectRoot", () => {
    const router = new FimModelRouter();
    const r1 = router.getRouter("grok/grok-3", "/workspace");
    const r2 = router.getRouter("grok/grok-3", "/workspace");
    expect(r1).toBe(r2);
    router.dispose();
  });

  it("getRouter returns different instances for different modelIds", () => {
    const router = new FimModelRouter();
    const r1 = router.getRouter("grok/grok-3", "/workspace");
    const r2 = router.getRouter("ollama/qwen", "/workspace");
    expect(r1).not.toBe(r2);
    router.dispose();
  });

  it("getRouter returns different instances for different projectRoots", () => {
    const router = new FimModelRouter();
    const r1 = router.getRouter("grok/grok-3", "/workspace-a");
    const r2 = router.getRouter("grok/grok-3", "/workspace-b");
    expect(r1).not.toBe(r2);
    router.dispose();
  });

  it("getRouter creates a ModelRouterImpl on cache miss", () => {
    const router = new FimModelRouter();
    const r = router.getRouter("grok/grok-3", "/ws");
    expect(r).toBeInstanceOf(ModelRouterImpl);
    router.dispose();
  });

  // ── probeOllama ────────────────────────────────────────────────────────────

  it("probeOllama returns model name when Ollama responds with matching model", async () => {
    const router = new FimModelRouter(makeOllamaFetch(["qwen2.5-coder:1.5b", "llama3"]));
    const result = await router.probeOllama("http://localhost:11434", "qwen");
    expect(result).toBe("qwen2.5-coder:1.5b");
    router.dispose();
  });

  it("probeOllama returns null when Ollama returns non-OK response", async () => {
    const router = new FimModelRouter(makeFailFetch(404));
    const result = await router.probeOllama("http://localhost:11434");
    expect(result).toBeNull();
    router.dispose();
  });

  it("probeOllama returns null when Ollama times out (300ms)", async () => {
    vi.useFakeTimers();
    const router = new FimModelRouter(makeTimeoutFetch());
    const probePromise = router.probeOllama("http://localhost:11434");
    // Advance past the 300ms probe timeout — triggers controller.abort() which rejects the fetch
    await vi.advanceTimersByTimeAsync(400);
    const result = await probePromise;
    expect(result).toBeNull();
    router.dispose();
    vi.useRealTimers();
  });

  it("probeOllama returns null when connection refused", async () => {
    const router = new FimModelRouter(makeRefusedFetch());
    const result = await router.probeOllama("http://localhost:11434");
    expect(result).toBeNull();
    router.dispose();
  });

  it("auto-detect picks first *coder* model from tags list", async () => {
    const router = new FimModelRouter(
      makeOllamaFetch(["llama3:8b", "qwen2.5-coder:1.5b", "mistral"]),
    );
    const result = await router.probeOllama("http://localhost:11434");
    expect(result).toBe("qwen2.5-coder:1.5b");
    router.dispose();
  });

  // ── selectModel ────────────────────────────────────────────────────────────

  it("selectModel returns configured fimModel when no local model detected", () => {
    const router = new FimModelRouter();
    const result = router.selectModel({
      defaultModel: "grok/grok-3",
      fimModel: "grok/grok-3-mini",
      autoDetect: true,
    });
    expect(result).toBe("grok/grok-3-mini");
    router.dispose();
  });

  it("selectModel returns local model when probe is healthy", async () => {
    const router = new FimModelRouter(makeOllamaFetch(["qwen2.5-coder:1.5b"]));
    await router.probeOllama("http://localhost:11434"); // populates _localModelId directly
    // Manually trigger startHealthProbe to set _localModelId
    router.startHealthProbe({
      ollamaUrl: "http://localhost:11434",
      localModel: "",
      autoDetect: true,
    });
    // Wait for the immediate probe to complete
    await new Promise((r) => setTimeout(r, 10));
    const result = router.selectModel({
      defaultModel: "grok/grok-3",
      fimModel: "",
      autoDetect: true,
    });
    expect(result).toBe("ollama/qwen2.5-coder:1.5b");
    router.dispose();
  });

  it("fimLocalModel pattern overrides auto-detection", async () => {
    const router = new FimModelRouter(makeOllamaFetch(["qwen2.5-coder:1.5b", "codellama:7b"]));
    const result = await router.probeOllama("http://localhost:11434", "codellama");
    expect(result).toBe("codellama:7b");
    router.dispose();
  });

  // ── startHealthProbe ───────────────────────────────────────────────────────

  it("fimOllamaAutoDetect false skips probe entirely", () => {
    const fetchFn = makeOllamaFetch(["qwen2.5-coder:1.5b"]);
    const router = new FimModelRouter(fetchFn);
    router.startHealthProbe({
      ollamaUrl: "http://localhost:11434",
      localModel: "",
      autoDetect: false,
    });
    expect(fetchFn).not.toHaveBeenCalled();
    router.dispose();
  });

  it("custom fimOllamaUrl used in probe URL", async () => {
    const fetchFn = makeOllamaFetch(["qwen2.5-coder:1.5b"]);
    const router = new FimModelRouter(fetchFn);
    await router.probeOllama("http://myhost:9999");
    expect(fetchFn).toHaveBeenCalledWith(
      "http://myhost:9999/api/tags",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    router.dispose();
  });

  // ── dispose ───────────────────────────────────────────────────────────────

  it("dispose clears health probe interval and router map", () => {
    vi.useFakeTimers();
    const fetchFn = makeOllamaFetch(["qwen2.5-coder:1.5b"]);
    const router = new FimModelRouter(fetchFn);
    router.startHealthProbe({
      ollamaUrl: "http://localhost:11434",
      localModel: "",
      autoDetect: true,
    });
    router.getRouter("grok/grok-3", "/ws");
    router.dispose();
    // After dispose, no further probes should fire on interval
    vi.clearAllMocks();
    vi.advanceTimersByTime(60_000);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(router.localModelId).toBeNull();
    vi.useRealTimers();
  });
});
