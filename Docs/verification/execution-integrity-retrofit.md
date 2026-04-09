# Execution Integrity Retrofit

This note documents the execution-integrity runtime that now guards DanteCode's CLI and surface status payloads.

## Runtime Contract

Completion is no longer accepted from assistant narration alone.

Implementation requests must now pass through:

1. Tool execution with structured evidence.
2. Execution-integrity ledger recording tool calls, mutations, and validations.
3. A canonical completion gate that evaluates the session ledger before success is allowed.
4. A shared truth payload written to `.dantecode/execution-truth/latest.json` for UI clients.

## What Changed

### Canonical completion authority

- The CLI now uses `executionIntegrity.runCompletionGate(...)` as the pre-exit and final-exit authority.
- The old heuristic `CompletionGate` is no longer the runtime source of truth for CLI completion.

### Tool proof survives execution

- CLI tool execution outcomes now preserve structured evidence instead of flattening everything to strings.
- Mutating tools emit before/after hashes, diff stats, and observable-mutation flags.
- Validation-style shell commands emit structured validation records.

### File-integrity safeguards

- Existing-file writes require a prior read in the same session.
- Write and edit paths check stale reads using tracked mtimes.
- Per-file write locking prevents concurrent mutation races.

### xAI/Grok hardening

- Grok reasoning options now use the OpenAI-compatible provider namespace expected by the AI SDK.
- `streamWithTools()` enriches Grok configs with the resolved xAI API key before provider construction.
- Native streamed tool-call fragments (`tool-call-streaming-start` + `tool-call-delta`) are assembled and repaired before tool dispatch.

### Persistent rules

- DanteCode now loads `.dantecode/rules.md` and `.dantecode/rules/*.md` from the project root.
- Global operator rules are also loaded from `~/.dantecode/rules.md` and `~/.dantecode/rules/*.md` when present.
- Both the CLI and VS Code system prompts inject the same persisted rules section, so prompt-level constraints stay consistent across surfaces.

### Surface truth sync

- The CLI writes a canonical execution-truth payload to `.dantecode/execution-truth/latest.json`.
- Desktop status IPC reads that payload instead of relying on hardcoded mode/model state.
- The desktop fallback shell now renders live model, provider, mode, gate, file, mutation, and validation state from the truth payload instead of static placeholder text.
- VS Code status rendering reads the same payload and exposes gate status, changed files, mutation count, validation count, and verification time.

### Operational scripts

- `scripts/constitution-check.mjs`, `scripts/verify-claims.mjs`, and `scripts/pre-commit-hook.js` now run as valid direct Node scripts.

## Acceptance Matrix

The following checks passed during the retrofit:

- `npm run build --workspace=packages/core`
- `npm run typecheck --workspace=packages/core`
- `npm run build --workspace=packages/cli`
- `npm run typecheck --workspace=packages/cli`
- `npm run typecheck --workspace=packages/vscode`
- `npm run typecheck --workspace=packages/desktop`
- `npx vitest run packages/core/src/execution-integrity.test.ts`
- `npx vitest run packages/core/src/persistent-rules.test.ts`
- `npx vitest run packages/core/src/model-router.test.ts`
- `npx vitest run packages/cli/src/agent-loop-error-paths.test.ts`
- `npx vitest run packages/cli/src/context-manager.test.ts`
- `npx vitest run packages/cli/src/agent-loop.test.ts --testNamePattern "repairs streamed native tool-call deltas before dispatching tools"`
- `npm run constitution-check`
- `npm run verify-claims`
- `node scripts/pre-commit-hook.js`

## Known Limits

- `verify-claims` still reports Google provider proof as failing when `GOOGLE_API_KEY` is not configured in the environment. That is an environment/config gap, not a runtime regression in the execution-integrity path.
- Archived session docs under `docs/sessions/` may still describe older implementation states; treat this note and the passing commands above as the current source of truth for the retrofit.
