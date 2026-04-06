# DanteCode VS Code Extension — Changelog

## 0.9.3 — April 2026

### New Features

- **Arena mode** — compare 2+ models on the same task in isolated git worktrees; picks the winner by PDSE score (`/arena` command)
- **Workflow slash commands** — `/inferno`, `/nova`, `/forge` etc. now load the full DanteForge contract (stages, failure policy, rollback policy) and inject it into the system prompt for every model
- **SEARCH/REPLACE block editing** — targeted Aider-style edits replace only the changed block instead of rewriting whole files
- **Post-edit linting loop** — agent detects lint errors after writes and self-corrects automatically (max 3 retries)
- **Voice input** — Web Speech API integration in the VS Code sidebar for hands-free prompting
- **In-session cron scheduling** — `/cron` command schedules recurring tasks within the active session
- **One-click deployment** — `/deploy` command and a `$(rocket) Deploy` status bar button (auto-detects Vercel/Netlify/Fly)
- **Follow-up suggestions** — clickable pill buttons appear after each AI response for common next steps
- **12-event hook system** — PreToolUse, PostToolUse, SessionStart, SessionEnd, and 8 more automation trigger points
- **Dynamic context pruning** — inception messages automatically summarize and compress context when utilization exceeds 80%
- **Auto-commit after writes** — opt-in via `STATE.yaml` `git.autoCommit: true`
- **Architect/editor two-stage mode** — opt-in via `config.architectEditorMode`; architect plans, editor implements
- **Platform-native sandboxing** — macOS Seatbelt, Linux Bubblewrap integration for stronger isolation
- **LSP config auto-detection** — reads project `tsconfig.json`, `eslintrc`, and `pyrightconfig.json` automatically
- **5 new model providers** — Mistral AI, DeepSeek, Together AI, Perplexity, Groq (extended model list)
- **Character-level diff view** — `Ctrl+Shift+D` shows character-granular diffs for precise review
- **Stage progress bar** — workflow commands show a live progress bar through all pipeline stages
- **Cost tracking in status bar** — cumulative session cost shown with model tier badge
- **Party mode subprocess adapters** — party lanes now spawn real headless CLI agents via `DanteCodeAdapter`
- **Benchmark report** — `/benchmark` command shows SWE-bench pass rates per repository and run

### Fixes

- Workflow commands (`/inferno`, `/nova`) now execute for the full 150 rounds instead of stopping early
- Confab-guard false-positive threshold raised for workflow read phases to reduce spurious blocks
- `maxTokens` now reads from `STATE.yaml` instead of the hardcoded 8192 default
- `STATE.yaml` schema accepts legacy files missing newer optional fields without erroring
- Extension activates without a native module crash when optional packages are absent
- `hard_stop` failure policy is now enforced — a stage error aborts the entire workflow loop
