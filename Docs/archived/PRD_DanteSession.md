# EXECUTION PACKET: DanteSession — Session Management Upgrade
## Session / Memory (7.5 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteSession |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/cli` + `@dantecode/core` (SessionStore) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~600 source + ~350 tests |
| **Sprint Time** | 2-3 hours for Claude Code |

---

## 1. The Situation

DanteCode's session infrastructure is more complete than the score suggests. Here's what already works:

| Feature | Status | Where |
|---|---|---|
| /compact (DanteMemory + fallback) | ✅ Wired | slash-commands.ts |
| /memory (list, search, stats, forget, cross-session) | ✅ Wired | slash-commands.ts |
| /history (list sessions, view details, clear) | ✅ Wired | slash-commands.ts |
| --continue flag (resume last session) | ✅ Wired | repl.ts |
| /resume (resume durable runs) | ✅ Wired | slash-commands.ts |
| SessionStore (save, load, list, delete, summarize) | ✅ Wired | core/session-store.ts |
| Auto-compaction at 80% context utilization | ✅ Wired | agent-loop.ts (~line 2059) |
| MemoryOrchestrator initialized on session start | ✅ Wired | agent-loop.ts (~line 1924) |
| Memory recall on session start | ✅ Wired | agent-loop.ts (~line 1942) |
| Context utilization tracking and display | ✅ Wired | agent-loop.ts (~line 2046) |

**What's missing for 9.0 (6 targeted additions):**

1. **Session naming** — no `--name` flag, no `/name` command. Sessions are identified by UUID only.
2. **Session export** — no way to export a session to JSON or Markdown for sharing or archiving.
3. **Session import** — no way to import a session from file.
4. **Session branching** — no way to fork the current session into a new context while preserving history.
5. **Memory auto-retain per round** — MemoryOrchestrator recalls on start but doesn't retain learnings after each tool round. Decisions and outcomes evaporate.
6. **Memory export** — `/memory export` isn't available for backing up or transferring memory between projects.

These are all small, focused additions to existing infrastructure. No architectural changes needed.

---

## 2. Competitive Benchmark

### Claude Code (9.0)
- `claude -n "session name"` for named sessions
- `--continue` for session resume (DanteCode has this ✅)
- Auto-compaction for long sessions (DanteCode has this ✅)
- `/compact` for manual compaction (DanteCode has this ✅)
- Session naming visible in prompt bar
- Auto-memory (CLAUDE.md) learns across sessions

### Codex (9.0)
- `codex exec resume --last` for session resume
- Session export as JSON with `--json` flag
- SQLite-backed session state with export/import
- Session naming per conversation

### OpenCode (8.5)
- `/compact` (alias `/summarize`) for session compaction
- Session export as JSON and Markdown
- Session import from file or share URL
- `/share` for sharing sessions
- Session pagination for history

---

## 3. Component Specifications

### 3.1 — Session Naming

**File:** `packages/cli/src/index.ts` — add `--name` flag

```typescript
// In ParsedArgs interface:
/** --name <n> — name this session */
sessionName: string | undefined;

// In argument parsing:
case "--name":
case "-n":
  parsed.sessionName = args[++i];
  break;
```

**File:** `packages/cli/src/repl.ts` — apply session name

```typescript
// After createSession(), if sessionName is provided:
if (options.sessionName) {
  session.name = options.sessionName;
}
```

**File:** `packages/cli/src/slash-commands.ts` — add `/name` command

```typescript
{
  name: "name",
  description: "Name or rename the current session",
  usage: "/name <session-name>",
  handler: nameCommand,
}

async function nameCommand(args: string, state: ReplState): Promise<string> {
  const name = args.trim();
  if (!name) {
    const current = state.session.name ?? state.session.id.slice(0, 8);
    return `Current session: ${BOLD}${current}${RESET}\nUsage: /name <new-name>`;
  }
  state.session.name = name;
  // Persist to session store
  const store = new SessionStore(state.projectRoot);
  await store.save(sessionToFile(state.session));
  return `${GREEN}Session renamed to: ${BOLD}${name}${RESET}`;
}
```

