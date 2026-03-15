# AGENTS.dc.md
# DanteCode project context — loaded automatically on every session start.

## Project

Name: DanteCode
Language: TypeScript
Framework: Bun + Turborepo Monorepo
Runtime: Bun v1.2+

## Build Commands

- Typecheck: `bun run typecheck`
- Lint: `bun run lint`
- Test: `bun run test`
- Build: `bun run build`
- Dev: `bun run dev`
- Format: `bun run format`

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
- `core` contains model routing (Grok-first with Anthropic fallback), STATE.yaml management, and audit logging
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
- `node_modules/` — managed by Bun
- `.dantecode/worktrees/` — managed by git-engine
- `.dantecode/audit.jsonl` — append-only audit log
- `.dantecode/lessons.db` — managed by danteforge lessons system
