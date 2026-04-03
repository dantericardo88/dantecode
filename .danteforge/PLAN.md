# Implementation Plan: VSCode Extension Feature Parity

**Generated:** 2026-04-02  
**Goal:** Wire all CLI functionality into VSCode extension to achieve feature parity or better UX  
**Status:** Planning → Execution  
**Complexity:** 7.8/10 (High - extensive integration, multiple subsystems)  
**Timeline:** ~132 hours (1 developer) or ~62 hours (4 developers, parallelized)

---

## Executive Summary

**The Problem:**  
DanteCode CLI has 86 slash commands in 9,750 lines. VSCode extension has only 12 message types in 5,029 lines with basic chat functionality. This creates a massive feature gap where CLI users get planning mode, verification, memory, agents, automation - but VSCode users only get basic chat.

**The Fix:**  
Wire existing CLI infrastructure into VSCode using message passing and webview UI. Reuse slash-commands.ts handlers, planning mode logic, and all existing packages. Add visual UI components for better-than-CLI UX.

**Audit Results:**
- **Missing:** 74 out of 86 commands
- **Critical:** Planning mode (/plan)
- **High Priority:** 11 commands (magic, diff, commit, pdse, memory, index, search, bg, party, automate)

---

## Phase 1: Slash Command Autocomplete [8h] [M]

**Goal:** Type "/" in VSCode chat to see all available commands with fuzzy search

### Tasks
1. Add slash_command_query message type to sidebar-provider.ts [S]
2. Create command-completion.ts with fuzzy matching (port qwen-code pattern) [M]
3. Integrate HelpEngine + CommandPalette from @dantecode/ux-polish [S]
4. Add autocomplete UI to webview HTML (dropdown below input) [S]
5. Wire postMessage for completion requests/responses [S]
6. Test: "/" shows all 86 commands, "/pla" shows /plan [S]

### Files
- `packages/vscode/src/sidebar-provider.ts` (+50 lines - message handler)
- `packages/vscode/src/command-completion.ts` (NEW - 200 lines)
- `packages/vscode/webview/chat.html` (+100 lines - autocomplete UI)

### Success Criteria
- Typing "/" shows dropdown with all commands
- Fuzzy search: "/com" matches /commit, /compact, /compact
- Autocomplete latency < 150ms
- Arrow keys + Enter to select
- ESC to dismiss

---

## Phase 2: Planning Mode UI [24h] [L]

**Goal:** Visual /plan workflow with approve/reject buttons and step tracking

### Tasks
1. Create planning-panel.ts WebviewPanel provider [M]
2. Add message types: plan_generate, plan_show, plan_approve, plan_reject, plan_list, plan_status [M]
3. Wire packages/cli/src/commands/plan.ts handlers via command bridge [M]
4. Build planning UI (planning.html): [L]
   - Plan overview (goal, complexity, created time)
   - Step list with files, dependencies, verify commands
   - Approve/Reject/Save buttons
   - Execution progress bars
5. Add PlanStore persistence integration [S]
6. Add plan history viewer (list all saved plans) [M]
7. Add step-by-step execution tracking with status updates [M]
8. Test full workflow: generate → review → approve → execute [S]

### Files
- `packages/vscode/src/planning-panel.ts` (NEW - 400 lines)
- `packages/vscode/webview/planning.html` (NEW - 300 lines)
- `packages/vscode/src/sidebar-provider.ts` (+100 lines - routing)

### Success Criteria
- /plan <goal> opens planning panel
- Shows steps with files and complexity
- Approve button starts execution
- Progress updates in real-time
- Can reject and regenerate plan
- Plans persist to .dantecode/plans/

---

## Phase 3: Command Bridge + High Priority Commands [32h] [L]

**Goal:** Wire 11 high-priority commands with visual UI where applicable

### Tasks
1. Create VSCodeCommandBridge [M]
   - Maps webview messages → CLI handler functions
   - Converts ANSI output → HTML
   - Shares ReplState with CLI
   - Handles streaming responses
2. Wire /magic (autoforge preset) [S]
3. Wire /diff (visual diff viewer) [M]
4. Wire /commit (commit creator with file selection) [S]
5. Wire /pdse (PDSE scorer with color-coded results) [M]
6. Wire /memory (memory panel with browser/search/stats) [M]
7. Wire /index (code indexing with progress bar) [M]
8. Wire /search (semantic search results with file links) [M]
9. Wire /bg (background agent panel with live task list) [L]
10. Wire /party (multi-agent orchestration with fleet view) [L]
11. Wire /automate (automation dashboard: webhooks/schedules/watchers) [L]

