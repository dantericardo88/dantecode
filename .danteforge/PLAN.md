# Implementation Plan: 9.7+ Final Polish Sprint

**Generated:** 2026-03-30
**Target:** 9.7+ ChatGPT score across all dimensions
**Status:** Phase 1.4 complete ✅, Phase 1.5-2.3 pending
**Timeline:** 10-12 hours remaining work

---

## Executive Summary

**Current State:** 9.5/10 with observability wiring complete (Phase 1.1-1.4)
**Target State:** 9.7+ with production-grade UX and comprehensive testing
**Strategy:** Complete observability tests → Add interactive UI components → Visual regression testing

**Completed Work:**
- ✅ Phase 1.1: Observability wiring into agent-loop (metrics + tracing) - commit 19478ef
- ✅ Phase 1.2: Observability wiring into model-router (metrics + tracing) - commit 19478ef
- ✅ Phase 1.3: Observability wiring into council-orchestrator (health checks) - commit 1c99e18
- ✅ Phase 1.4: CLI commands (/metrics, /traces, /health) - commit 5839106

**Remaining Work:**
- **Phase 1.5:** Observability integration tests (19 tests) - validates metrics/tracing/health
- **Phase 2.1:** Interactive UI components (Spinner/Toast/Menu) - CLI/VSCode polish
- **Phase 2.2:** Storybook setup - visual component documentation
- **Phase 2.3:** Playwright visual regression - baseline screenshots + CI integration

---

## Architecture Overview

### Inputs
- Existing observability wiring (agent-loop, model-router, council-orchestrator)
- ux-polish package with ProgressOrchestrator
- OSS patterns from kilocode/openhands (Storybook + Playwright configs)

### Outputs
- **19 integration tests** validating observability across all surfaces
- **3 new UI components** (Spinner, Toast, Menu) exported from ux-polish
- **Storybook configuration** with component stories for visual testing
- **Playwright visual regression suite** with baseline screenshots
- **CI workflow** (.github/workflows/visual-regression.yml) running on every PR

### Execution Model
1. **Test-first for observability** - validate existing wiring before adding new features
2. **Component-driven for UI** - build Spinner/Toast/Menu, then wire into CLI/VSCode
3. **Visual-first for regression** - establish baselines, then protect them in CI

---

## Phase 1.5: Observability Integration Tests (3 hours) [PRIORITY 1]

### Goal
Validate that metrics, traces, and health checks work end-to-end in agent-loop, model-router, and council-orchestrator.

### Why This Is Critical
The observability system is wired but not tested. We need to verify:
- Metrics collect correctly on every round
- Traces capture full span lifecycle
- Health checks reflect actual council state
- CLI commands return accurate data

Without these tests, the observability system could silently fail in production.

### Tasks

#### 1.5.1: Agent Loop Observability Tests [M] [P]
**File:** `packages/cli/src/agent-loop-observability.test.ts` (new)
**Effort:** 1.5 hours
**Parallelizable:** Yes (independent of other test files)

**Tests (8):**
1. ✓ Metrics are collected on round start/end
2. ✓ Round counter increments correctly
3. ✓ Tool call metrics track each tool invocation
4. ✓ Context token metrics track used/remaining
5. ✓ Trace spans are created for each round
6. ✓ Trace spans include metadata (roundNumber, sessionId, model)
7. ✓ Spans are properly closed on round completion
8. ✓ Spans capture errors when rounds fail

**Dependencies:** getAgentMetrics(), getAgentTraces() from agent-loop.ts

**Success criteria:**
- All 8 tests passing
- Coverage: agent-loop.ts observability code ≥ 85%
- No regressions in existing CLI tests

**Implementation approach:**
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentMetrics, getAgentTraces } from "./agent-loop.js";

describe("Agent Loop Observability", () => {
  beforeEach(() => {
    // Reset metrics/traces between tests via module-level reset
    const metrics = getAgentMetrics();
    const traces = getAgentTraces();
    // Clear state...
  });

  it("collects metrics on round start/end", async () => {
    // Simulate agent loop round with minimal fixtures
    const metricsBefore = getAgentMetrics();

    // Call agentLoop() with mock config/session/tools
    // ... execution ...

    const metricsAfter = getAgentMetrics();
    const roundMetric = metricsAfter.find(m => m.name === "agent.rounds.total");

    expect(roundMetric).toBeDefined();
    expect(roundMetric?.value).toBeGreaterThan(metricsBefore.find(m => m.name === "agent.rounds.total")?.value ?? 0);
  });

  it("trace spans include round metadata", async () => {
    // Execute one agent round
    // ... execution ...

    const traces = getAgentTraces();
    const spans = traces.flatMap(t => t.spans);
    const roundSpan = spans.find(s => s.name === "agent.round");

    expect(roundSpan?.attributes).toHaveProperty("roundNumber");
    expect(roundSpan?.attributes).toHaveProperty("sessionId");
    expect(roundSpan?.attributes).toHaveProperty("model");
  });
});
```

**Fixtures needed:**
- Minimal ReplState mock (from existing integration.test.ts)
- Mock tool executor (returns fake results)
- Mock model router (returns fake completions)

---

#### 1.5.2: Model Router Observability Tests [M] [P]
**File:** `packages/core/src/model-router-observability.test.ts` (new)
**Effort:** 1 hour
**Parallelizable:** Yes

**Tests (6):**
1. ✓ Request metrics increment on generate()
2. ✓ Token metrics track prompt/completion/total
3. ✓ Cost metrics estimate correctly per provider
4. ✓ Latency gauge updates on completion
5. ✓ Retry counter increments on transient errors
6. ✓ Trace spans capture provider/modelId metadata

**Dependencies:** getRouterMetrics(), getRouterTraces() from model-router.ts

**Success criteria:**
- All 6 tests passing
- Cost estimation accuracy validated for 3+ providers (Anthropic, OpenAI, Grok)
- Coverage: model-router.ts observability code ≥ 85%

**Implementation approach:**
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { ModelRouterImpl, getRouterMetrics, getRouterTraces } from "./model-router.js";

describe("Model Router Observability", () => {
  let router: ModelRouterImpl;

  beforeEach(() => {
    router = new ModelRouterImpl({
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      apiKey: "test-key",
    });
    // Reset metrics/traces
  });

  it("tracks token metrics correctly", async () => {
    const metricsBefore = getRouterMetrics();

    await router.generate({
      messages: [{ role: "user", content: "Hello" }],
      // ... config
    });

    const metricsAfter = getRouterMetrics();
    const promptTokens = metricsAfter.find(m => m.name === "model.tokens.prompt");
    const completionTokens = metricsAfter.find(m => m.name === "model.tokens.completion");

    expect(promptTokens?.value).toBeGreaterThan(0);
    expect(completionTokens?.value).toBeGreaterThan(0);
  });

  it("estimates cost correctly per provider", async () => {
    // Test Anthropic rates
    const result = await router.generate({...});
    const costMetric = getRouterMetrics().find(m => m.name === "model.cost.usd");

    // Anthropic Sonnet 4.6: $3/M input, $15/M output
    const expectedCost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    expect(costMetric?.value).toBeCloseTo(expectedCost, 6);
  });
});
```

