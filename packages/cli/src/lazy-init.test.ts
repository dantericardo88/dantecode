// ============================================================================
// @dantecode/cli — Lazy Init Tests
// Tests for deferred gaslight/memory initialization and auto-init.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const { mockExecFileSync, shouldMemoryFail } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  shouldMemoryFail: { value: false },
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
  };
});

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<typeof import("@dantecode/core")>("@dantecode/core");
  return actual;
});

vi.mock("@dantecode/dante-gaslight", () => ({
  DanteGaslightIntegration: class MockGaslight {
    readonly enabled: boolean;
    constructor(config: { enabled: boolean }) {
      this.enabled = config.enabled;
    }
    cmdOn() {
      return "on";
    }
    cmdOff() {
      return "off";
    }
  },
}));

vi.mock("@dantecode/dante-skillbook", () => ({
  DanteSkillbookIntegration: class MockSkillbook {
    getRelevantSkills() {
      return [];
    }
  },
}));

vi.mock("@dantecode/memory-engine", () => {
  const MockOrchestrator = class {
    initialized = false;
    async initialize() {
      if (shouldMemoryFail.value) {
        throw new Error("disk full");
      }
      this.initialized = true;
    }
    memoryVisualize() {
      return { nodes: [], edges: [] };
    }
  };
  return {
    createMemoryOrchestrator: () => new MockOrchestrator(),
    MemoryOrchestrator: MockOrchestrator,
  };
});

import { getOrInitGaslight, getOrInitMemory, tryAutoInit } from "./lazy-init.js";
import type { ReplState } from "./slash-commands.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function makeMinimalState(projectRoot: string): ReplState {
  return {
    session: {
      id: "test-session",
      name: "test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
      model: { provider: "anthropic", modelId: "claude-sonnet-4-20250514" },
    },
    state: {} as ReplState["state"],
    projectRoot,
    verbose: false,
    enableGit: false,
    enableSandbox: false,
    silent: true,
    lastEditFile: null,
    lastEditContent: null,
    recentToolCalls: [],
    pendingAgentPrompt: null,
    pendingResumeRunId: null,
    pendingExpectedWorkflow: null,
    pendingWorkflowContext: null,
    activeAbortController: null,
    sandboxBridge: null,
    activeSkill: null,
    waveState: null,
    gaslight: null,
    memoryOrchestrator: null,
    verificationTrendTracker: null,
    planMode: false,
    currentPlan: null,
    planApproved: false,
    currentPlanId: null,
    planExecutionInProgress: false,
    planExecutionResult: null,
    approvalMode: "default",
    reasoningOverrideSession: false,
    theme: "default",
  } as unknown as ReplState;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const root of tempRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failures */
    }
  }
  tempRoots.length = 0;
});

// ─── getOrInitGaslight ──────────────────────────────────────────────────────

describe("getOrInitGaslight", () => {
  it("creates instance on first call", () => {
    const root = makeTempRoot("lazy-gl-");
    const state = makeMinimalState(root);
    expect(state.gaslight).toBeNull();
    const gl = getOrInitGaslight(state);
    expect(gl).toBeDefined();
    expect(state.gaslight).toBe(gl);
  });

  it("returns cached instance on second call", () => {
    const root = makeTempRoot("lazy-gl-cache-");
    const state = makeMinimalState(root);
    const first = getOrInitGaslight(state);
    const second = getOrInitGaslight(state);
    expect(first).toBe(second);
  });

  it("respects DANTECODE_GASLIGHT env var", () => {
    const root = makeTempRoot("lazy-gl-env-");
    const state = makeMinimalState(root);

    // Without env var — enabled by default (opt-out model)
    delete process.env["DANTECODE_GASLIGHT"];
    const gl1 = getOrInitGaslight(state);
    expect((gl1 as unknown as { enabled: boolean }).enabled).toBe(true);

    // With env var set to "0" — explicitly disabled
    state.gaslight = null;
    process.env["DANTECODE_GASLIGHT"] = "0";
    const gl2 = getOrInitGaslight(state);
    expect((gl2 as unknown as { enabled: boolean }).enabled).toBe(false);

    // Cleanup
    delete process.env["DANTECODE_GASLIGHT"];
  });
});

// ─── getOrInitMemory ────────────────────────────────────────────────────────

describe("getOrInitMemory", () => {
  it("creates and initializes on first call", async () => {
    const root = makeTempRoot("lazy-mem-");
    const state = makeMinimalState(root);
    expect(state.memoryOrchestrator).toBeNull();
    const mo = await getOrInitMemory(state);
    expect(mo).toBeDefined();
    expect(state.memoryOrchestrator).toBe(mo);
  });

  it("returns cached instance on second call", async () => {
    const root = makeTempRoot("lazy-mem-cache-");
    const state = makeMinimalState(root);
    const first = await getOrInitMemory(state);
    const second = await getOrInitMemory(state);
    expect(first).toBe(second);
  });

  it("returns null on init failure", async () => {
    shouldMemoryFail.value = true;
    try {
      const root = makeTempRoot("lazy-mem-fail-");
      const state = makeMinimalState(root);
      const mo = await getOrInitMemory(state);
      expect(mo).toBeNull();
      expect(state.memoryOrchestrator).toBeNull();
    } finally {
      shouldMemoryFail.value = false;
    }
  });
});

// ─── tryAutoInit ────────────────────────────────────────────────────────────

describe("tryAutoInit", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "ANTHROPIC_API_KEY",
    "XAI_API_KEY",
    "GROK_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GROQ_API_KEY",
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("returns state when ANTHROPIC_API_KEY is set", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    const root = makeTempRoot("auto-init-ant-");
    const state = await tryAutoInit(root);
    expect(state).not.toBeNull();
    expect(state!.model.default.provider).toBe("anthropic");
    expect(existsSync(join(root, ".dantecode", "STATE.yaml"))).toBe(true);
  });

  it("returns state when XAI_API_KEY is set", async () => {
    process.env["XAI_API_KEY"] = "xai-test";
    const root = makeTempRoot("auto-init-xai-");
    const state = await tryAutoInit(root);
    expect(state).not.toBeNull();
    expect(state!.model.default.provider).toBe("grok");
  });

  it("returns null when no keys and no ollama", async () => {
    const root = makeTempRoot("auto-init-none-");
    const state = await tryAutoInit(root);
    expect(state).toBeNull();
  });

  it("uses first detected provider when multiple keys present", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
    process.env["OPENAI_API_KEY"] = "sk-test";
    const root = makeTempRoot("auto-init-multi-");
    const state = await tryAutoInit(root);
    expect(state).not.toBeNull();
    // scanForApiKeys iterates PROVIDER_ENV_MAP which is: anthropic, grok, openai, google, groq
    expect(state!.model.default.provider).toBe("anthropic");
  });

  it("creates .dantecode directory and STATE.yaml", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test";
    const root = makeTempRoot("auto-init-dir-");
    expect(existsSync(join(root, ".dantecode"))).toBe(false);
    await tryAutoInit(root);
    expect(existsSync(join(root, ".dantecode"))).toBe(true);
    expect(existsSync(join(root, ".dantecode", "STATE.yaml"))).toBe(true);
  });

  it("returns state with ollama when no API keys but ollama available", async () => {
    mockExecFileSync.mockReturnValue(Buffer.from("/usr/bin/ollama"));
    const root = makeTempRoot("auto-init-ollama-");
    const state = await tryAutoInit(root);
    expect(state).not.toBeNull();
    expect(state!.model.default.provider).toBe("ollama");
  });
});
