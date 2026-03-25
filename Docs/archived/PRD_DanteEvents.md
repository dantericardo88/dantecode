# EXECUTION PACKET: DanteEvents — Event-Driven Automation Platform
## Event Automation / Git (7.5 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteEvents |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/git-engine` (existing, extend) + `@dantecode/cli` (unified commands) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~800 source + ~400 tests |
| **Sprint Time** | 2-3 hours for Claude Code |

---

## 1. The Situation

**DanteCode's event automation infrastructure is far more complete than the score suggests.** There are 2,239 LOC of battle-ready automation code in `@dantecode/git-engine`:

| Component | LOC | What It Does |
|---|---|---|
| `automation-orchestrator.ts` | 680 | Coordinates all automation types, background execution, PR creation |
| `webhook-handler.ts` | 332 | HTTP webhook listener for GitHub/GitLab/custom with HMAC verification |
| `scheduled-tasks.ts` | 352 | Cron-style scheduled tasks with persistence |
| `event-queue.ts` | 223 | Priority event queue with deduplication |
| `event-normalizer.ts` | 153 | Event fingerprinting, noise filtering, priority sorting |
| `automation-store.ts` | 313 | SQLite-backed persistence for all automation state |
| `rate-limiter.ts` | 186 | Token bucket rate limiter for event processing |

Plus existing CLI commands: `/webhook-listen`, `/schedule-git-task`, `/loop`, `/bg`.

**The gap to 9.0 is NOT infrastructure. It's surface, templates, and integration.**

Specifically:
1. **No unified `/automate` command** — three separate commands with different UX patterns
2. **No automation templates** — Cursor has pre-built templates for security review, incident triage, weekly digest. DanteCode requires manual configuration.
3. **Automations run workflows, not agent sessions** — a webhook can trigger a shell workflow but can't start a full agent-loop with DanteForge verification on the output
4. **No automation dashboard** — no way to see all active watchers + webhooks + scheduled tasks + recent executions in one view
5. **No DanteForge gate on automation output** — when an automated task produces code, it bypasses PDSE scoring
6. **No file-pattern triggers** — watchers are git-event-only; can't watch for "any .ts file changed in src/"

---

## 2. Competitive Benchmark

### Cursor Automations (9.0 — the benchmark)
- Always-on agents triggered by GitHub PRs, Slack, Linear, PagerDuty, cron, webhooks
- Agents spin up in cloud sandboxes, verify own output, have memory that learns from past runs
- BugBot as the original automation (runs on every PR, thousands/day, caught millions of bugs)
- Template marketplace for common automations

### Claude Code /loop (8.5)
- Cron-like recurring prompts within a session
- Lightweight — runs in existing session context
- No external triggers (session-only)

### OpenCode GitHub Agent (9.0)
- Runs as GitHub Action
- Full agent capabilities in CI context
- Repository-scoped automation

### DanteCode Current (7.5 feature / lower proven)
- Full webhook, scheduler, event queue infrastructure ✅
- Wired into CLI ✅
- Missing: unified surface, templates, agent-loop integration, verification gate, dashboard

---

## 3. What to Build (5 focused additions)

### 3.1 — Unified `/automate` Command

Replace the fragmented `/webhook-listen` + `/schedule-git-task` + `/loop` with a single unified `/automate` surface. The old commands continue to work as aliases.

**File:** `packages/cli/src/commands/automate.ts` (NEW)

```typescript
/**
 * /automate — Unified automation management.
 *
 * Subcommands:
 *   /automate dashboard              — Show all active automations + recent executions
 *   /automate create <type> <config> — Create a new automation
 *   /automate list [--type webhook|schedule|watch|loop]  — List automations
 *   /automate stop <id>              — Stop an automation
 *   /automate logs <id>              — Show execution history for an automation
 *   /automate template <name>        — Create automation from built-in template
 *   /automate templates              — List available templates
 *
 * Types:
 *   webhook   — Listen for HTTP webhooks (GitHub, GitLab, custom)
 *   schedule  — Run on a cron schedule or interval
 *   watch     — Trigger on file/git changes matching a pattern
 *   loop      — Run a prompt repeatedly until condition met
 */

export interface AutomationDefinition {
  id: string;
  name: string;
  type: "webhook" | "schedule" | "watch" | "loop";
  config: Record<string, unknown>;
  /** When set, automation triggers a full agent-loop session (not just a shell workflow). */
  agentMode?: {
    prompt: string;
    model?: string;
    sandboxMode?: string;
    verifyOutput?: boolean;  // Run DanteForge on output (default: true)
  };
  /** Optional workflow file to run instead of / alongside agent session. */
  workflowPath?: string;
  createdAt: string;
  status: "active" | "stopped" | "error";
  lastRunAt?: string;
  runCount: number;
}
```