**Cost estimation test data:**
- Anthropic Claude Sonnet 4.6: $3/M input, $15/M output
- OpenAI GPT-4: $5/M input, $15/M output
- Grok Beta: $0/M (free tier)

---

#### 1.5.3: Council Health Tests [M] [P]
**File:** `packages/core/src/council/council-health.test.ts` (new)
**Effort:** 0.5 hours
**Parallelizable:** Yes

**Tests (5):**
1. ✓ Health checks return "healthy" when all lanes succeed
2. ✓ Health checks return "degraded" when some lanes fail
3. ✓ Health checks return "unhealthy" when all lanes fail
4. ✓ Fleet budget health reflects remaining budget
5. ✓ Orchestrator state health reflects current status

**Dependencies:** CouncilOrchestrator.getHealthReport()

**Success criteria:**
- All 5 tests passing
- Health check timeout protection verified (3s)
- Coverage: council-orchestrator.ts health code ≥ 85%

**Implementation approach:**
```typescript
import { describe, it, expect } from "vitest";
import { CouncilOrchestrator } from "./council-orchestrator.js";

describe("Council Health Checks", () => {
  it("returns healthy when all lanes succeed", async () => {
    const orchestrator = new CouncilOrchestrator({...});

    // Start council with simple tasks that will succeed
    await orchestrator.start({
      lanes: [
        { agentId: "lane1", task: "echo success" },
      ],
    });

    const health = await orchestrator.getHealthReport();
    expect(health.status).toBe("healthy");
    expect(health.checks.find(c => c.name === "lanes")?.status).toBe("healthy");
  });

  it("returns degraded when some lanes fail", async () => {
    const orchestrator = new CouncilOrchestrator({...});

    // Mix of success and failure
    await orchestrator.start({
      lanes: [
        { agentId: "lane1", task: "echo success" },
        { agentId: "lane2", task: "exit 1" }, // This will fail
      ],
    });

    const health = await orchestrator.getHealthReport();
    expect(health.status).toBe("degraded");
  });

  it("fleet budget health reflects remaining budget", async () => {
    const orchestrator = new CouncilOrchestrator({
      budget: { maxTokens: 10000 },
    });

    await orchestrator.start({...});

    // Simulate token usage
    // ...

    const health = await orchestrator.getHealthReport();
    const budgetCheck = health.checks.find(c => c.name === "fleet-budget");

    expect(budgetCheck).toBeDefined();
    expect(budgetCheck?.status).toBe("degraded"); // if < 1000 tokens remaining
  });
});
```

---

### Phase 1.5 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Metrics/traces are module-level singletons - test isolation may be fragile | High | Medium | Add reset() methods to MetricCounter and TraceRecorder, or clear Maps in beforeEach |
| Agent loop tests require full dependency mocking (config, session, tools) | Medium | Medium | Extract minimal fixtures from existing integration.test.ts |
| Cost estimation tests may drift as provider pricing changes | Low | Low | Use hardcoded test rates, add comment linking to provider docs |
| Health check tests may be timing-sensitive | Low | Low | Use explicit state assertions, not time-based waits |

**Mitigation plan for module singletons:**
```typescript
// In packages/observability/src/metric-counter.ts
export function resetMetrics(): void {
  // Clear all maps - used by tests only
}

// In test setup
beforeEach(() => {
  resetMetrics();
  resetTraces();
});
```

---

## Phase 2.1: Interactive UI Components (4 hours)

### Goal
Add Spinner, Toast, and Menu components to ux-polish for CLI and VSCode surfaces.

### Why This Matters for 9.7+
Current CLI output is text-only. Competitors (Aider, Cursor, Windsurf) have rich progress indicators, notifications, and interactive menus. Adding these components brings DanteCode UX to parity.

**ChatGPT scoring impact:**
- UX/Ergonomics: 7.8 → 9.0 (spinners, toasts, menus improve perceived responsiveness)
- User Satisfaction: 8.2 → 9.0 (professional polish vs bare CLI)

### Tasks

#### 2.1.1: Spinner Component [M]
**File:** `packages/ux-polish/src/components/spinner.ts` (new)
**Effort:** 1 hour
**Parallelizable:** Yes (independent of Toast/Menu)

**Requirements:**
- ANSI-based CLI spinner with 8-frame animation (⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧)
- Configurable text/color/speed
- Auto-stops on process exit
- VSCode-compatible (no ANSI in output channel)

**API design:**
```typescript
export class Spinner {
  constructor(options?: SpinnerOptions);
  start(text?: string): void;
  update(text: string): void;
  stop(finalText?: string, symbol?: string): void;
  succeed(text?: string): void; // Shows ✓ in green
  fail(text?: string): void;    // Shows ✗ in red
  warn(text?: string): void;    // Shows ⚠ in yellow
  info(text?: string): void;    // Shows ℹ in cyan
}

export interface SpinnerOptions {
  text?: string;
  color?: "cyan" | "yellow" | "green" | "red";
  interval?: number; // default 80ms
  stream?: NodeJS.WriteStream; // default process.stderr
  spinner?: SpinnerFrames; // default "dots"
}

export interface SpinnerFrames {
  frames: string[];
  interval?: number;
}

export const SPINNERS = {
  dots: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] },
  line: { frames: ["-", "\\", "|", "/"] },
  arrow: { frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"] },
} as const;
```

