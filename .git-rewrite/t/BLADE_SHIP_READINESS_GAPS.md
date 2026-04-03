# Blade Ship Readiness Review

Generated from code inspection and executable verification on 2026-03-16.

This review is based on the repo's actual behavior, not the planning docs or README claims.

## Bottom line

The project has real substance. The core libraries, CLI packaging path, test suite, and quality gates are much stronger than a typical early-stage agent repo.

Blade is not ready to ship yet.

The main reason is not "the code is fake." The main reason is that the strongest parts are the backend libraries, while several user-facing and Blade-specific surfaces are still only partially wired:

- The VS Code extension still exposes multiple literal stub commands.
- The desktop app is mostly a branded shell, not a working agent client.
- Autoforge / Blade progress / tier-routing features exist largely as libraries and tests, but are not fully integrated into the runtime paths users actually touch.
- "Sandbox" and some "autoforge" controls currently behave more like UI/config toggles than enforced execution guarantees.

## What is genuinely strong right now

These parts are real and meaningful:

- Monorepo structure is coherent: `core`, `danteforge`, `git-engine`, `skill-adapter`, `cli`, `vscode`, `desktop`, `sandbox`.
- Baseline engineering discipline is solid: `npm run build`, `npm run typecheck`, `npm run lint`, and `npm test` all passed on this checkout.
- Test volume is substantial: coverage run passed with 621 tests.
- Coverage is excellent for the gated runtime packages: 94.66% statements / 84.58% branches / 94.7% functions / 94.66% lines.
- CLI packaging/install path is real:
  - `npm run smoke:cli` passed
  - `npm run smoke:install` passed
  - `npm run smoke:skill-import` passed
  - `npm run publish:dry-run` passed for the npm workspaces
- Core subsystems are not empty:
  - model routing exists
  - audit logging exists
  - PDSE scoring exists
  - anti-stub scanning exists
  - git diff / commit / worktree logic exists
  - skill import / wrapping / validation exists

That means the project has real momentum. This is not vapor.