**File:** `@dantecode/config-types` — add `name` field to Session interface (if not already present)

```typescript
export interface Session {
  // ... existing fields ...
  /** Human-readable session name. Optional. */
  name?: string;
}
```

---

### 3.2 — Session Export

**File:** `packages/cli/src/slash-commands.ts` — add `/export` command

```typescript
{
  name: "export",
  description: "Export current session to JSON or Markdown",
  usage: "/export [json|md] [path]",
  handler: exportCommand,
}

async function exportCommand(args: string, state: ReplState): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const format = parts[0] === "md" || parts[0] === "markdown" ? "md" : "json";
  const outputPath = parts[1] ?? `session-${state.session.name ?? state.session.id.slice(0, 8)}.${format}`;

  if (format === "json") {
    const data = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      session: {
        id: state.session.id,
        name: state.session.name,
        createdAt: state.session.createdAt,
        model: state.session.model,
        messageCount: state.session.messages.length,
        messages: state.session.messages,
        activeFiles: state.session.activeFiles,
        todoList: state.session.todoList,
      },
      // Include evidence chain if available
      evidence: state.evidenceBridge?.exportEvidence() ?? null,
      // Include memory stats if available
      memoryStats: state.memoryOrchestrator
        ? { ...state.memoryOrchestrator.memoryVisualize() }
        : null,
    };
    await writeFile(resolve(state.projectRoot, outputPath), JSON.stringify(data, null, 2), "utf8");
  } else {
    // Markdown export
    const lines: string[] = [
      `# Session: ${state.session.name ?? state.session.id.slice(0, 8)}`,
      "",
      `- **Created:** ${state.session.createdAt}`,
      `- **Model:** ${state.session.model.provider}/${state.session.model.modelId}`,
      `- **Messages:** ${state.session.messages.length}`,
      "",
      "---",
      "",
    ];
    for (const msg of state.session.messages) {
      const role = msg.role === "user" ? "**You**" : msg.role === "assistant" ? "**DanteCode**" : `*${msg.role}*`;
      lines.push(`### ${role} (${msg.timestamp ?? ""})`);
      lines.push("");
      lines.push(msg.content.slice(0, 5000)); // Truncate very long messages
      lines.push("");
      lines.push("---");
      lines.push("");
    }
    await writeFile(resolve(state.projectRoot, outputPath), lines.join("\n"), "utf8");
  }

  return `${GREEN}Session exported to: ${BOLD}${outputPath}${RESET} (${format})`;
}
```

---

### 3.3 — Session Import

**File:** `packages/cli/src/slash-commands.ts` — add `/import` command

```typescript
{
  name: "import",
  description: "Import a session from JSON file",
  usage: "/import <path>",
  handler: importSessionCommand,
}