**Test coverage (4 tests):**
```typescript
describe("Spinner", () => {
  it("starts and stops correctly", () => {
    const spinner = new Spinner({ text: "Loading..." });
    spinner.start();
    expect(spinner.isSpinning).toBe(true);
    spinner.stop();
    expect(spinner.isSpinning).toBe(false);
  });

  it("cycles through all frames", async () => {
    const frames: string[] = [];
    const spinner = new Spinner({ interval: 10 });

    // Capture frames for 100ms
    spinner.start();
    await new Promise(r => setTimeout(r, 100));
    // ... verify frames cycled
  });

  it("succeed() shows green checkmark", () => {
    const output = captureOutput(() => {
      const spinner = new Spinner();
      spinner.start();
      spinner.succeed("Done!");
    });

    expect(output).toContain("✓");
    expect(output).toContain("Done!");
  });

  it("disables ANSI in VSCode mode", () => {
    process.env.VSCODE_PID = "12345";
    const spinner = new Spinner();
    spinner.start("Test");
    // Verify no ANSI codes in output
  });
});
```

**Inspiration:** ora (npm package - 12M downloads/week)

---

#### 2.1.2: Toast Component [M]
**File:** `packages/ux-polish/src/components/toast.ts` (new)
**Effort:** 1.5 hours
**Parallelizable:** Yes

**Requirements:**
- Non-blocking notification system
- 4 levels: info, success, warning, error
- Auto-dismiss after 3s (configurable)
- Queue management (max 3 visible)
- Themed colors via ThemeEngine

**API design:**
```typescript
export class ToastManager {
  info(message: string, options?: ToastOptions): Toast;
  success(message: string, options?: ToastOptions): Toast;
  warning(message: string, options?: ToastOptions): Toast;
  error(message: string, options?: ToastOptions): Toast;
  dismiss(id: string): void;
  dismissAll(): void;
  clear(): void;
}

export interface ToastOptions {
  duration?: number; // default 3000ms, 0 = persistent
  action?: { label: string; callback: () => void };
  dismissible?: boolean; // default true
}

export interface Toast {
  id: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  createdAt: number;
  dismissedAt?: number;
}

// Singleton instance
export const toasts = new ToastManager();
```

**Test coverage (5 tests):**
```typescript
describe("ToastManager", () => {
  it("auto-dismisses after duration", async () => {
    const manager = new ToastManager();
    const toast = manager.info("Test", { duration: 100 });

    expect(manager.getVisible()).toHaveLength(1);
    await new Promise(r => setTimeout(r, 150));
    expect(manager.getVisible()).toHaveLength(0);
  });

  it("limits queue to 3 visible toasts", () => {
    const manager = new ToastManager();
    manager.info("Toast 1");
    manager.info("Toast 2");
    manager.info("Toast 3");
    manager.info("Toast 4"); // Should dismiss oldest

    const visible = manager.getVisible();
    expect(visible).toHaveLength(3);
    expect(visible[0].message).toBe("Toast 2"); // Toast 1 dismissed
  });

  it("persistent toasts don't auto-dismiss", async () => {
    const manager = new ToastManager();
    manager.info("Persistent", { duration: 0 });

    await new Promise(r => setTimeout(r, 5000));
    expect(manager.getVisible()).toHaveLength(1);
  });

  it("action callbacks fire correctly", () => {
    const manager = new ToastManager();
    const callback = vi.fn();
    manager.info("Action toast", { action: { label: "Click", callback } });

    // Simulate click
    const toast = manager.getVisible()[0];
    toast.action?.callback();
    expect(callback).toHaveBeenCalled();
  });

  it("colors match theme for each level", () => {
    const manager = new ToastManager();
    const infoToast = manager.info("Info");
    const errorToast = manager.error("Error");

    expect(infoToast.color).toBe("cyan");
    expect(errorToast.color).toBe("red");
  });
});
```

**Inspiration:** sonner (React toast library), VSCode notifications API

---

#### 2.1.3: Menu Component [M]
**File:** `packages/ux-polish/src/components/menu.ts` (new)
**Effort:** 1.5 hours
**Parallelizable:** Yes

**Requirements:**
- Interactive CLI menu with arrow key navigation
- Single-select and multi-select modes
- Search/filter support (fuzzy matching)
- Keyboard shortcuts (j/k, /, Enter, Esc, Space)
- Themed rendering via ThemeEngine

**API design:**
```typescript
export async function showMenu<T>(options: MenuOptions<T>): Promise<T | T[] | null> {
  // Returns selected item(s) or null if cancelled
}

export interface MenuOptions<T> {
  title: string;
  items: MenuItem<T>[];
  multi?: boolean; // default false
  searchable?: boolean; // default true
  defaultIndex?: number;
  theme?: ThemeEngine;
  pageSize?: number; // default 10
}

export interface MenuItem<T> {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
}

export interface MenuResult<T> {
  selected: T | T[] | null;
  cancelled: boolean;
}
```