### Files
- `packages/vscode/src/command-bridge.ts` (NEW - 600 lines)
- `packages/vscode/src/panels/magic-panel.ts` (NEW - 200 lines)
- `packages/vscode/src/panels/verification-panel.ts` (NEW - 300 lines)
- `packages/vscode/src/panels/memory-panel.ts` (NEW - 400 lines)
- `packages/vscode/src/panels/search-panel.ts` (NEW - 250 lines)
- `packages/vscode/src/panels/agents-panel.ts` (NEW - 500 lines)
- `packages/vscode/src/panels/automation-panel.ts` (NEW - 450 lines)
- `packages/vscode/src/sidebar-provider.ts` (+200 lines)

### Success Criteria
- All 11 commands work from VSCode
- Visual panels superior to terminal output
- Real-time updates for long-running operations
- No ANSI escape codes in UI
- All panels persist state

---

## Phase 4: Remaining Commands [40h] [L]

**Goal:** 100% CLI parity - wire all 63 remaining commands

### Command Categories
- **Git (12):** /diff, /commit, /revert, /undo, /restore, /recover, /resume, /replay, /fork, /timeline, /worktree, /lfs
- **Verification (9):** /pdse, /qa, /verify-output, /qa-suite, /critic-debate, /add-verification-rail, /verification-history, /drift, /loop
- **Memory (5):** /memory, /compact, /lessons, /remember, /gaslight, /fearset
- **Skills (5):** /skill, /skills, /skill-install, /skill-verify, skill library UI
- **Sessions (6):** /session, /export, /import, /branch, /name, /history
- **Search (4):** /index, /search, /web, /research
- **Agents (6):** /bg, /party, /fleet, /agents, /forge, /postal
- **Automation (7):** /automate, /listen, /webhook, /schedule, /git-watch, /run-workflow, /auto-pr
- **Core (13):** /help, /tutorial, /magic, /onboard, /setup, /score, /status, /troubleshoot, /model, /macro, /theme, /cost, /health
- **Advanced (18):** /autoforge, /resume-autoforge, /runs, /oss, /mcp, /sandbox, /silent, /read-only, /architect, /audit, /tokens, /trace, /metrics, /traces, /mode, /think, /review, /triage, /approve, /deny, /always-allow

### Tasks
1. Create panels for each category [L]
2. Wire all commands via VSCodeCommandBridge [L]
3. Add context menu integrations [M]
   - File explorer: Add to Context, Run PDSE, Commit File
   - Editor: Verify Selection, Add Rail, Search Similar
4. Add Command Palette contributions (Ctrl+Shift+P) [M]
5. Add keybindings for top 20 commands [S]

### Files
- `packages/vscode/src/panels/*.ts` (NEW - ~3000 lines total)
- `packages/vscode/package.json` (+500 lines - contributions)
- `packages/vscode/src/command-bridge.ts` (+1000 lines - extended)

### Success Criteria
- All 86 commands accessible from VSCode
- Context menus in right places
- Keybindings work
- All commands maintain correct state
- No regressions in existing features

---

## Phase 5: UX Enhancements [16h] [M]

**Goal:** Make VSCode better than CLI with visual improvements

### Tasks
1. Visual diff viewer (split pane, syntax highlighting) [M]
2. PDSE score badges in file explorer [S]
3. Inline verification annotations (squigglies for issues) [M]
4. Command history with re-run buttons [S]
5. Drag-and-drop file context management [M]
6. Session snapshots (visual timeline view) [S]
7. Agent progress visualization (live tree view) [M]
8. Quick actions sidebar (most-used commands) [S]
9. Status bar integration (model, PDSE, active agents) [S]
10. Notification toasts for background completions [M]

### Files
- `packages/vscode/src/ui-enhancements/diff-viewer.ts` (NEW - 300 lines)
- `packages/vscode/src/ui-enhancements/file-decorations.ts` (NEW - 200 lines)
- `packages/vscode/src/ui-enhancements/annotations.ts` (NEW - 250 lines)
- `packages/vscode/src/ui-enhancements/quick-actions.ts` (NEW - 150 lines)
- `packages/vscode/src/status-bar.ts` (+100 lines - extend)

### Success Criteria
- Diff viewer better than git difftool
- File explorer shows PDSE badges
- Inline squigglies show verification issues
- Quick actions bar has 10 most-used commands
- Status bar always shows current state
- Toasts don't interrupt workflow

---

## Phase 6: Testing & Documentation [12h] [M]

**Goal:** Ensure quality, no regressions, users can discover features

### Tasks
1. Integration tests for all 86 commands [M]
2. Slash autocomplete edge case tests [S]
3. Planning mode workflow tests [S]
4. Background agent lifecycle tests [M]
5. Automation trigger tests [M]
6. Performance tests (large repos, long sessions) [S]
7. Memory leak tests (webview cleanup) [S]
8. Polish error messages and loading states [S]
9. Add onboarding tutorial (first-time UX) [S]
10. Update documentation (README, CHECK_VERSION, tutorials) [S]