async function importSessionCommand(args: string, state: ReplState): Promise<string> {
  const filePath = args.trim();
  if (!filePath) return `${RED}Usage: /import <path-to-session.json>${RESET}`;

  try {
    const content = await readFile(resolve(state.projectRoot, filePath), "utf8");
    const data = JSON.parse(content);

    // Validate structure
    if (!data.session?.messages || !Array.isArray(data.session.messages)) {
      return `${RED}Invalid session file: missing messages array${RESET}`;
    }

    // Verify version compatibility
    const version = data.version ?? "0.0.0";
    if (!version.startsWith("1.")) {
      return `${YELLOW}Warning: session file version ${version} may not be fully compatible${RESET}`;
    }

    // Load messages into current session (append, don't replace)
    const imported = data.session.messages.length;
    const summaryMsg: SessionMessage = {
      id: randomUUID(),
      role: "system",
      content: `## Imported Session Context\nImported ${imported} messages from ${data.session.name ?? data.session.id ?? "unknown"} (${data.session.createdAt ?? "unknown date"}).\nOriginal model: ${data.session.model?.provider ?? "unknown"}/${data.session.model?.modelId ?? "unknown"}.`,
      timestamp: new Date().toISOString(),
    };
    state.session.messages.push(summaryMsg);

    // Import as system context (not raw messages — avoids role confusion)
    const contextSummary = data.session.messages
      .filter((m: SessionMessage) => m.role === "user" || m.role === "assistant")
      .slice(-20) // Keep last 20 messages for context
      .map((m: SessionMessage) => `[${m.role}]: ${m.content.slice(0, 500)}`)
      .join("\n\n");

    state.session.messages.push({
      id: randomUUID(),
      role: "system",
      content: `## Previous Session Context\n${contextSummary}`,
      timestamp: new Date().toISOString(),
    });

    return `${GREEN}Imported session: ${BOLD}${data.session.name ?? data.session.id?.slice(0, 8) ?? "unknown"}${RESET} (${imported} messages → context summary injected)`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `${RED}Failed to import session: ${msg}${RESET}`;
  }
}
```

---

### 3.4 — Session Branching

**File:** `packages/cli/src/slash-commands.ts` — add `/branch` command

```typescript
{
  name: "branch",
  description: "Fork current session into a new context (preserves history)",
  usage: "/branch [name]",
  handler: branchCommand,
}