**Test coverage (6 tests):**
```typescript
describe("Menu", () => {
  it("arrow keys navigate up/down", async () => {
    // Simulate key input
    const result = simulateKeys(["down", "down", "enter"], () =>
      showMenu({
        title: "Select",
        items: [
          { label: "Option 1", value: 1 },
          { label: "Option 2", value: 2 },
          { label: "Option 3", value: 3 },
        ],
      })
    );

    expect(result).toBe(3); // Third option selected
  });

  it("Enter selects item", async () => {
    const result = simulateKeys(["enter"], () =>
      showMenu({
        title: "Select",
        items: [{ label: "Only", value: "only" }],
      })
    );

    expect(result).toBe("only");
  });

  it("Escape cancels", async () => {
    const result = simulateKeys(["escape"], () =>
      showMenu({
        title: "Select",
        items: [{ label: "Option", value: 1 }],
      })
    );

    expect(result).toBeNull();
  });

  it("multi-select toggles with Space", async () => {
    const result = simulateKeys(["space", "down", "space", "enter"], () =>
      showMenu({
        title: "Select",
        items: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
        multi: true,
      })
    );

    expect(result).toEqual(["a", "b"]);
  });

  it("search filters items", async () => {
    const menu = createMenu({
      items: [
        { label: "Apple", value: "apple" },
        { label: "Banana", value: "banana" },
        { label: "Cherry", value: "cherry" },
      ],
      searchable: true,
    });

    menu.setSearch("an");
    expect(menu.getVisibleItems()).toHaveLength(1); // Only "Banana"
  });

  it("disabled items cannot be selected", async () => {
    const result = simulateKeys(["down", "enter"], () =>
      showMenu({
        title: "Select",
        items: [
          { label: "Enabled", value: 1 },
          { label: "Disabled", value: 2, disabled: true },
        ],
      })
    );

    // Pressing down should skip disabled item
    expect(result).toBe(1);
  });
});
```

**Inspiration:** inquirer (npm), @clack/prompts, ink-select-input

---

#### 2.1.4: Wire Components into CLI [L]
**Files:**
- `packages/cli/src/slash-commands.ts` (use Spinner in long commands)
- `packages/cli/src/repl.ts` (use Toast for notifications)
- `packages/cli/src/fuzzy-finder.ts` (replace with Menu)

**Effort:** 1 hour

**Changes:**

**1. Replace manual progress with Spinner:**
```typescript
// Before (in /forge command)
console.log("Starting autoforge...");
const result = await runAutoforge(...);
console.log("Autoforge complete!");

// After
import { Spinner } from "@dantecode/ux-polish";

const spinner = new Spinner({ text: "Starting autoforge..." });
spinner.start();
const result = await runAutoforge(...);
spinner.succeed("Autoforge complete!");
```

**2. Use Toast for notifications:**
```typescript
// Before (in slash commands)
return "✓ Commit created successfully";

// After
import { toasts } from "@dantecode/ux-polish";

toasts.success("Commit created successfully");
return ""; // Toast is already shown
```

**3. Replace fuzzy-finder with Menu:**
```typescript
// Before (fuzzy-finder.ts)
const selected = await fuzzySearch(files);

// After
import { showMenu } from "@dantecode/ux-polish";

const selected = await showMenu({
  title: "Select a file",
  items: files.map(f => ({ label: f.path, value: f })),
  searchable: true,
});
```

**Success criteria:**
- `/forge` shows spinner during execution
- Successful commands show success toast
- `/find` uses Menu for file selection
- No breaking changes to existing command output

---

### Phase 2.1 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CLI components don't render correctly in VSCode output channel | High | High | Add VSCode detection (process.env.VSCODE_PID), disable ANSI/interactivity |
| Menu navigation breaks on Windows PowerShell | Medium | Medium | Use readline for cross-platform key input, test on Windows CI |
| Toast queue overflows in rapid command execution | Low | Low | Implement circular queue with max 3 visible, auto-dismiss oldest |
| Spinner doesn't clear properly on SIGINT | Medium | Low | Register cleanup handler for process.on("SIGINT") |

**VSCode detection pattern:**
```typescript
export function isVSCode(): boolean {
  return !!process.env.VSCODE_PID || !!process.env.VSCODE_GIT_ASKPASS_NODE;
}

export function supportsInteractivity(): boolean {
  return process.stdout.isTTY && !isVSCode();
}
```

---

## Phase 2.2: Storybook Setup (2 hours)

### Goal
Set up Storybook for visual documentation of ux-polish components.

### Why This Matters
Storybook provides:
1. **Visual regression baseline** - screenshots for Playwright tests
2. **Component documentation** - interactive playground for developers
3. **Isolation testing** - components render correctly in all states

Without Storybook, we can't run visual regression tests (Phase 2.3).

### Tasks

#### 2.2.1: Install Storybook [S]
**Effort:** 30 minutes
**Parallelizable:** No (blocks 2.2.2)

**Commands:**
```bash
npm install --save-dev --workspace=packages/ux-polish \
  @storybook/react-vite@^8.0.0 \
  @storybook/addon-essentials@^8.0.0 \
  @storybook/addon-interactions@^8.0.0 \
  @storybook/test@^8.0.0 \
  react@^18.0.0 \
  react-dom@^18.0.0 \
  vite@^5.0.0 \
  ansi-to-html@^0.7.0
```

**Files to create:**
- `packages/ux-polish/.storybook/main.ts` (new)
- `packages/ux-polish/.storybook/preview.tsx` (new)

**Config pattern (adapted from kilocode):**
```typescript
// main.ts
import type { StorybookConfig } from "@storybook/react-vite";
import { dirname, join } from "path";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: [
    "@storybook/addon-essentials",
    "@storybook/addon-interactions",
  ],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  docs: {
    autodocs: "tag",
  },
  viteFinal: async (config) => {
    // Ensure TypeScript resolves correctly
    return config;
  },
};

export default config;
```

```typescript
// preview.tsx
import type { Preview } from "@storybook/react";
import { ThemeEngine } from "../src/theme-engine.js";

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
  },
  decorators: [
    (Story) => {
      // Wrap stories in theme provider
      return (
        <div style={{ padding: "2rem", background: "#1e1e1e", color: "#d4d4d4" }}>
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
```

**Success criteria:**
- `npm run storybook --workspace=packages/ux-polish` starts dev server
- Server accessible at http://localhost:6006
- No console errors on startup

---

#### 2.2.2: Create Component Stories [M]
**Effort:** 1.5 hours
**Parallelizable:** No (requires 2.2.1 complete)

**Files to create:**
- `packages/ux-polish/src/components/spinner.stories.tsx` (new)
- `packages/ux-polish/src/components/toast.stories.tsx` (new)
- `packages/ux-polish/src/components/menu.stories.tsx` (new)