**Dashboard output:**
```
╭─ Active Automations ─────────────────────────────────────────╮
│                                                               │
│  🔔 webhook/pr-review [active]     3 runs, last: 2m ago      │
│     github:pull_request → /review --post                      │
│                                                               │
│  ⏰ schedule/daily-verify [active] 12 runs, last: 8h ago     │
│     0 9 * * * → /verify --full                                │
│                                                               │
│  👁 watch/test-on-change [active]  47 runs, last: 5m ago     │
│     src/**/*.ts → npm test                                    │
│                                                               │
│  🔄 loop/fix-tests [active]        round 3/10                │
│     "run tests and fix failures" (max: 10)                    │
│                                                               │
│  Recent Executions:                                           │
│    ✓ webhook/pr-review #3      12s  PDSE: 88  2m ago         │
│    ✓ watch/test-on-change #47   3s  passed    5m ago         │
│    ✗ schedule/daily-verify #12  45s  PDSE: 72  8h ago        │
│                                                               │
╰───────────────────────────────────────────────────────────────╯
```

---

### 3.2 — Automation Templates

Pre-built automation configurations for common workflows. Inspired by Cursor's automation templates.

**File:** `packages/git-engine/src/automation-templates.ts` (NEW)

```typescript
/**
 * Built-in automation templates for common developer workflows.
 * Each template produces an AutomationDefinition ready to activate.
 */

export interface AutomationTemplate {
  name: string;
  description: string;
  type: "webhook" | "schedule" | "watch";
  /** Creates the automation definition with sensible defaults. */
  create(options?: Record<string, unknown>): AutomationDefinition;
}

export const BUILT_IN_TEMPLATES: AutomationTemplate[] = [
  {
    name: "pr-review",
    description: "Run DanteReview on every GitHub PR (like Cursor BugBot)",
    type: "webhook",
    create: (opts) => ({
      id: generateId(),
      name: "pr-review",
      type: "webhook",
      config: {
        provider: "github",
        event: "pull_request",
        actions: ["opened", "synchronize"],
        port: opts?.port ?? 3456,
      },
      agentMode: {
        prompt: "Review the PR diff using /review ${pr_number} --post",
        verifyOutput: true,
      },
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    }),
  },
  {
    name: "daily-verify",
    description: "Run full DanteForge verification every morning",
    type: "schedule",
    create: (opts) => ({
      id: generateId(),
      name: "daily-verify",
      type: "schedule",
      config: {
        schedule: opts?.schedule ?? "0 9 * * *",  // 9 AM daily
      },
      agentMode: {
        prompt: "Run /verify --full on the entire codebase. If any file scores below 85, fix it.",
        verifyOutput: true,
      },
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    }),
  },
  {
    name: "test-on-change",
    description: "Run tests when source files change",
    type: "watch",
    create: (opts) => ({
      id: generateId(),
      name: "test-on-change",
      type: "watch",
      config: {
        pattern: opts?.pattern ?? "src/**/*.ts",
        debounceMs: 2000,
      },
      workflowPath: undefined,
      agentMode: undefined,
      // Simple workflow: just run tests
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    }),
  },
  {
    name: "security-scan",
    description: "Scan for security issues on every push",
    type: "webhook",
    create: (opts) => ({
      id: generateId(),
      name: "security-scan",
      type: "webhook",
      config: {
        provider: "github",
        event: "push",
        port: opts?.port ?? 3457,
      },
      agentMode: {
        prompt: "Run a security scan: check for secrets in committed files, review dependency vulnerabilities, and flag any DanteForge constitution violations.",
        verifyOutput: true,
      },
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    }),
  },
  {
    name: "weekly-retro",
    description: "Generate a weekly project retrospective every Friday",
    type: "schedule",
    create: (opts) => ({
      id: generateId(),
      name: "weekly-retro",
      type: "schedule",
      config: {
        schedule: opts?.schedule ?? "0 17 * * 5",  // Friday 5 PM
      },
      agentMode: {
        prompt: "Run /retro to generate a weekly retrospective. Summarize: commits this week, PDSE scores, test coverage changes, lessons learned, and recommended focus for next week.",
        verifyOutput: false,
      },
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    }),
  },
];

/**
 * Get a template by name.
 */
export function getTemplate(name: string): AutomationTemplate | null {
  return BUILT_IN_TEMPLATES.find(t => t.name === name) ?? null;
}

/**
 * List all available templates.
 */
export function listTemplates(): AutomationTemplate[] {
  return [...BUILT_IN_TEMPLATES];
}
```

