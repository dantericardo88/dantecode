# EXECUTION PACKET: DanteTUI — Terminal UI Upgrade
## Developer UX / Polish (8.0 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteTUI |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/cli` (REPL upgrade) + `@dantecode/ux-polish` (new renderers) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~1,400 source + ~600 tests |
| **Sprint Time** | 3-5 hours for Claude Code |

---

## 1. The Problem

DanteCode's CLI uses a raw `readline.createInterface()` REPL. It works, but it looks like a Node.js debug console, not a production coding agent. The `@dantecode/ux-polish` package has a full ThemeEngine, RichRenderer, ProgressOrchestrator, OnboardingWizard, accessibility layer, and design token system — but the REPL barely uses them. Output is `process.stdout.write()` with raw ANSI codes.

When you film the demolition derby comparison videos, the terminal UX is the first thing viewers see. Claude Code has Ink-based React rendering with streaming diffs. Codex has a full-screen TUI with syntax highlighting and theme picker. OpenCode has Bubble Tea with Vim-like editing. DanteCode has `readline` with colored text. The code behind it is better — the surface doesn't show it.

**The approach: NOT a full Ink rewrite.** That's a multi-week project and a massive risk. Instead, this PRD upgrades the existing readline REPL with 5 targeted additions that make it feel production-grade using the ux-polish infrastructure that already exists but isn't wired. The goal is maximum visual impact with minimum architectural disruption.

---

## 2. Competitive Landscape

### Claude Code (9.0 — UX)
- React/Ink terminal UI with streaming
- Syntax-highlighted diffs with accept/reject
- Checkpoint/rewind system with visual indicators
- Output styles (Explanatory, Learning, Concise)
- Status footer showing model, tokens, cost
- `/theme` for customization

### Codex CLI (9.0 — UX)
- Full-screen TUI with syntax-highlighted fenced code blocks and diffs
- `/theme` command with live preview and persistence
- Token usage tracking in prompt
- Structured output for CI scripting

### OpenCode (9.0 — UX)
- Bubble Tea TUI with Vim-like editor
- Side-by-side diff rendering
- Scroll acceleration
- `/compact` for session summarization display
- Session stats panel

### DanteCode Current (8.0 — UX)
- readline REPL
- RichRenderer + ProgressOrchestrator exist but barely wired
- ThemeEngine exists with 4 themes but no `/theme` command
- StreamRenderer does basic ANSI markdown
- No diff viewer
- No status bar
- No token tracking display

---

## 3. The 5 Upgrades

### Upgrade 1: Persistent Status Bar
### Upgrade 2: Syntax-Highlighted Diff Viewer
### Upgrade 3: Token Usage Dashboard
### Upgrade 4: /theme Command with Live Preview
### Upgrade 5: Enhanced Prompt with Context

Each upgrade is self-contained. They can be built and shipped independently. Together they transform the visual experience.

---

## 4. Component Specifications

### 4.1 — Persistent Status Bar (`ux-polish/src/surfaces/status-bar.ts`)

A single-line status bar at the bottom of the terminal showing active context. Redraws on every REPL prompt, not on every keystroke. Zero performance impact.

```typescript
/**
 * Persistent status bar for the CLI REPL.
 * Renders a single line showing: model | tokens | session | sandbox | PDSE.
 * Uses ANSI escape codes to position at the bottom of the terminal.
 * 
 * Inspired by: VS Code status bar, Codex TUI footer, Claude Code prompt footer.
 */

export interface StatusBarState {
  modelLabel: string;           // "grok/grok-3" or "anthropic/claude-sonnet-4"
  tokensUsed: number;           // cumulative session tokens
  tokenBudget?: number;         // max tokens for this session (if set)
  sessionName?: string;         // from --name or default
  sandboxMode: string;          // "workspace-write" | "read-only" | "full-access"
  pdseScore?: number;           // last PDSE score (if verification ran)
  featureFlags?: string[];      // active experimental features
  elapsedMs?: number;           // session elapsed time
}

export class StatusBar {
  private state: StatusBarState;
  private readonly theme: ThemeEngine;
  private enabled: boolean = true;

  constructor(initialState: StatusBarState, theme?: ThemeEngine);

  /** Update the state and redraw. */
  update(patch: Partial<StatusBarState>): void;

  /** Render the status bar string (does NOT write to stdout). */
  render(): string;

  /** Write the status bar to the terminal bottom. */
  draw(): void;

  /** Clear the status bar (e.g., on exit). */
  clear(): void;

  /** Enable/disable the status bar. */
  setEnabled(enabled: boolean): void;
}
```