**Story pattern (Component Story Format 3.0):**
```typescript
// spinner.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { Spinner } from "./spinner.js";
import { useEffect, useRef } from "react";
import Convert from "ansi-to-html";

const convert = new Convert();

// React wrapper for CLI component
function SpinnerWrapper({ text, color }: { text: string; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const spinner = new Spinner({ text, color });
    spinner.start();

    // Capture ANSI output
    const originalWrite = process.stderr.write;
    let output = "";

    process.stderr.write = (chunk: any) => {
      output += chunk.toString();
      if (containerRef.current) {
        containerRef.current.innerHTML = convert.toHtml(output);
      }
      return true;
    };

    return () => {
      spinner.stop();
      process.stderr.write = originalWrite;
    };
  }, [text, color]);

  return <div ref={containerRef} style={{ fontFamily: "monospace" }} />;
}

const meta: Meta<typeof SpinnerWrapper> = {
  title: "Components/Spinner",
  component: SpinnerWrapper,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof SpinnerWrapper>;

export const Default: Story = {
  args: {
    text: "Loading...",
    color: "cyan",
  },
};

export const Success: Story = {
  args: {
    text: "Success!",
    color: "green",
  },
};

export const Error: Story = {
  args: {
    text: "Failed!",
    color: "red",
  },
};
```

**Stories to create (6 total):**

**Spinner:**
1. Default (cyan, "Loading...")
2. Success (green, checkmark)
3. Error (red, X)

**Toast:**
1. Info notification
2. Success notification
3. Error notification

**Menu:**
1. Single-select
2. Multi-select
3. With search

**Success criteria:**
- All 6 stories render correctly in Storybook
- ANSI codes convert to styled HTML
- Controls work (can change text/color/level)
- No console errors when switching stories

---

### Phase 2.2 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Storybook doesn't support CLI components (no React wrapper) | High | High | Create thin React wrappers that render ANSI output in `<pre>` using ansi-to-html |
| ANSI codes don't render in Storybook | High | Medium | Use ansi-to-html addon to convert ANSI to styled HTML |
| Stories are static (components need to animate) | Medium | Low | Use useEffect to start animations, cleanup on unmount |

**React wrapper pattern for CLI components:**
```typescript
// Generic wrapper for ANSI components
function ANSIComponentWrapper({
  render
}: {
  render: (container: HTMLElement) => () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cleanup = render(containerRef.current);
    return cleanup;
  }, [render]);

  return (
    <div
      ref={containerRef}
      style={{
        fontFamily: "monospace",
        whiteSpace: "pre-wrap"
      }}
    />
  );
}
```

---

## Phase 2.3: Playwright Visual Regression (3 hours)

### Goal
Set up Playwright visual regression testing with baseline screenshots and CI integration.

### Why This Is Critical for 9.7+
Visual regression tests catch:
- **Unintended style changes** - color/spacing/font changes
- **Layout breaks** - components overlapping or misaligned
- **Cross-browser issues** - rendering differences in Chromium/Firefox/Safari

Without visual tests, UI regressions slip through code review.

**ChatGPT scoring impact:**
- Quality/Reliability: 8.8 → 9.5 (automated visual testing)
- Testing Coverage: 8.5 → 9.0 (comprehensive test suite)

### Tasks

#### 2.3.1: Install Playwright [S]
**Effort:** 15 minutes
**Parallelizable:** Yes (can run parallel with 2.2)

**Commands:**
```bash
npm install --save-dev @playwright/test@^1.40.0
npx playwright install chromium
```

**Files to create:**
- `playwright.config.ts` (new, at repo root)

**Config pattern (adapted from kilocode + openhands):**
```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",

  use: {
    baseURL: "http://localhost:6006",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  webServer: {
    command: "npm run storybook --workspace=packages/ux-polish",
    url: "http://localhost:6006",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes for Storybook to start
  },
});
```

**Success criteria:**
- `npx playwright test --list` shows test files
- Config validation passes
- Chromium browser installed

---

#### 2.3.2: Create Visual Tests [M]
**Effort:** 2 hours
**Parallelizable:** No (requires 2.2.2 complete)

**File to create:**
- `tests/visual/components.spec.ts` (new)

**Tests (6):**
1. ✓ Spinner default state matches baseline
2. ✓ Spinner success state matches baseline
3. ✓ Toast info notification matches baseline
4. ✓ Toast error notification matches baseline
5. ✓ Menu single-select matches baseline
6. ✓ Menu multi-select matches baseline

**Test pattern:**
```typescript
import { test, expect } from "@playwright/test";

test.describe("Spinner Component", () => {
  test("default state", async ({ page }) => {
    await page.goto("/iframe.html?id=components-spinner--default");

    // Wait for component to render
    await page.locator("[data-testid='spinner']").waitFor();

    // Wait for animation frame (80ms interval)
    await page.waitForTimeout(100);

    // Take screenshot
    await expect(page).toHaveScreenshot("spinner-default.png", {
      maxDiffPixels: 100, // Allow minor font rendering differences
    });
  });

  test("success state", async ({ page }) => {
    await page.goto("/iframe.html?id=components-spinner--success");
    await page.locator("[data-testid='spinner']").waitFor();
    await expect(page).toHaveScreenshot("spinner-success.png");
  });
});

test.describe("Toast Component", () => {
  test("info notification", async ({ page }) => {
    await page.goto("/iframe.html?id=components-toast--info");

    // Wait for toast to appear
    await page.locator(".toast").waitFor();

    await expect(page).toHaveScreenshot("toast-info.png");
  });

  test("error notification", async ({ page }) => {
    await page.goto("/iframe.html?id=components-toast--error");
    await page.locator(".toast").waitFor();
    await expect(page).toHaveScreenshot("toast-error.png");
  });
});

test.describe("Menu Component", () => {
  test("single-select", async ({ page }) => {
    await page.goto("/iframe.html?id=components-menu--single-select");
    await page.locator("[role='menu']").waitFor();
    await expect(page).toHaveScreenshot("menu-single-select.png");
  });

  test("multi-select", async ({ page }) => {
    await page.goto("/iframe.html?id=components-menu--multi-select");
    await page.locator("[role='menu']").waitFor();

    // Select first item to show checkmark
    await page.locator("[role='menuitem']").first().click();

    await expect(page).toHaveScreenshot("menu-multi-select.png");
  });
});
```