### Files
- `packages/vscode/src/__tests__/integration.test.ts` (NEW - 500 lines)
- `packages/vscode/src/__tests__/autocomplete.test.ts` (NEW - 200 lines)
- `packages/vscode/src/__tests__/planning.test.ts` (NEW - 150 lines)
- `packages/vscode/src/__tests__/commands.test.ts` (NEW - 400 lines)
- `packages/vscode/README.md` (+300 lines)
- `CHECK_VERSION.md` (+100 lines)

### Success Criteria
- 90% test coverage for new code
- All integration tests pass
- PDSE score >= 85 for all new files
- Zero anti-stub violations
- Constitution check passes
- Documentation covers all features

---

## Technology Decisions

### 1. Message Passing Architecture
**Decision:** Use VSCode webview postMessage for all commands  
**Why:** Existing pattern, proven at scale, supports streaming  
**Alternative Rejected:** Direct imports (breaks webview isolation)

### 2. State Management
**Decision:** Share ReplState between CLI and VSCode  
**Why:** Reuse all CLI logic, avoid duplication  
**Alternative Rejected:** Separate state (maintenance burden)

### 3. Command Routing
**Decision:** Reuse packages/cli/src/slash-commands.ts handlers  
**Why:** 100% parity guaranteed, no translation needed  
**Alternative Rejected:** Rewrite for VSCode (wasteful duplication)

### 4. Autocomplete Engine
**Decision:** Port qwen-code's useSlashCompletion (fzf-based)  
**Why:** OSS pattern harvested, proven UX, fuzzy matching  
**Alternative Rejected:** Prefix match (inferior UX)

### 5. UI Framework
**Decision:** Vanilla HTML/CSS/JS in webview  
**Why:** No build complexity, fast iteration, already working  
**Alternative Rejected:** React/Vue (avoid dependencies)

---

## Risk Mitigations

### Risk 1: Webview Performance (High)
**Impact:** Slow autocomplete, laggy UI  
**Mitigation:**
- Debounce autocomplete (150ms)
- Virtual scrolling for lists
- Cache command metadata
- Lazy load panels

### Risk 2: State Synchronization (Medium)
**Impact:** CLI/VSCode state diverges  
**Mitigation:**
- Single source of truth (ReplState)
- Atomic state updates
- State validation
- Checkpoint/resume support

### Risk 3: Message Payload Size (Medium)
**Impact:** Large diffs crash webview  
**Mitigation:**
- Streaming for large responses
- Pagination (max 100 items)
- Truncation warnings
- Disk persistence for large artifacts

### Risk 4: Regression (High)
**Impact:** Existing features break  
**Mitigation:**
- Integration tests before each phase
- Feature flags
- Git tags per phase
- Manual QA checklist

---

## Effort Estimates

| Phase | Hours | Size | Parallelizable |
|-------|-------|------|----------------|
| Phase 1: Autocomplete | 8 | M | Yes with Phase 2 planning |
| Phase 2: Planning Mode | 24 | L | No (critical path) |
| Phase 3: High-Priority | 32 | L | Yes (11 commands) |
| Phase 4: Remaining | 40 | L | Yes (63 commands) |
| Phase 5: UX Polish | 16 | M | Yes (10 tasks) |
| Phase 6: Testing | 12 | M | No (verification) |
| **Total** | **132** | | |

**Parallelization:**
- 4 developers: ~62 hours (~1.5 weeks)
- 2 developers: ~85 hours (~2 weeks)
- 1 developer: ~132 hours (~3.3 weeks)

---

## Success Criteria

### Functional
- ✅ All 86 CLI commands work in VSCode
- ✅ Slash autocomplete < 150ms
- ✅ Planning mode has visual UI
- ✅ Background agents show live progress
- ✅ No regressions in chat/PDSE/inline

### Performance
- ✅ Autocomplete p95 < 150ms
- ✅ Command execution < 500ms (local ops)
- ✅ Webview memory < 100MB
- ✅ No leaks over 8-hour session

### Quality
- ✅ 90% test coverage
- ✅ All tests pass
- ✅ PDSE >= 85
- ✅ Zero anti-stub violations
- ✅ Constitution passes

### UX
- ✅ First-time user completes /plan without docs
- ✅ Visual feedback for long operations
- ✅ Actionable error messages
- ✅ Keyboard shortcuts for top 10 commands

---

## Next Steps

1. **Approve Plan** - Stakeholder sign-off
2. **Run `/tasks`** - Break into executable units
3. **Create Branch** - `feat/vscode-parity`
4. **Execute Phase 1** - Slash autocomplete
5. **Demo & Iterate** - User feedback per phase

---

**Status:** Ready for execution  
**Last Updated:** 2026-04-02  
**Version:** 1.0