**Rendering format (single line, themed):**
```
 🔧 grok/grok-3 │ 📊 12,450 tokens │ 📁 my-session │ 🔒 workspace-write │ ✅ PDSE: 92
```

**Implementation details:**
- Uses ANSI escape `\x1b[s` (save cursor), `\x1b[{rows};1H` (move to bottom), render, `\x1b[u` (restore cursor)
- Detects terminal height via `process.stdout.rows`
- Falls back to no-op on piped/non-TTY output
- Uses ThemeEngine for colors (semantic tokens, not raw ANSI)
- Redraws only when `update()` is called (not continuously)

**Wire into REPL (`packages/cli/src/repl.ts`):**
```typescript
// After session init (~line 300):
const statusBar = new StatusBar({
  modelLabel: modelConfig.provider + "/" + modelConfig.modelId,
  tokensUsed: 0,
  sandboxMode: state.sandbox?.mode ?? "workspace-write",
  sessionName: session.name ?? session.id.slice(0, 8),
}, themeEngine);

// Before each rl.prompt():
statusBar.draw();

// After each agent-loop round completes:
statusBar.update({ tokensUsed: session.totalTokens, pdseScore: lastPdseScore });
```

---

### 4.2 — Syntax-Highlighted Diff Viewer (`ux-polish/src/surfaces/diff-renderer.ts`)

When the agent writes or edits a file, show a syntax-highlighted unified diff instead of raw text.

```typescript
/**
 * Terminal diff renderer with syntax highlighting.
 * Renders unified diffs with:
 *   - Green lines for additions (+ prefix)
 *   - Red lines for deletions (- prefix)
 *   - Dim for context lines
 *   - Line numbers in the gutter
 *   - File header with path and change summary
 *   - Optional per-hunk accept/reject (future)
 *
 * No external dependencies. Uses ANSI escape codes only.
 */

export interface DiffRenderOptions {
  /** Max lines to display before truncating. Default: 50. */
  maxLines?: number;
  /** Show line numbers in gutter. Default: true. */
  lineNumbers?: boolean;
  /** Colorize code syntax within diff lines. Default: true. */
  syntaxHighlight?: boolean;
  /** Theme for colors. */
  theme?: ThemeEngine;
  /** Compact mode: show only changed lines, no context. */
  compact?: boolean;
}

export interface DiffRenderResult {
  rendered: string;    // Full ANSI-formatted diff string
  additions: number;   // Count of added lines
  deletions: number;   // Count of removed lines
  fileCount: number;   // Number of files in the diff
  truncated: boolean;  // Whether output was truncated
}

/**
 * Render a unified diff string to themed ANSI output.
 */
export function renderDiff(
  unifiedDiff: string,
  options?: DiffRenderOptions,
): DiffRenderResult;

/**
 * Render a before/after comparison for a single file.
 * Used when the full diff isn't available (e.g., Write tool output).
 */
export function renderBeforeAfter(
  filePath: string,
  before: string,
  after: string,
  options?: DiffRenderOptions,
): DiffRenderResult;

/**
 * Minimal syntax highlighting for common languages.
 * NOT a full parser — just keyword/string/comment coloring for diff readability.
 * Detects language from file extension.
 */
export function highlightLine(line: string, fileExtension: string, theme: ThemeEngine): string;
```

**Syntax highlighting (lightweight, no deps):**
```typescript
const KEYWORD_PATTERNS: Record<string, RegExp> = {
  ts: /\b(import|export|const|let|var|function|class|interface|type|return|if|else|for|while|async|await|new|throw|try|catch|finally)\b/g,
  js: /\b(import|export|const|let|var|function|class|return|if|else|for|while|async|await|new|throw|try|catch|finally)\b/g,
  py: /\b(import|from|def|class|return|if|elif|else|for|while|with|as|try|except|finally|raise|yield|async|await)\b/g,
  rs: /\b(fn|let|mut|const|struct|enum|impl|trait|use|pub|mod|match|if|else|for|while|loop|return|async|await)\b/g,
  go: /\b(func|var|const|type|struct|interface|return|if|else|for|range|switch|case|defer|go|chan|select)\b/g,
};

const STRING_PATTERN = /(["'`])(?:(?!\1|\\).|\\.)*\1/g;
const COMMENT_PATTERNS: Record<string, RegExp> = {
  ts: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
  py: /#.*$/gm,
  rs: /\/\/.*$/gm,
};