**Baseline generation:**
```bash
# First run generates baselines
npx playwright test

# Baselines stored in tests/visual/components.spec.ts-snapshots/
# chromium/spinner-default.png
# chromium/spinner-success.png
# chromium/toast-info.png
# chromium/toast-error.png
# chromium/menu-single-select.png
# chromium/menu-multi-select.png
```

**Success criteria:**
- First run generates 6 baseline screenshots
- Second run passes all 6 tests (comparing to baselines)
- Baselines committed to repo
- Diff threshold (maxDiffPixels: 100) accounts for font rendering

---

#### 2.3.3: Add CI Workflow [S]
**Effort:** 45 minutes
**Parallelizable:** Yes (can prepare while 2.3.2 runs)

**File to create:**
- `.github/workflows/visual-regression.yml` (new)

**Workflow:**
```yaml
name: Visual Regression

on:
  pull_request:
    paths:
      - "packages/ux-polish/**"
      - "tests/visual/**"
      - "playwright.config.ts"
      - ".storybook/**"
  push:
    branches:
      - main
      - feat/**

jobs:
  visual-regression:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Build ux-polish
        run: npm run build --workspace=packages/ux-polish

      - name: Run visual regression tests
        run: npx playwright test

      - name: Upload test results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: visual-regression-diff
          path: |
            test-results/
            playwright-report/
          retention-days: 7

      - name: Comment PR with results
        if: failure() && github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const comment = `## ⚠️ Visual Regression Failures

            Visual tests failed. Download artifacts to see diffs:
            - [Visual Regression Report](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }})

            To update baselines:
            \`\`\`bash
            npx playwright test --update-snapshots
            \`\`\`
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

**Success criteria:**
- Workflow runs on PR changes to ux-polish
- Workflow uses baseline screenshots from repo
- Visual diffs uploaded as artifacts on failure
- PR comment posted with download link

**Testing the workflow:**
```bash
# 1. Create test PR
git checkout -b test/visual-regression
git add .
git commit -m "test: visual regression workflow"
git push origin test/visual-regression

# 2. Open PR on GitHub
# 3. Verify workflow runs
# 4. Verify baselines used (not regenerated)
```

---

### Phase 2.3 Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Baseline screenshots differ between local and CI (font rendering) | High | High | Generate baselines in CI, commit them, use same Chrome version locally (Chromium 120) |
| Storybook takes too long to start in CI | Medium | Low | Cache node_modules, use reuseExistingServer, increase timeout to 2 minutes |
| Baseline drift over time as components evolve | Medium | Medium | Use --update-snapshots to regenerate, review diffs in PR |
| Tests flaky due to animation timing | Low | Low | Add explicit waitForTimeout for animations, use data-testid selectors |

**Baseline consistency strategy:**
```bash
# Generate baselines in CI (first time)
name: Generate Visual Baselines
on:
  workflow_dispatch: # Manual trigger

jobs:
  generate-baselines:
    runs-on: ubuntu-latest
    steps:
      - # ... setup ...
      - run: npx playwright test --update-snapshots
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: "chore: update visual regression baselines"
          file_pattern: "tests/visual/**/*.png"
```

---

## Implementation Order & Timeline

### Week 1: Observability Tests + UI Foundation
**Monday (Day 1):**
- Morning: Phase 1.5.1 - Agent loop observability tests (8 tests) - 1.5h
- Afternoon: Phase 1.5.2 - Model router observability tests (6 tests) - 1h
- Evening: Phase 1.5.3 - Council health tests (5 tests) - 0.5h
- **Total:** 3 hours - **COMPLETE Phase 1.5 ✓**

**Tuesday (Day 2):**
- Morning: Phase 2.1.1 - Spinner component - 1h
- Afternoon: Phase 2.1.2 - Toast component - 1.5h
- **Total:** 2.5 hours

**Wednesday (Day 3):**
- Morning: Phase 2.1.3 - Menu component - 1.5h
- Afternoon: Phase 2.1.4 - Wire components into CLI - 1h
- **Total:** 2.5 hours - **COMPLETE Phase 2.1 ✓**

### Week 2: Visual Testing Infrastructure
**Thursday (Day 4):**
- Morning: Phase 2.2.1 - Install Storybook - 0.5h
- Afternoon: Phase 2.2.2 - Create component stories - 1.5h
- **Total:** 2 hours - **COMPLETE Phase 2.2 ✓**

**Friday (Day 5):**
- Morning: Phase 2.3.1 - Install Playwright - 0.25h
- Morning: Phase 2.3.2 - Create visual tests - 2h
- Afternoon: Phase 2.3.3 - Add CI workflow - 0.75h
- **Total:** 3 hours - **COMPLETE Phase 2.3 ✓**

**Total Estimated Time:** 13 hours
**Elapsed Calendar Time:** 5 working days (1 week sprint)

---

## Success Metrics & Verification

### Phase 1.5 Success Criteria
- ✅ 19 observability tests passing (8 agent + 6 router + 5 council)
- ✅ Test coverage ≥ 85% for observability code paths
- ✅ No regressions in existing CLI tests (current: 323/323 passing)
- ✅ Metrics reset correctly between tests (no singleton pollution)

### Phase 2.1 Success Criteria
- ✅ Spinner, Toast, Menu components exported from ux-polish
- ✅ 15 component tests passing (4 Spinner + 5 Toast + 6 Menu)
- ✅ CLI commands use new components (visible in `/forge`, `/find`)
- ✅ VSCode compatibility verified (no ANSI in output channel)

### Phase 2.2 Success Criteria
- ✅ Storybook dev server starts (`npm run storybook`)
- ✅ 6+ stories rendering correctly (2 per component)
- ✅ ANSI codes render as styled HTML (ansi-to-html working)
- ✅ Controls work (can change text/color/level)

### Phase 2.3 Success Criteria
- ✅ 6 visual regression tests passing
- ✅ Baseline screenshots committed to repo (6 PNG files)
- ✅ CI workflow green on sample PR
- ✅ Visual diffs upload as artifacts on failure

### Overall Success (9.7+ Target)
- ✅ All gates green (typecheck, lint, test, format)
- ✅ Total test count: 323 (CLI) + 19 (observability) + 15 (components) + 6 (visual) = 363 tests
- ✅ ChatGPT re-scoring: 9.5 → 9.7+ confirmed
- ✅ Zero anti-stub violations
- ✅ Zero breaking changes (all existing tests pass)

### Gate Commands
```bash
# Run all gates
npm run typecheck   # Expect: 0 errors
npm run lint        # Expect: 0 errors, 16 warnings (pre-existing)
npm run test        # Expect: All tests passing
npm run format      # Expect: All files formatted

