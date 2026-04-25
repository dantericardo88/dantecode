# AGENTS.dc.md

# DanteCode project context — loaded automatically on every session start.

## Project

Name: DanteCode
Language: TypeScript
Framework: npm + Turborepo Monorepo
Runtime: Node.js 20+

## Build Commands

- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Test: `npm test`
- Build: `npm run build`
- Dev: `npm run dev`
- Format: `npm run format`

## Code Style

- TypeScript strict mode with zero `any` casts
- ESM modules with `.js` extensions in imports (for Node ESM resolution)
- Named exports preferred over default exports
- Zod for runtime validation at system boundaries
- YAML for human-readable config, JSONL for append-only logs
- Child process operations use `execSync` with `stdio: ["pipe", "pipe", "pipe"]`
- Error messages must be actionable (tell the user what to do, not just what went wrong)
- All git commit messages use HEREDOC format

## Architecture Notes

- Monorepo with 9 packages in `packages/` directory
- Dependency order: config-types → core → danteforge → git-engine → skill-adapter → sandbox → cli → vscode → desktop
- `config-types` is the foundation — all interfaces and types live here
- `core` contains model routing (Grok default with Anthropic fallback), STATE.yaml management, and audit logging
- `danteforge` is the "brain" — PDSE scoring, anti-stub scanning, autoforge IAL, GStack, lessons
- `git-engine` handles auto-commits, worktrees, diffs, and repo-map generation
- `skill-adapter` imports/wraps skills from Claude Code, Continue.dev, and OpenCode
- `sandbox` provides Docker-based execution isolation (with local fallback)
- `cli` is the terminal REPL with all commands and slash commands
- `vscode` is the VS Code extension with chat sidebar, inline completions, and PDSE diagnostics
- `desktop` wraps the CLI in an Electron shell

## DanteForge Gates

PDSE threshold: 85
Max Autoforge iterations: 3
GStack commands: typecheck, lint, test
Anti-Stub enforcement: Layer 1 (scanner) + Layer 2 (PDSE Clarity=0) + Layer 3 (GStack) + Layer 4 (CI)

## Important File Patterns

- Source: `packages/*/src/**/*.ts`
- Tests: `packages/*/src/**/*.test.ts`
- Config: `*.config.ts`, `tsconfig*.json`
- Package manifests: `packages/*/package.json`

## Do Not Touch

- `Docs/` — original PRD documents (read-only reference)
- `node_modules/` — managed by npm
- `.dantecode/worktrees/` — managed by git-engine
- `.dantecode/audit.jsonl` — append-only audit log
- `.dantecode/lessons.db` — managed by danteforge lessons system

## VS Code Extension — Critical Rules

**NEVER overwrite these deployed extension bundles directly:**
- `C:\Users\richa\.antigravity\extensions\dantecode.dantecode-1.0.0\dist\extension.js`
- `C:\Users\richa\.vscode\extensions\dantecode.dantecode-1.0.0\dist\extension.js`

These are build artefacts. The authoritative source is `packages/vscode/src/sidebar-provider.ts`.

**NEVER reinstall or replace the extension from a VSIX or zip** — doing so overwrites the deployed bundle with a version that is missing critical fixes.

**NEVER run `vsce package` and deploy the output** without first building from `packages/vscode/src/`.

**Correct workflow for any change to the VS Code extension:**
1. Edit source in `packages/vscode/src/`
2. Run `cd packages/vscode && npm run deploy` — this builds AND copies to both extension dirs
3. Reload Antigravity: `Ctrl+Shift+P` → `Developer: Reload Window`

**Why this matters — fixes that must not be lost:**
- `streamOllamaDirect()` in `sidebar-provider.ts` (~line 2559): bypasses Vercel AI SDK for Ollama streaming. Without this, all Ollama models hang with `_waiting for model..._` forever.
- `supportsToolCalls: provider !== "ollama"` (~line 659): prevents passing tool schemas to Ollama models that reject them.
- Timeout→fallback logic (~line 1186): when a cloud model takes >30s to respond, retries with the fallback model instead of showing a dead-end error.
- Heartbeat uses `partial` only (never `chunk`) so waiting indicators don't pollute the final response.

## Package.json — activationEvents

`packages/vscode/package.json` must keep `"activationEvents": ["*"]` and `"capabilities": { "untrustedWorkspaces": { "supported": "always" } }`. Do not revert these to defaults — Antigravity IDE requires `"*"` for immediate activation.