---

### 3.3 — Agent-Loop Integration for Automations

When an automation fires, it should be able to start a full agent-loop session — not just run a shell command. This is the critical gap between "CI script runner" and "always-on AI agent."

**File:** `packages/git-engine/src/automation-agent-bridge.ts` (NEW)

```typescript
/**
 * Bridge between automation triggers and the DanteCode agent loop.
 * When an automation has agentMode configured, this bridge starts
 * a headless agent session that processes the automation's prompt.
 *
 * The bridge:
 * 1. Creates a new session scoped to the automation
 * 2. Injects the trigger context (PR number, changed files, etc.) into the prompt
 * 3. Runs the agent loop in non-interactive mode
 * 4. Optionally runs DanteForge verification on the output
 * 5. Records the execution in the automation store
 */

export interface AgentBridgeConfig {
  /** The prompt to execute. Supports ${var} substitution from trigger context. */
  prompt: string;
  /** Model override for this automation (default: project default). */
  model?: string;
  /** Sandbox mode for the agent session. */
  sandboxMode?: string;
  /** Run DanteForge PDSE on output (default: true). */
  verifyOutput?: boolean;
  /** Maximum rounds for the agent loop (default: 30). */
  maxRounds?: number;
  /** Project root. */
  projectRoot: string;
}

export interface AgentBridgeResult {
  sessionId: string;
  success: boolean;
  output: string;
  pdseScore?: number;
  tokensUsed: number;
  durationMs: number;
  filesChanged: string[];
  error?: string;
}

/**
 * Run a headless agent session triggered by an automation.
 * Uses the existing runAgentLoop from agent-loop.ts in non-interactive mode.
 */
export async function runAutomationAgent(
  config: AgentBridgeConfig,
  triggerContext: Record<string, unknown>,
): Promise<AgentBridgeResult>;

/**
 * Substitute ${var} references in a prompt template with trigger context values.
 * Example: "Review PR ${pr_number}" with { pr_number: 42 } → "Review PR 42"
 */
export function substitutePromptVars(
  template: string,
  context: Record<string, unknown>,
): string;
```

**Wire into AutomationOrchestrator:**

In `automation-orchestrator.ts`, when processing a trigger that has `agentMode`, use the bridge:

```typescript
// In the execution path, after existing workflow handling:
if (automation.agentMode) {
  const result = await runAutomationAgent(
    {
      prompt: automation.agentMode.prompt,
      model: automation.agentMode.model,
      sandboxMode: automation.agentMode.sandboxMode,
      verifyOutput: automation.agentMode.verifyOutput ?? true,
      maxRounds: 30,
      projectRoot: this.projectRoot,
    },
    triggerContext,  // { pr_number, changed_files, event_type, etc. }
  );
  // Record execution result
  await this.store.recordExecution({
    automationId: automation.id,
    success: result.success,
    pdseScore: result.pdseScore,
    tokensUsed: result.tokensUsed,
    durationMs: result.durationMs,
    filesChanged: result.filesChanged,
  });
}
```

---

### 3.4 — File-Pattern Watch Triggers

Extend the existing `GitEventWatcher` to support arbitrary file-pattern watching (not just git events).

**File:** `packages/git-engine/src/file-pattern-watcher.ts` (NEW)