function highlightLine(line: string, ext: string, theme: ThemeEngine): string {
  const colors = theme.resolve();
  const lang = ext.replace(/^\./, "");
  
  // Order matters: comments first (greedy), then strings, then keywords
  let result = line;
  const commentPattern = COMMENT_PATTERNS[lang];
  if (commentPattern) {
    result = result.replace(commentPattern, m => `${colors.dim}${m}${colors.reset}`);
  }
  result = result.replace(STRING_PATTERN, m => `${colors.string}${m}${colors.reset}`);
  const kwPattern = KEYWORD_PATTERNS[lang];
  if (kwPattern) {
    result = result.replace(kwPattern, m => `${colors.keyword}${m}${colors.reset}`);
  }
  return result;
}
```

**Wire into REPL/agent-loop:**

In `packages/cli/src/tools.ts`, after `toolWrite()` and `toolEdit()` complete successfully, render the diff:

```typescript
// In toolWrite, after the file is written:
if (ctx.diffRenderer && beforeContent !== undefined) {
  const diffResult = renderBeforeAfter(resolvedPath, beforeContent, newContent, { maxLines: 40 });
  process.stdout.write(diffResult.rendered + "\n");
}

// In toolEdit, after the edit is applied:
if (ctx.diffRenderer && originalContent && editedContent) {
  const diffResult = renderBeforeAfter(resolvedPath, originalContent, editedContent, { compact: true });
  process.stdout.write(diffResult.rendered + "\n");
}
```

---

### 4.3 — Token Usage Dashboard (`ux-polish/src/surfaces/token-dashboard.ts`)

Shows token usage breakdown when requested via `/cost` or automatically at session end.

```typescript
/**
 * Token usage dashboard for the CLI.
 * Shows: total tokens, by-tool breakdown, cost estimate, context utilization.
 */

export interface TokenUsageData {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  byTool: Record<string, { calls: number; tokens: number }>;
  modelId: string;
  contextWindow: number;
  contextUtilization: number;  // 0-1
  estimatedCost?: number;       // in USD, approximate
  sessionDurationMs: number;
}

/**
 * Render a token usage dashboard as themed ANSI output.
 */
export function renderTokenDashboard(data: TokenUsageData, theme?: ThemeEngine): string;
```

**Output format (themed):**
```
╭─ Token Usage ────────────────────────────────────╮
│ Model:    grok/grok-3                            │
│ Duration: 12m 34s                                │
│                                                  │
│ Input:    8,234 tokens                           │
│ Output:   4,216 tokens                           │
│ Total:   12,450 tokens                           │
│ Context: ████████░░░░░░░░ 48% of 131,072         │
│                                                  │
│ By Tool:                                         │
│   Bash     6 calls   3,120 tokens                │
│   Write    4 calls   2,890 tokens                │
│   Read    12 calls   4,100 tokens                │
│   Edit     3 calls   2,340 tokens                │
│                                                  │
│ Est. Cost: ~$0.024                               │
╰──────────────────────────────────────────────────╯
```

**Wire as `/cost` slash command and session-end display:**
```typescript
// New slash command
{ name: "cost", description: "Show token usage and cost estimate", handler: costCommand }

// At session end in repl.ts flush:
const dashboard = renderTokenDashboard(session.tokenData, themeEngine);
process.stdout.write(dashboard + "\n");
```

---

### 4.4 — `/theme` Command with Live Preview

The ThemeEngine already supports 4+ themes. Wire it as a slash command.

```typescript
/**
 * /theme — switch terminal theme with live preview.
 * 
 * Usage:
 *   /theme              — list available themes with preview
 *   /theme dark         — switch to dark theme
 *   /theme light        — switch to light theme
 *   /theme solarized    — switch to solarized theme
 *   /theme dracula      — switch to dracula theme
 * 
 * Theme preference is persisted in .dantecode/STATE.yaml.
 */