## Commands I actually ran

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:coverage`
- `npm run smoke:cli`
- `npm run smoke:install`
- `npm run smoke:skill-import`
- `npm run publish:dry-run`
- `npm run smoke:provider`
- `npm run release:doctor`
- `npm --prefix packages/cli run clean`
- `npm --prefix packages/desktop run clean`
- `npm --prefix packages/vscode run package`
- `npm --prefix packages/desktop run build`

## Verified results

- All baseline quality gates passed locally.
- Provider smoke did not run live because no provider credentials were present.
- Release doctor still reports external blockers:
  - no live provider credential validation
  - no `NPM_TOKEN`
  - no `VSCE_PAT`
- Windows portability has real breakage:
  - `npm --prefix packages/cli run clean` failed because `rm` is not available
  - `npm --prefix packages/desktop run clean` failed for the same reason
  - `npm --prefix packages/vscode run package` failed because `vsce` is not installed locally

## Critical blockers before Blade can be called ship-ready

### 1. VS Code still exposes stubbed product commands

The extension registers several commands that only show stub / coming soon messages instead of performing the advertised action.

Evidence:

- `packages/vscode/src/extension.ts:169-187` imports Claude skills with a stub notification.
- `packages/vscode/src/extension.ts:199-203` runs GStack with a stub notification.
- `packages/vscode/src/extension.ts:224-227` shows lessons with a stub notification.
- `packages/vscode/src/extension.ts:230-248` init / accept diff / reject diff are still stub messages.

Impact:

- The extension cannot honestly be described as feature-complete from the user perspective.
- Users will hit dead-end UI affordances in core workflows.

Ship requirement:

- Remove stubbed commands from the product surface or implement them for real before release.

### 2. The desktop app is not a working Blade client yet

The Electron package currently behaves like a branded container with menu plumbing and a fallback HTML landing page, not a functioning agent application.

Evidence:

- `packages/desktop/src/main.ts:122-216` renders static fallback HTML with a text input, but there is no agent execution path behind it.
- `packages/desktop/src/preload.ts:3-13` only exposes version/platform/open-external/get-cwd and simple event hooks.
- The desktop tests validate shell/window/menu behavior, not an actual end-to-end agent workflow.

Impact:

- Desktop is not ready to market as a real installable Blade surface.
- It creates expectation debt if presented alongside the stronger CLI/core subsystems.

Ship requirement:

- Either fully wire desktop to the real agent runtime or explicitly keep desktop out of the shipping surface.

### 3. Autoforge / Blade runtime features exist, but are not actually integrated into the main user flows

There is good library work here, but a lot of Blade-specific functionality is still "implemented in isolation."

Evidence:

- `packages/danteforge/src/autoforge.ts` exports `runAutoforgeIAL`, but repo search shows it is only referenced in tests.
- `packages/danteforge/src/blade-progress.ts` exports `BladeProgressEmitter`, but repo search shows it is only referenced in tests and a skill file, not the runtime.
- `packages/core/src/model-router.ts:65-85` exports `shouldContinueLoop`, but repo search shows it is only used in tests.
- `packages/cli/src/slash-commands.ts:562-579` `/autoforge` only prints configuration text; it does not launch autoforge.

Impact:

- Blade v1.2 concepts are present in code and tests, but not yet delivered as a real end-user capability.
- "Ready to ship Blade" is not true until these flows are wired into CLI and/or VS Code execution paths.

Ship requirement:

- Decide the canonical Blade surface first.
- Wire Autoforge, progress, termination reason, and quality-loop behavior into that surface end-to-end.

### 4. Sandbox mode is not actually enforced in the main runtime paths

**STATUS: RESOLVED** — sandboxBridge now routes through `@dantecode/sandbox` when `enableSandbox=true`.

Resolution (Lane 2, 2026-03-20):

- `packages/cli/src/sandbox-bridge.ts` — `SandboxBridge.runInSandbox()` routes to `SandboxExecutor` (Docker) or `LocalExecutor` (fallback) via `@dantecode/sandbox`.
- `packages/cli/src/agent-loop.ts` — when `config.enableSandbox` is true, a `SandboxBridge` is instantiated and used; all Bash tool calls are routed through `activeSandboxBridge.runInSandbox()` instead of `execSync`. The `sandboxBridge` is also passed into `CliToolExecutionContext` so `toolBash()` in `tools.ts` can route through it.
- `packages/cli/src/tools.ts` — `toolBash()` now accepts `context?: CliToolExecutionContext` and routes through `context.sandboxBridge.runInSandbox()` when set, preserving `execSync` as the non-sandbox fallback.
- `SecurityEngine` and `SecretsScanner` from `@dantecode/core` are now instantiated per-session in `agent-loop.ts` and applied to all Bash commands (SecurityEngine check) and Write content (SecretsScanner block).

~~Evidence:~~

~~- Repo search found no runtime usage of `@dantecode/sandbox` from CLI, VS Code, or desktop.~~
~~- `packages/cli/src/agent-loop.ts:36-41` defines `enableSandbox`, but repo search shows it is never used inside the agent loop.~~
~~- `packages/cli/src/tools.ts:190-197` executes Bash directly with `execSync`.~~
~~- `packages/cli/src/slash-commands.ts:556-560` `/sandbox` only flips in-memory state text.~~
~~- `packages/vscode/src/extension.ts:214-221` toggle sandbox only updates UI state.~~

Remaining gap (not in scope for this PR):

- VSCode extension sandbox toggle still only updates UI state — wiring to `SandboxBridge` in `sidebar-provider.ts` is a separate task.

Ship requirement:

- ~~Either wire the sandbox package into real command execution or remove/rename the feature so the product does not overstate safety.~~
- Wire VSCode sandbox toggle to `SandboxBridge` for full end-to-end isolation.

### 5. Provider support is inconsistent across types, UI, and runtime

The project advertises more providers than the runtime can actually build.

Evidence:

- `packages/config-types/src/index.ts:10-17` allows `google`, `groq`, and `custom`.
- `packages/vscode/src/onboarding-provider.ts:88-109` offers Google and Ollama models in the onboarding UI.
- `packages/core/src/providers/index.ts:29-34` only registers `grok`, `anthropic`, `openai`, and `ollama`.

Impact:

- "Model-agnostic" is overstated in the current shipped behavior.
- A user can configure provider choices the runtime does not actually support.

Ship requirement:

- Align supported providers across schema, UI, help text, and runtime.
- Do not surface provider options that cannot execute successfully.

### 6. Windows install / maintenance ergonomics are not ship-ready

The project passes Windows smoke tests for build/test/install, but several maintenance scripts still break on standard Windows npm shells.

Evidence:

- `packages/cli/package.json:36-43` uses `rm -rf dist`.
- `packages/desktop/package.json:25-34` uses `rm -rf dist`.
- `packages/vscode/package.json:32-39` uses `rm -rf dist` and `vsce package`.
- I verified:
  - `npm --prefix packages/cli run clean` fails on Windows
  - `npm --prefix packages/desktop run clean` fails on Windows
  - `npm --prefix packages/vscode run package` fails because `vsce` is not installed locally

Impact:

- "Easy to use" and "easy to install" are weakened for Windows developers.
- Local contributor and release workflows are brittle even though CI is mostly green.

Ship requirement:

- Replace Unix-only scripts with cross-platform equivalents.
- Make packaging commands self-contained.

### 7. CLI self-update is currently unsafe / broken

The self-update path is not ready for a product surface.

Evidence:

- `packages/cli/src/commands/self-update.ts:42-49` resolves the VSIX file via a promise chain but does not await it before using it in the install command.
- The command can end up interpolating a promise instead of a real file path.
- The same flow also assumes a local VS Code CLI install and a successful extension package step.

Impact:

- A "self-update" command that mis-installs or partially updates is worse than no self-update command.

Ship requirement:

- Fix the promise handling.
- Add direct tests for self-update.
- Treat update as a hardened release flow, not a convenience script.

### 8. Desktop packaging/release path is incomplete and inconsistent

Evidence:

- `packages/desktop/package.json:24-34` declares desktop packaging scripts.
- `.github/workflows/publish.yml:64-129` publishes npm packages and the VS Code extension, but there is no desktop release job.
- Direct desktop build emitted `dist/main.js`, while the package manifest points at `dist/main.cjs` (`packages/desktop/package.json:24`).
- The repo currently contains both files in `packages/desktop/dist`, which suggests stale artifacts can mask the mismatch locally.

Impact:

- Desktop cannot be treated as a validated release artifact yet.
- Clean builds and packaged releases may not behave the same way as the current checkout.

Ship requirement:

- Make the emitted entrypoint and package manifest agree.
- Add a real desktop release validation path.
- Decide whether desktop is in or out for Blade v1.

### 9. External validation is still incomplete

Evidence:

- `npm run smoke:provider` skipped because no live provider credentials were configured.
- `npm run release:doctor` reported missing publish secrets and missing live provider validation.

Impact:

- Local quality is strong, but external acceptance is still incomplete.
- You do not yet have proof that the real model, npm publish, and VS Code Marketplace paths are healthy.

Ship requirement:

- Run live provider smoke with a real supported provider.
- Complete npm and VS Code release-secret setup.
- Validate at least one real publish candidate end to end.

## Important weaknesses that are not hard blockers, but should be addressed

### 10. Tool calling is still text-parsed, not model-native

Evidence:

- `packages/cli/src/agent-loop.ts:104-175` parses tool calls out of generated text.
- `packages/vscode/src/agent-tools.ts:543-595` does the same in the extension.

Impact:

- This is less robust than native structured tool calling.
- It increases the chance of malformed or partially followed agent actions.

Recommendation:

- Move toward native tool calling wherever the provider stack supports it.

### 11. The VS Code sidebar is carrying too much responsibility in one file

Evidence:

- `packages/vscode/src/sidebar-provider.ts` is 3460 lines long.

Impact:

- High regression risk.
- Slower onboarding and harder debugging.
- More likely that Blade wiring changes will introduce hidden breakage.

Recommendation:

- Split transport, prompt-building, permissions, chat history, attachments, Blade progress, and UI rendering concerns into separate modules.

### 12. Some Blade UI/state features are present but not fully wired

Evidence:

- `packages/vscode/src/status-bar.ts:94-102` exports `updateStatusBarWithCost`, but repo search shows it is only used in tests.
- `packages/vscode/src/onboarding-provider.ts:448` tries to preselect `grok/grok-4.2`, which is not in the actual model list.
- Cost routing in `packages/core/src/model-router.ts` tracks cost, but tier selection is not clearly driving actual model choice in the user-facing flows.

Impact:

- The product can look more Blade-complete than it really is.

Recommendation:

- Finish wiring or trim the surface to what is truly active.

## What I would ship first

If the goal is "Blade with all the strengths and none of the avoidable weaknesses," I would narrow the first real ship target to:

1. CLI + core + danteforge + git-engine + skill-adapter.
2. One supported live-provider matrix:
   - Grok
   - Anthropic
   - OpenAI
   - Ollama
3. A truthful VS Code preview, not a full Blade promise.
4. Desktop excluded until it is genuinely wired.

That gives you a credible release instead of an overextended one.

## Minimum release checklist before I would call Blade ready

- Remove or implement every stubbed VS Code command.
- Wire sandbox mode into real execution, or remove the claim.
- Wire autoforge / Blade loop behavior into a real surface, not just tests and helper classes.
- Align provider schema, provider UI, and provider runtime support.
- Make Windows scripts truly cross-platform.
- Fix self-update and add tests for it.
- Decide whether desktop is shipping; if yes, finish the app and add release automation.
- Run a live provider smoke test.
- Validate one real VS Code package flow locally.
- Validate one real publish candidate from a clean checkout.

## Final assessment

Progress is real and better than the docs alone would have convinced me of.

The project already has a strong technical spine:

- real code
- real tests
- real packaging for the CLI path
- real verification culture

What is still missing is the last-mile truthfulness and integration discipline required for a Blade release:

- no dead UI affordances
- no fake safety toggles
- no advertised providers without runtime support
- no desktop shell marketed like a finished app
- no Blade features that only exist in tests

If you trim the surface to what is already strong and finish the runtime wiring on the handful of blockers above, this can become a very credible first Blade ship.