```typescript
/**
 * Watch for file changes matching glob patterns.
 * Uses Node.js fs.watch with debouncing and pattern matching.
 * Complements GitEventWatcher (which watches git hook events).
 *
 * Example: watch("src/**\/*.ts", 2000) triggers when any .ts file
 * in src/ is created, modified, or deleted, debounced by 2 seconds.
 */

import { watch, type FSWatcher } from "node:fs";
import { EventEmitter } from "node:events";

export interface FilePatternWatcherOptions {
  pattern: string;            // Glob pattern (e.g., "src/**\/*.ts")
  debounceMs?: number;        // Debounce interval (default: 2000ms)
  projectRoot: string;
  watcherId?: string;
  ignorePatterns?: string[];  // Patterns to ignore (default: node_modules, .git, dist)
}

export interface FileChangeEvent {
  watcherId: string;
  pattern: string;
  changedFile: string;
  changeType: "create" | "modify" | "delete";
  timestamp: string;
}

export class FilePatternWatcher extends EventEmitter {
  private watchers: FSWatcher[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: FileChangeEvent[] = [];
  readonly id: string;

  constructor(private options: FilePatternWatcherOptions);

  /** Start watching. Emits "change" events with FileChangeEvent[]. */
  async start(): Promise<void>;

  /** Stop watching and clean up. */
  async stop(): Promise<void>;

  /** Get current watcher status. */
  snapshot(): { id: string; pattern: string; active: boolean; changeCount: number };
}

/**
 * Simple glob matcher — no external dependencies.
 * Supports: *, **, ?, character classes [abc].
 * Does NOT need full minimatch — automation patterns are simple.
 */
export function matchGlob(pattern: string, filePath: string): boolean;
```

---

### 3.5 — DanteForge Verification Gate on Automation Output

When an automation produces file changes, run DanteForge PDSE scoring before accepting.

This is wired inside the `runAutomationAgent` bridge (section 3.3). When `verifyOutput: true`:

```typescript
// After agent loop completes, if files were changed:
if (config.verifyOutput && result.filesChanged.length > 0) {
  const forgeResult = await runDanteForge({
    files: result.filesChanged,
    projectRoot: config.projectRoot,
    mode: "automation", // lighter than full verification, heavier than lint
  });
  result.pdseScore = forgeResult.aggregateScore;

  if (forgeResult.aggregateScore < 70) {
    // Automation output below threshold — flag but don't revert
    // (human reviews automation results, not auto-revert)
    result.output += `\n\n⚠ DanteForge: Automation output scored ${forgeResult.aggregateScore}/100 (below 70 threshold). Review recommended.`;
  }
}
```

---

## 4. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/cli/src/commands/automate.ts` | 250 | Unified /automate command with dashboard |
| 2 | `packages/git-engine/src/automation-templates.ts` | 150 | 5 built-in automation templates |
| 3 | `packages/git-engine/src/automation-agent-bridge.ts` | 120 | Bridge between automations and agent-loop |
| 4 | `packages/git-engine/src/file-pattern-watcher.ts` | 150 | Glob-based file change watcher |
| 5 | `packages/cli/src/commands/automate.test.ts` | 100 | Automate command tests |
| 6 | `packages/git-engine/src/automation-templates.test.ts` | 80 | Template tests |
| 7 | `packages/git-engine/src/file-pattern-watcher.test.ts` | 100 | File watcher tests |
| 8 | `packages/git-engine/src/automation-agent-bridge.test.ts` | 80 | Agent bridge tests |

### MODIFIED Files

| # | Path | Change |
|---|---|---|
| 9 | `packages/git-engine/src/automation-orchestrator.ts` | Add agentMode execution path, file-pattern trigger support |
| 10 | `packages/git-engine/src/index.ts` | Export new modules |
| 11 | `packages/cli/src/slash-commands.ts` | Register /automate, keep old commands as aliases |

### Total: 8 new files + 3 modified, ~800 LOC source + ~360 LOC tests

---

## 5. Tests