async function themeCommand(args: string, state: ReplState): Promise<string> {
  const themeEngine = getThemeEngine();
  const available = ["default", "dark", "light", "solarized", "dracula", "minimal"];

  if (!args.trim()) {
    // Show all themes with a sample preview line
    const lines = available.map(name => {
      themeEngine.setTheme(name as ThemeName);
      const colors = themeEngine.resolve();
      const preview = `  ${colors.accent}${name}${colors.reset} — ${colors.success}✓ success${colors.reset} ${colors.error}✗ error${colors.reset} ${colors.warning}⚠ warning${colors.reset} ${colors.dim}dim text${colors.reset}`;
      return preview;
    });
    // Restore current theme
    themeEngine.setTheme(state.theme);
    return `Available themes:\n${lines.join("\n")}\n\nCurrent: ${state.theme}\nUsage: /theme <name>`;
  }

  const themeName = args.trim().toLowerCase();
  if (!available.includes(themeName)) {
    return `Unknown theme: ${themeName}. Available: ${available.join(", ")}`;
  }

  themeEngine.setTheme(themeName as ThemeName);
  state.theme = themeName;
  // Persist to STATE.yaml
  await saveThemePreference(state.projectRoot, themeName);

  // Show preview with new theme
  const colors = themeEngine.resolve();
  return `Theme set to ${colors.accent}${themeName}${colors.reset}. Preview:\n` +
    `  ${colors.success}✓ Verification passed${colors.reset}\n` +
    `  ${colors.error}✗ Anti-stub violation${colors.reset}\n` +
    `  ${colors.warning}⚠ PDSE score: 78 (below threshold)${colors.reset}\n` +
    `  ${colors.dim}Session: my-session | Tokens: 12,450${colors.reset}`;
}
```

---

### 4.5 — Enhanced Prompt with Context

Replace the simple `> ` readline prompt with a context-rich prompt that shows active state.

```typescript
/**
 * Build a context-aware prompt string for the readline interface.
 * Shows: session name, model shorthand, sandbox indicator, round count.
 */
export function buildPrompt(state: {
  sessionName?: string;
  modelShort: string;      // e.g. "grok-3" or "opus"
  sandboxMode: string;
  roundCount: number;
  lastPdse?: number;
  theme: ThemeEngine;
}): string {
  const c = state.theme.resolve();
  const parts: string[] = [];

  // Session name (if set)
  if (state.sessionName) {
    parts.push(`${c.dim}${state.sessionName}${c.reset}`);
  }

  // Model shorthand
  parts.push(`${c.accent}${state.modelShort}${c.reset}`);

  // Sandbox indicator
  const sandboxIcon = state.sandboxMode === "read-only" ? "🔒"
    : state.sandboxMode === "full-access" ? "⚡"
    : "🛡️";
  parts.push(sandboxIcon);

  // Round count
  if (state.roundCount > 0) {
    parts.push(`${c.dim}r${state.roundCount}${c.reset}`);
  }

  // Last PDSE (if recent)
  if (state.lastPdse !== undefined) {
    const pdseColor = state.lastPdse >= 85 ? c.success : state.lastPdse >= 70 ? c.warning : c.error;
    parts.push(`${pdseColor}P:${state.lastPdse}${c.reset}`);
  }

  return `${parts.join(" ")} ${c.accent}❯${c.reset} `;
}
```

**Example prompt:**
```
my-session grok-3 🛡️ r12 P:92 ❯ 
```

**Wire into REPL:**
Replace the static `rl.setPrompt("> ")` with `rl.setPrompt(buildPrompt(currentState))` and update after each round.

---

## 5. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/ux-polish/src/surfaces/status-bar.ts` | 120 | Persistent bottom status bar |
| 2 | `packages/ux-polish/src/surfaces/diff-renderer.ts` | 250 | Syntax-highlighted diff viewer |
| 3 | `packages/ux-polish/src/surfaces/token-dashboard.ts` | 120 | Token usage dashboard |
| 4 | `packages/ux-polish/src/surfaces/prompt-builder.ts` | 80 | Context-aware prompt builder |
| 5 | `packages/ux-polish/src/surfaces/status-bar.test.ts` | 80 | Status bar tests |
| 6 | `packages/ux-polish/src/surfaces/diff-renderer.test.ts` | 150 | Diff renderer tests |
| 7 | `packages/ux-polish/src/surfaces/token-dashboard.test.ts` | 80 | Token dashboard tests |
| 8 | `packages/ux-polish/src/surfaces/prompt-builder.test.ts` | 60 | Prompt builder tests |