# Run visual regression
npx playwright test # Expect: 6/6 passing

# Run observability tests
npm run test --workspace=packages/cli -- agent-loop-observability  # 8/8
npm run test --workspace=packages/core -- model-router-observability  # 6/6
npm run test --workspace=packages/core -- council-health  # 5/5
```

---

## File-Level Change Map

### New Files (21)

**Phase 1.5 (Tests):**
```
packages/cli/src/agent-loop-observability.test.ts
packages/core/src/model-router-observability.test.ts
packages/core/src/council/council-health.test.ts
```

**Phase 2.1 (Components):**
```
packages/ux-polish/src/components/spinner.ts
packages/ux-polish/src/components/spinner.test.ts
packages/ux-polish/src/components/toast.ts
packages/ux-polish/src/components/toast.test.ts
packages/ux-polish/src/components/menu.ts
packages/ux-polish/src/components/menu.test.ts
```

**Phase 2.2 (Storybook):**
```
packages/ux-polish/.storybook/main.ts
packages/ux-polish/.storybook/preview.tsx
packages/ux-polish/src/components/spinner.stories.tsx
packages/ux-polish/src/components/toast.stories.tsx
packages/ux-polish/src/components/menu.stories.tsx
```

**Phase 2.3 (Visual Tests):**
```
tests/visual/components.spec.ts
playwright.config.ts
.github/workflows/visual-regression.yml
tests/visual/components.spec.ts-snapshots/chromium/spinner-default.png
tests/visual/components.spec.ts-snapshots/chromium/spinner-success.png
tests/visual/components.spec.ts-snapshots/chromium/toast-info.png
tests/visual/components.spec.ts-snapshots/chromium/toast-error.png
tests/visual/components.spec.ts-snapshots/chromium/menu-single-select.png
tests/visual/components.spec.ts-snapshots/chromium/menu-multi-select.png
```

### Modified Files (7)

**Phase 1.5:**
```
packages/observability/src/metric-counter.ts (add resetMetrics())
packages/observability/src/trace-recorder.ts (add resetTraces())
```

**Phase 2.1:**
```
packages/ux-polish/src/index.ts (export Spinner, Toast, Menu)
packages/cli/src/slash-commands.ts (use Spinner/Toast)
packages/cli/src/repl.ts (use Toast for notifications)
packages/cli/src/fuzzy-finder.ts (use Menu)
```

**Phase 2.2:**
```
packages/ux-polish/package.json (add Storybook dependencies)
```

---

## Technology Decisions & Rationale

### Testing Framework
**Decision:** Vitest for unit/integration, Playwright for visual
**Rationale:**
- Vitest already in use (2023 existing tests)
- Playwright is industry standard for visual regression (better than Puppeteer)
- Single tool chain avoids fragmentation

**Alternatives considered:**
- Jest → Rejected (slower, less modern)
- Cypress → Rejected (heavier, overkill for visual-only)

### Component Architecture
**Decision:** Pure TypeScript CLI components, no React dependency
**Rationale:**
- CLI components don't need React runtime
- ANSI escape codes are simpler than JSX
- Smaller bundle size (Spinner: ~2KB vs ora: ~50KB with deps)

**Alternatives considered:**
- ink (React for CLI) → Rejected (heavy, 300KB+ deps)
- blessed → Rejected (unmaintained)

### Storybook Setup
**Decision:** @storybook/react-vite with ansi-to-html
**Rationale:**
- Vite already in use (fastest build)
- React wrappers minimal (~20 LOC each)
- ansi-to-html preserves ANSI styling in browser

**Alternatives considered:**
- @storybook/html → Rejected (worse TypeScript support)
- Custom docs site → Rejected (reinventing wheel)

### Visual Regression Strategy
**Decision:** Chromium-only, ubuntu-latest runner, baselines in CI
**Rationale:**
- Chromium sufficient for component testing (not cross-browser product)
- ubuntu-latest has consistent font rendering (no macOS/Windows drift)
- CI-generated baselines ensure local/CI parity

**Alternatives considered:**
- Percy/Chromatic → Rejected (paid services)
- Cross-browser (Chrome/Firefox/Safari) → Rejected (overkill, 3x slower)
- Snapshot testing → Rejected (DOM snapshots, not visual)

### CI Strategy
**Decision:** GitHub Actions, on-demand workflow for baselines
**Rationale:**
- GitHub Actions already in use (4 existing workflows)
- Free for public repos
- Artifact storage for diffs (7-day retention)

**Alternatives considered:**
- GitLab CI → Rejected (not our platform)
- CircleCI → Rejected (limited free tier)

---

## Risk Summary & Mitigation Strategy

### High-Priority Risks

| Risk | Probability | Impact | Mitigation | Owner |
|------|-------------|--------|------------|-------|
| Test isolation fragile (module singletons) | High | Medium | Add resetMetrics()/resetTraces() | Phase 1.5 |
| CLI components break in VSCode | High | High | Add isVSCode() detection, disable ANSI | Phase 2.1 |
| Visual baselines differ (local vs CI) | High | High | Generate in CI, commit, lock Chrome version | Phase 2.3 |
| Storybook slow in CI | Medium | Low | Cache node_modules, 2min timeout | Phase 2.2 |
| Component tests flaky on Windows | Medium | Medium | Use readline for input, test on Windows CI | Phase 2.1 |

### Medium-Priority Risks

| Risk | Probability | Impact | Mitigation | Owner |
|------|-------------|--------|------------|-------|
| Toast queue overflows | Low | Low | Circular queue, max 3 visible | Phase 2.1 |
| Animation timing flaky | Low | Low | Explicit waitForTimeout in tests | Phase 2.3 |
| Cost estimation drift | Low | Low | Hardcoded test rates, comment with source | Phase 1.5 |

### Risk Mitigation Patterns

**Pattern 1: Feature Detection**
```typescript
// Detect environment capabilities before using features
export function supportsANSI(): boolean {
  return process.stdout.isTTY && !isVSCode();
}