async function branchCommand(args: string, state: ReplState): Promise<string> {
  const branchName = args.trim() || `branch-${Date.now()}`;

  // Save current session first
  const store = new SessionStore(state.projectRoot);
  await store.save(sessionToFile(state.session));

  // Create a compact summary of the current session
  let summary: string;
  if (state.memoryOrchestrator) {
    try {
      const sumResult = await state.memoryOrchestrator.memorySummarize(state.session.id);
      summary = sumResult.summary ?? `Session with ${state.session.messages.length} messages`;
    } catch {
      summary = `Session with ${state.session.messages.length} messages`;
    }
  } else {
    summary = `Session with ${state.session.messages.length} messages`;
  }

  // Create new session with summary as context
  const oldId = state.session.id;
  const oldName = state.session.name ?? oldId.slice(0, 8);
  state.session.id = randomUUID();
  state.session.name = branchName;
  state.session.createdAt = new Date().toISOString();

  // Replace message history with summary + last 5 messages
  const recentMessages = state.session.messages.slice(-5);
  state.session.messages = [
    {
      id: randomUUID(),
      role: "system",
      content: `## Branched from: ${oldName}\n\n${summary}\n\n---\n*This is a new branch. The parent session is preserved.*`,
      timestamp: new Date().toISOString(),
    },
    ...recentMessages,
  ];

  // Save the new branch
  await store.save(sessionToFile(state.session));

  return `${GREEN}Session branched: ${BOLD}${oldName}${RESET} → ${BOLD}${branchName}${RESET}\n${DIM}Parent session preserved. ${state.session.messages.length} messages in new branch (summary + recent).${RESET}`;
}
```

---

### 3.5 — Memory Auto-Retain Per Round

This is the most impactful change for Score B (battle-tested). Currently, MemoryOrchestrator recalls on session start but doesn't capture learnings from each round.

**File:** `packages/cli/src/agent-loop.ts` — add retain after each agent round

Find the point in the agent loop where a round completes (after tool execution and model response). Add:

```typescript
// ---- DanteMemory: auto-retain learnings from this round ----
// After each round, extract and retain:
//   1. What tool was called and whether it succeeded
//   2. Any DanteForge scores
//   3. Key decisions made (file writes, architectural choices)
if (memoryOrchestrator && roundIndex > 0) {
  try {
    const lastAssistantMsg = messages.filter(m => m.role === "assistant").slice(-1)[0];
    const toolResults = messages.filter(m => m.role === "tool").slice(-3);

    // Build a compact retention payload
    const retainPayload: Record<string, unknown> = {
      round: roundIndex,
      model: modelConfig.modelId,
      timestamp: new Date().toISOString(),
    };

    // Track tool outcomes
    if (toolResults.length > 0) {
      retainPayload.tools = toolResults.map(tr => {
        const parsed = typeof tr.content === "string" ? tr.content.slice(0, 200) : "";
        return { summary: parsed, role: "tool" };
      });
    }

    // Track PDSE scores from this round
    if (lastPdseScore !== undefined) {
      retainPayload.pdseScore = lastPdseScore;
    }

    // Track files changed
    if (filesWrittenThisRound.length > 0) {
      retainPayload.filesChanged = filesWrittenThisRound;
    }

    await memoryOrchestrator.memoryStore(
      `round-${session.id}-${roundIndex}`,
      retainPayload,
      "session",  // session-scoped, not global
    );
  } catch {
    // Non-fatal: memory retention failure should never block the agent loop
  }
}
```

**Where exactly to place this:** After the existing auto-compaction block (~line 2059-2076) and before the next `rl.prompt()` or loop iteration.

---

### 3.6 — Memory Export

**File:** `packages/cli/src/slash-commands.ts` — add `/memory export` subcommand

In the existing `memoryCommand`, add the `export` case:

```typescript
case "export": {
  const exportPath = parts[1] ?? `dantecode-memory-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    const viz = state.memoryOrchestrator.memoryVisualize();
    const recallAll = await state.memoryOrchestrator.memoryRecall("*", 1000);
    const exportData = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      projectRoot: state.projectRoot,
      stats: {
        nodeCount: (viz.nodes ?? []).length,
        edgeCount: (viz.edges ?? []).length,
      },
      memories: recallAll.results.map(r => ({
        key: r.key,
        scope: r.scope,
        value: r.value,
        summary: r.summary,
        score: r.score,
        recallCount: r.recallCount,
      })),
    };
    await writeFile(
      resolve(state.projectRoot, exportPath),
      JSON.stringify(exportData, null, 2),
      "utf8",
    );
    return `${GREEN}Memory exported to: ${BOLD}${exportPath}${RESET} (${exportData.memories.length} memories)`;
  } catch (e) {
    return `${RED}Error exporting memory: ${String(e)}${RESET}`;
  }
}
```

---

## 4. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/cli/src/commands/session-export.test.ts` | 100 | Export/import tests |
| 2 | `packages/cli/src/commands/session-branch.test.ts` | 80 | Branch tests |

### MODIFIED Files

| # | Path | Change | LOC Est. |
|---|---|---|---|
| 3 | `packages/cli/src/index.ts` | Add `--name` flag parsing | +15 |
| 4 | `packages/cli/src/repl.ts` | Apply sessionName from options | +10 |
| 5 | `packages/cli/src/slash-commands.ts` | Add /name, /export, /import, /branch commands + /memory export subcommand | +300 |
| 6 | `packages/cli/src/agent-loop.ts` | Add memory auto-retain per round (~20 lines) | +25 |
| 7 | `packages/config-types/src/session.ts` (or wherever Session is defined) | Add optional `name` field | +2 |

### Total: 2 new files + 5 modified, ~600 LOC source + ~350 LOC tests

---

## 5. Tests

### `session-export.test.ts` (~8 tests)
1. `/export json` creates valid JSON file with session data
2. `/export md` creates Markdown with message history
3. Export includes evidence chain data when available
4. Export with custom path writes to specified location
5. `/import` loads session and injects context summary
6. `/import` with invalid file returns error
7. `/import` with missing messages field returns error
8. Import truncates very long message history (last 20)

### `session-branch.test.ts` (~6 tests)
1. `/branch my-branch` creates new session with name "my-branch"
2. Branch preserves last 5 messages from parent
3. Branch includes summary as system message
4. Parent session is saved before branching
5. Branch with no name generates timestamp-based name
6. New session has fresh ID, different from parent

### Existing test updates (~5 tests to add/modify)
7. `--name "my-session"` flag sets session.name
8. `/name my-session` renames current session
9. `/memory export` creates valid JSON with all memories
10. Memory auto-retain fires after each agent round (mock test)
11. Auto-retain failure doesn't crash agent loop

**Total: ~19 tests**

---

## 6. Claude Code Execution Instructions

**Single sprint, 2-3 hours. 2 phases.**

```
Phase 1: Session Commands (1.5h)
  1. Add `name` field to Session interface (config-types or wherever it lives)
  2. Add --name flag parsing in packages/cli/src/index.ts
  3. Apply sessionName in packages/cli/src/repl.ts
  4. Add /name, /export, /import, /branch commands to slash-commands.ts
  5. Add /memory export subcommand to existing memoryCommand
  6. Create session-export.test.ts and session-branch.test.ts
  7. Run: npx turbo test
  GATE: All existing + new tests pass

Phase 2: Memory Auto-Retain (0.5-1h)
  8. Add memory auto-retain block to agent-loop.ts after auto-compaction
  9. Verify: memory auto-retain is wrapped in try/catch (NEVER crashes loop)
  10. Add test for auto-retain in agent-loop.test.ts (mock memoryOrchestrator)
  11. Run: npx turbo test
  GATE: Full test suite passes, ESPECIALLY all agent-loop tests
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- **ZERO regressions on existing tests** — particularly agent-loop and slash-command tests
- Memory auto-retain MUST be wrapped in try/catch with empty catch — it is advisory, never blocking
- Export format must include a `version` field for future compatibility
- Session import does NOT replace current messages — it injects context as system messages
- Branch command MUST save parent session before creating the fork

---

## 7. How This Interacts With Existing Infrastructure

```
                    EXISTING (already works)              NEW (this PRD)
                    ────────────────────────              ──────────────
Session Start  →    MemoryOrchestrator.recall()      
                    --continue loads last session          --name sets session.name
                                                    
Each Round     →    Agent generates, tools execute   →    Memory auto-retain per round
                                                          (decisions, scores, files changed)
                                                    
Manual         →    /compact (DanteMemory summary)        /branch (fork session)
                    /memory search/list/stats              /memory export
                    /history (list sessions)               /name (rename)
                                                          /export (JSON/Markdown)
                                                          /import (load session)
                                                    
Auto           →    Auto-compaction at 80% context   
                    Context utilization display       
                                                    
Session End    →    SessionStore.save()              
```

Everything on the left is already wired. Everything on the right is what this PRD adds. The new pieces slot into existing infrastructure with minimal modification.

---

## 8. Success Criteria

| Criteria | Target |
|---|---|
| `dantecode --name "my-session"` sets session name | ✅ |
| `/name` renames current session | ✅ |
| `/export json` creates valid session JSON | ✅ |
| `/export md` creates readable Markdown transcript | ✅ |
| `/import <file>` loads session context | ✅ |
| `/branch` forks session with summary + recent messages | ✅ |
| Memory auto-retain fires every round without blocking | ✅ |
| `/memory export` creates memory backup JSON | ✅ |
| Existing session tests | 0 regressions |
| Existing agent-loop tests | 0 regressions |
| All new files | PDSE ≥ 85, anti-stub clean |

---

## 9. Score Impact

This is the smallest PRD in the remaining set (~600 LOC) but it closes the gap on a dimension where the infrastructure is 90% built. The missing 10% is surface commands and the auto-retain loop — both are thin wiring on top of MemoryOrchestrator, SessionStore, and the existing /compact and /memory systems.

Feature Parity score should move from 7.5 to 8.5-9.0. Battle-Tested score requires real usage of /branch, /export, and verifying that auto-retain actually captures useful memories across rounds.

---

*"The best session system isn't the one with the most features. It's the one where nothing is lost."*