### MODIFIED Files

| # | Path | Change |
|---|---|---|
| 9 | `packages/ux-polish/src/index.ts` | Export new surface components |
| 10 | `packages/cli/src/repl.ts` | Wire StatusBar, buildPrompt, token tracking, session-end dashboard |
| 11 | `packages/cli/src/tools.ts` | Wire DiffRenderer after toolWrite/toolEdit |
| 12 | `packages/cli/src/slash-commands.ts` | Add /theme, /cost commands |
| 13 | `packages/ux-polish/src/types.ts` | Add StatusBarState, DiffRenderOptions, TokenUsageData types (if not already there) |

### Total: 8 new files + 5 modified files, ~1,400 LOC source + ~600 LOC tests

---

## 6. Tests

### `status-bar.test.ts` (~8 tests)
1. Render with all fields populated → contains model, tokens, sandbox
2. Render with minimal state → no crash, shows available fields
3. Update partial state → only updated fields change
4. Theme affects colors in output
5. Non-TTY → returns empty string (no-op)
6. Terminal resize → adjusts line position
7. Clear → removes status bar from terminal
8. Disabled → draw() is no-op

### `diff-renderer.test.ts` (~10 tests)
1. Render unified diff → additions green, deletions red
2. Render with line numbers → gutter shows numbers
3. File header shows path and +/- summary
4. Truncation at maxLines → "truncated" flag true
5. Empty diff → "No changes" message
6. Compact mode → only changed lines, no context
7. `renderBeforeAfter()` generates correct diff from two strings
8. Syntax highlighting: TypeScript keywords colored
9. Syntax highlighting: Python keywords colored
10. Unknown language → no syntax highlighting, still renders

### `token-dashboard.test.ts` (~6 tests)
1. Renders box with all fields
2. Context utilization bar → correct fill percentage
3. By-tool breakdown → sorted by token count descending
4. Zero tokens → shows "No token data"
5. Cost estimate → calculated from model pricing
6. Theme affects colors

### `prompt-builder.test.ts` (~5 tests)
1. Full state → all parts present in prompt
2. No session name → omitted from prompt
3. PDSE colors: ≥85 green, 70-84 yellow, <70 red
4. Round count 0 → omitted
5. Sandbox icons: read-only 🔒, workspace-write 🛡️, full-access ⚡

**Total: ~29 tests**

---

## 7. Claude Code Execution Instructions

**Single sprint, 3-5 hours. 2 phases with GStack gates.**