export function supportsInteractivity(): boolean {
  return process.stdin.isTTY && !isCI();
}

// Use in components
if (supportsANSI()) {
  // Render with ANSI codes
} else {
  // Fallback to plain text
}
```

**Pattern 2: Test Isolation**
```typescript
// Clear module-level state in beforeEach
beforeEach(() => {
  resetMetrics();
  resetTraces();
  resetToasts();
});

// Implement reset methods
export function resetMetrics(): void {
  agentMetrics = new MetricCounter();
  routerMetrics = new MetricCounter();
}
```

**Pattern 3: Baseline Consistency**
```bash
# Generate baselines in CI environment
docker run -v $(pwd):/work -w /work mcr.microsoft.com/playwright:v1.40.0-jammy \
  npx playwright test --update-snapshots

# Commit generated baselines
git add tests/visual/**/*.png
git commit -m "chore: update visual regression baselines [skip ci]"
```

---

## Constraints & Non-Negotiables

### Hard Constraints (CONSTITUTION Rules)
1. **No breaking changes** - all existing 323 CLI tests must pass
2. **Production-ready code only** - zero stubs, zero TODOs, zero placeholders
3. **Full test coverage** - every component ≥ 80% branch coverage
4. **Anti-stub scanner** - all generated code passes DanteForge gates
5. **PDSE quality gate** - all files score ≥ 85/100 before commit
6. **No secrets** - zero API keys, tokens, or credentials in code

### Soft Constraints (Best Practices)
1. **Minimize dependencies** - use native Node.js APIs where possible (readline vs blessed)
2. **Cross-platform support** - test on Windows + Linux CI runners
3. **Performance budget** - component render < 16ms, tests < 30s total
4. **Accessibility** - keyboard navigation in all interactive components
5. **Graceful degradation** - fallback to plain text when ANSI not supported

### Performance Budgets

| Metric | Target | Current | Gap |
|--------|--------|---------|-----|
| Test execution time | < 30s | 31.01s (CLI tests) | -1.01s |
| Storybook build time | < 15s | Unknown | TBD |
| Visual test suite | < 2min | Unknown | TBD |
| Spinner render overhead | < 1ms | Unknown | TBD |
| Toast queue memory | < 1KB | Unknown | TBD |

**Optimization opportunities if budgets exceeded:**
- Parallelize test suites (vitest --threads)
- Cache Storybook build (GitHub Actions)
- Use Playwright sharding (--shard=1/2)
- Lazy-load component dependencies

---

## Appendix: OSS Pattern Sources

### Storybook Patterns
**Source:** kilocode (packages/kilo-ui/.storybook/)
**Patterns used:**
- Vite-based config with addon-essentials
- Theme provider wrapper in preview.tsx
- CSF 3.0 format with args/controls

**Example:**
```typescript
// From kilocode/packages/kilo-ui/.storybook/preview.tsx
export const decorators = [
  (Story) => (
    <ThemeProvider>
      <Story />
    </ThemeProvider>
  ),
];
```

### Playwright Patterns
**Source:** kilocode (packages/kilo-ui/playwright.config.ts), openhands (frontend/playwright.config.ts)
**Patterns used:**
- Desktop Chrome viewport (1280x720)
- baseURL localhost:6006 (Storybook)
- toHaveScreenshot() matcher with maxDiffPixels
- webServer with reuseExistingServer

**Example:**
```typescript
// From kilocode/packages/kilo-ui/playwright.config.ts
use: {
  baseURL: "http://localhost:6006",
  viewport: { width: 1280, height: 720 },
},
projects: [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
],
```

### UI Component Patterns
**Source:** ora (Spinner), sonner (Toast), inquirer (Menu)
**Patterns used:**
- ora: Frame-based animation, cleanup on exit
- sonner: Queue management, auto-dismiss timers
- inquirer: Readline-based keyboard input

**Example:**
```typescript
// From ora pattern
const spinner = {
  frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"],
  interval: 80,
};

setInterval(() => {
  frameIndex = (frameIndex + 1) % frames.length;
  renderFrame(frames[frameIndex]);
}, interval);
```

---

## Next Steps (Action Items)

### Immediate (This Week)
1. ✅ **Review this plan** - Verify scope/estimates align with project goals
2. ⏭️ **Execute Phase 1.5** - Start with observability tests (highest ROI, blocks nothing)
3. ⏭️ **Run /nova** - Use nova preset to execute plan autonomously

### Follow-Up (Next Week)
4. Execute Phase 2.1-2.3 - UI components + visual testing
5. Verify gates - Run `npm run release:check` after each phase
6. Update UPR.md - Document final results

### Final Validation
7. Re-score with ChatGPT - Submit for 9.7+ confirmation
8. Publish benchmarks - Share visual regression results
9. Tag release - Create v1.0.0-rc1

---

## Conclusion

This plan transforms DanteCode from **9.5/10 (strong observability)** to **9.7+ (production-grade UX + comprehensive testing)**.

**Key differentiators after completion:**
- ✅ Full observability with metrics/traces/health across all surfaces
- ✅ Professional CLI UX (spinners, toasts, interactive menus) matching Cursor/Aider
- ✅ Visual regression testing protecting UI quality
- ✅ Comprehensive test coverage (363 tests total)

**Timeline:** 10-12 hours of focused work (1 week sprint)
**Risk:** Low - all patterns proven in OSS, no architectural changes
**Success probability:** Very High - clear scope, defined tasks, validated patterns

---

**END OF PLAN**

**Ready to execute:** Use `/nova` to run this plan autonomously.