### `automate.test.ts` (~8 tests)
1. `/automate dashboard` with no automations → "No active automations"
2. `/automate dashboard` with mixed types → shows all with correct icons
3. `/automate create webhook` → creates and returns id
4. `/automate template pr-review` → creates webhook automation with defaults
5. `/automate list` → shows all automations
6. `/automate list --type schedule` → filters correctly
7. `/automate stop <id>` → stops automation
8. `/automate templates` → lists all 5 built-in templates

### `automation-templates.test.ts` (~5 tests)
1. `getTemplate("pr-review")` → returns valid template
2. `getTemplate("nonexistent")` → returns null
3. Each template's `create()` produces valid AutomationDefinition
4. Template defaults are sensible (port, schedule, etc.)
5. Template options override defaults

### `file-pattern-watcher.test.ts` (~6 tests)
1. `matchGlob("src/**/*.ts", "src/core/auth.ts")` → true
2. `matchGlob("src/**/*.ts", "tests/auth.test.ts")` → false
3. `matchGlob("*.md", "README.md")` → true
4. Watcher emits change events on file modification
5. Debounce: rapid changes → single batched event
6. Ignore patterns: node_modules changes ignored

### `automation-agent-bridge.test.ts` (~5 tests)
1. `substitutePromptVars("Review PR ${pr_number}", { pr_number: 42 })` → "Review PR 42"
2. Missing variables → left as-is (no crash)
3. `runAutomationAgent` with mock agent loop → returns result
4. DanteForge verification runs when `verifyOutput: true`
5. Low PDSE score → warning appended to output

**Total: ~24 tests**

---

## 6. Claude Code Execution Instructions

**Single sprint, 2-3 hours. 2 phases.**

```
Phase 1: Infrastructure (1.5-2h)
  1. Create packages/git-engine/src/automation-templates.ts (5 templates)
  2. Create packages/git-engine/src/file-pattern-watcher.ts (glob watcher)
  3. Create packages/git-engine/src/automation-agent-bridge.ts (agent integration)
  4. Create test files for all 3
  5. Modify packages/git-engine/src/automation-orchestrator.ts — add agentMode path
  6. Modify packages/git-engine/src/index.ts — export new modules
  7. Run: cd packages/git-engine && npx vitest run
  GATE: All existing + new tests pass (50+ existing automation tests must not regress)

Phase 2: CLI Surface (0.5-1h)
  8. Create packages/cli/src/commands/automate.ts (unified command with dashboard)
  9. Create packages/cli/src/commands/automate.test.ts
  10. Modify packages/cli/src/slash-commands.ts:
      - Register /automate command
      - Keep /webhook-listen, /schedule-git-task, /loop as aliases
  11. Run: npx turbo test
  GATE: Full test suite passes
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- PDSE ≥ 85 on all new files
- **ZERO regressions on existing automation tests (50+ tests)**
- The glob matcher in file-pattern-watcher MUST be self-contained (no minimatch dependency)
- Templates must produce valid AutomationDefinitions that the existing orchestrator can execute
- The agent bridge should import the agent-loop runner dynamically to avoid circular deps

---

## 7. Success Criteria

| Criteria | Target |
|---|---|
| `/automate dashboard` shows unified view of all automation types | ✅ |
| `/automate template pr-review` creates working webhook automation | ✅ |
| 5 built-in templates covering common workflows | ✅ |
| File-pattern watcher triggers on glob matches | ✅ |
| Agent-loop integration: automations can start full agent sessions | ✅ |
| DanteForge PDSE gate on automation output | ✅ |
| Old commands (/webhook-listen, /schedule-git-task, /loop) still work | ✅ |
| Existing automation tests | 0 regressions |
| All new files | PDSE ≥ 85, anti-stub clean |

---

## 8. The Moat

Cursor Automations spins up cloud agents that self-verify. That's powerful but closed-source and Cursor-only.

DanteCode automations run locally with constitutional verification. When a webhook fires and triggers a PR review, DanteForge scores the review output. When a scheduled task runs overnight and produces code, the code is PDSE-scored before it's committed. When a file watcher detects changes and triggers tests, the test results are verified for completeness.

Every competitor has event triggers. Only DanteCode constitutionally verifies what the triggered automation produces. The automation isn't just "run this when that happens." It's "run this when that happens, and prove the output is trustworthy."

---

*"The best automation isn't the one that runs the most. It's the one you can trust to run unsupervised."*