```
Phase 1: UX-Polish Surface Components (2-3h)
  1. Create packages/ux-polish/src/surfaces/status-bar.ts
  2. Create packages/ux-polish/src/surfaces/diff-renderer.ts (with highlightLine)
  3. Create packages/ux-polish/src/surfaces/token-dashboard.ts
  4. Create packages/ux-polish/src/surfaces/prompt-builder.ts
  5. Create all 4 test files
  6. Modify packages/ux-polish/src/index.ts — export new components
  7. Run: cd packages/ux-polish && npx vitest run
  GATE: All existing + new tests pass

Phase 2: REPL + CLI Wiring (1-2h)
  8. Modify packages/cli/src/repl.ts:
     - Import StatusBar, buildPrompt from ux-polish
     - Initialize StatusBar after session start
     - Replace static prompt with buildPrompt()
     - Update StatusBar after each agent round
     - Show token dashboard at session end
  9. Modify packages/cli/src/tools.ts:
     - Import renderBeforeAfter from ux-polish
     - Add diff display after toolWrite() and toolEdit()
  10. Modify packages/cli/src/slash-commands.ts:
     - Add /theme command with live preview
     - Add /cost command with token dashboard
  11. Run: npx turbo test
  GATE: Full test suite passes, 0 regressions
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- ZERO external dependencies for the TUI components — pure ANSI escape codes + existing ux-polish ThemeEngine
- All rendering functions must be pure (take state in, return string out) — no side effects in renderers
- Side effects (process.stdout.write) only in the REPL wiring layer
- All components must handle non-TTY gracefully (piped output, CI, etc.)
- The diff renderer's syntax highlighting is intentionally lightweight — keywords, strings, comments only. NOT a full parser.

---

## 8. Performance Budget

| Component | Budget |
|---|---|
| StatusBar.render() | < 1ms |
| StatusBar.draw() (ANSI write) | < 2ms |
| renderDiff (100-line diff) | < 5ms |
| highlightLine (single line) | < 0.1ms |
| renderTokenDashboard | < 1ms |
| buildPrompt | < 0.5ms |

None of these should be perceptible. The readline prompt loop is the bottleneck at ~16ms for 60fps redraw. These are all well under budget.

---

## 9. Design Decision: Why NOT Ink

Ink (React for terminals) is what Claude Code uses. It's powerful but:

1. **Adds React as a dependency** to a TypeScript CLI. DanteCode's dependency graph is already 22 packages. Adding React + Ink + Yoga layout engine is a major footprint increase.
2. **Requires rewriting the entire REPL** from readline to Ink's component model. That's a 1,000+ line rewrite with high regression risk.
3. **Claude Code has a dedicated team** maintaining their Ink integration. Solo founder + AI agents is better served by simple ANSI rendering.
4. **The ux-polish package already does rich rendering** — it just needs to be wired in. Adding Ink would make ux-polish redundant.

The pragmatic approach: use ux-polish's ThemeEngine for colors, pure functions for rendering, and ANSI escape codes for terminal positioning. This gives 90% of the visual impact with 10% of the complexity and zero new dependencies.

**If we need Ink later**, the rendering layer is cleanly separated (pure functions returning strings), so migrating to Ink components would only require wrapping the existing renderers — not rewriting them.

---

## 10. Success Criteria

| Criteria | Target |
|---|---|
| Status bar shows model + tokens + sandbox + PDSE | ✅ |
| Diff viewer renders colored diffs after Write/Edit | ✅ |
| Syntax highlighting for TS/JS/Python/Rust/Go | ✅ |
| `/cost` shows token usage dashboard | ✅ |
| `/theme` switches themes with live preview | ✅ |
| Context-aware prompt with model + sandbox + round | ✅ |
| Non-TTY → all components degrade gracefully | ✅ |
| Zero new npm dependencies | ✅ |
| Existing REPL tests | 0 regressions |
| All new files | PDSE ≥ 85, anti-stub clean |

---

## 11. Visual Impact Assessment

**Before (current REPL):**
```
> implement authentication for the API
[status] Starting grok/grok-3...
[tool] Write: src/auth.ts
[tool] Write: src/middleware.ts
[done] 2 files written, 4,216 tokens used.
> 
```

**After (with DanteTUI):**
```
my-session grok-3 🛡️ r5 P:92 ❯ implement authentication for the API

 ── grok/grok-3 responding ──────────────────────────

  Writing src/auth.ts...

  ┌─ src/auth.ts ─────────────────── +47 -0 ─┐
  │  1 │ + import { sign, verify } from 'jsonwebtoken';
  │  2 │ + import { compare, hash } from 'bcryptjs';
  │  3 │ +
  │  4 │ + export interface AuthConfig {
  │  5 │ +   secret: string;
  │  6 │ +   expiresIn: string;
  │  ...│   (42 more lines)
  └───────────────────────────────────────────┘

  Writing src/middleware.ts...

  ┌─ src/middleware.ts ───────────── +23 -0 ─┐
  │  1 │ + export function authMiddleware(config: AuthConfig) {
  │  ...│   (22 more lines)
  └───────────────────────────────────────────┘

  ✓ DanteForge: PDSE 92 | Anti-stub: clean | Constitution: pass

 🔧 grok/grok-3 │ 📊 4,216 tokens │ 📁 my-session │ 🛡️ workspace-write │ ✅ PDSE: 92
```

That's the difference between "it works" and "I want to film this." Same code underneath. Better surface.

---

*"People don't buy the best product. They buy the product that looks like the best product. Then they stay for the substance."*
