# Blade Ship Readiness Review

Date: 2026-03-16

This review is based on direct code inspection plus commands run in the repository today. I did not trust the PRD, README files, or other markdown claims as proof of readiness.

## Current verdict

The project has made real progress since the last review. The engineering foundation is strong: builds are green, tests are deep, coverage is high, smoke installs pass, and packaging dry-runs work for the published packages.

But Blade is still not ready to ship as a "100% fully operational battle station."

The biggest remaining problem is no longer basic code quality. The problem is product truthfulness and runtime wiring:

- several user-facing commands still do not do the thing they claim to do
- `/autoforge` is still not actually running Blade/autoforge
- sandbox mode is still largely a UI/config flag, not a real execution boundary
- provider support is advertised more broadly than the runtime actually supports
- live external validation is still incomplete

## What improved since the last review

These are real improvements, not documentation claims:

- VS Code chat now calls `router.selectTier(...)` before requests in `packages/vscode/src/sidebar-provider.ts:687-703`
- VS Code chat emits cost updates in `packages/vscode/src/sidebar-provider.ts:844-854`
- self-modification guards were added to tool execution in `packages/vscode/src/agent-tools.ts:522-540`
- diff hunk emission after successful file edits is now present in `packages/vscode/src/agent-tools.ts:584-592`
- Blade progress code exists and is exported (`packages/danteforge/src/blade-progress.ts`, `packages/danteforge/src/index.ts:35-39`)
- test coverage is now strong enough to be meaningful

So this is not a weak repo anymore. It is a repo with a strong core and unfinished last-mile product wiring.

## Verification run

Commands run today:

- `npm run build` -> passed
- `npm run typecheck` -> passed
- `npm run lint` -> passed
- `npm test` -> passed
- `npm run test:coverage` -> passed
- `npm run smoke:cli` -> passed
- `npm run smoke:install` -> passed
- `npm run smoke:skill-import` -> passed
- `npm run publish:dry-run` -> passed
- `npm run smoke:provider` -> skipped because no supported provider credentials were configured locally
- `npm run release:doctor` -> reported external blockers for provider credentials, `NPM_TOKEN`, and `VSCE_PAT`
- `npm run format:check` -> failed on 11 files
- `npm --prefix packages/core run clean` -> failed on Windows because `rm` is not recognized
- `npm --prefix packages/desktop run clean` -> failed on Windows because `rm` is not recognized
- `npm --prefix packages/vscode run package` -> failed because `vsce` is not installed locally

Coverage result from `npm run test:coverage`:

- statements: 94.8%
- branches: 84.94%
- functions: 95.36%
- lines: 94.8%

## Critical ship blockers

### 1. VS Code still exposes multiple stub commands as if they are product features

The extension still registers user-facing commands that only show stub/toast messages:

- `commandImportClaudeSkills` in `packages/vscode/src/extension.ts:169-187`
- `commandRunGStack` in `packages/vscode/src/extension.ts:199-203`
- `commandShowLessons` in `packages/vscode/src/extension.ts:224-227`
- `commandInitProject` in `packages/vscode/src/extension.ts:230-239`
- `commandAcceptDiff` in `packages/vscode/src/extension.ts:241-245`
- `commandRejectDiff` in `packages/vscode/src/extension.ts:247-248`

This is still a hard ship blocker. A Blade product cannot present commands in the UI that are knowingly non-functional.

### 2. `/autoforge` still does not actually run autoforge

The CLI slash command still only prints configuration:

- `packages/cli/src/slash-commands.ts:562-578`

At the same time, `runAutoforgeIAL(...)` exists only as a library export and test subject:

- implementation: `packages/danteforge/src/autoforge.ts:290`
- export: `packages/danteforge/src/index.ts:35-39`
- runtime usage search: no non-test call sites found

This is a major gap between Blade branding and real behavior. The most important Blade loop exists in code, but is not actually wired into the main product flow.

### 3. Sandbox mode is still not a real sandbox

The CLI slash command only flips state:

- `packages/cli/src/slash-commands.ts:556-560`

The VS Code command only flips the status bar state:

- `packages/vscode/src/extension.ts:214-221`

CLI tool execution still shells directly to host bash/cmd:

- `packages/cli/src/tools.ts:181-197`

VS Code tool execution still shells directly on the host:

- `packages/vscode/src/agent-tools.ts:256-271`

There are no runtime usages of `@dantecode/sandbox`, `SandboxExecutor`, or `LocalExecutor` from the CLI or VS Code execution path.

This means the product currently advertises sandboxing more strongly than it enforces it.

### 4. Provider support is still inconsistent across config, onboarding, and runtime

The shared type layer advertises:

- `google`, `groq`, `ollama`, and `custom` in `packages/config-types/src/index.ts:10-17`

The onboarding UI offers Google models:

- `packages/vscode/src/onboarding-provider.ts:88-118`

But the runtime provider registry only registers:

- `grok`, `anthropic`, `openai`, `ollama` in `packages/core/src/providers/index.ts:29-34`

This is a real product inconsistency. Users can be offered provider choices that are not actually backed by the runtime.

### 5. Cost accounting still collapses non-Anthropic providers into Grok pricing

Model routing got better, but cost accounting is still wrong for non-Anthropic providers:

- generate path maps provider to only `"anthropic"` or `"grok"` in `packages/core/src/model-router.ts:251-255`
- stream path does the same in `packages/core/src/model-router.ts:313-317`
- `recordRequestCost(...)` only accepts `"grok" | "anthropic"` in `packages/core/src/model-router.ts:443-448`

So OpenAI and Ollama requests are still being accounted for as if they were Grok unless they are Anthropic. That makes the Blade cost story inaccurate.

### 6. Self-update is still broken

`runSelfUpdateCommand(...)` now packages the extension with `npx @vscode/vsce package`, but the VSIX lookup is still not awaited:

- `packages/cli/src/commands/self-update.ts:42-49`

`vsix` is a promise there, so the `code --install-extension ${vsix}` path is still unreliable/broken.

## High-priority product gaps

### 7. The desktop app is still mostly an Electron shell with fallback HTML

Desktop boot logic loads `renderer/index.html` if it exists, otherwise it renders inline fallback HTML:

- `packages/desktop/src/main.ts:31-36`
- fallback page markup is embedded in `packages/desktop/src/main.ts:122-216`

The desktop package currently has no `renderer/` directory at all, so the fallback path is effectively the real UI right now.

IPC is also still minimal:

- `packages/desktop/src/preload.ts:3-13`

That is not yet a believable standalone Blade desktop experience.

### 8. Self-modification confirmation looks designed, but is not actually wired through the sidebar runtime

Tool execution supports an optional confirmation callback:

- `packages/vscode/src/agent-tools.ts:523-531`

But the sidebar tool context only passes `onSelfModificationAttempt`, not `awaitSelfModConfirmation`:

- `packages/vscode/src/sidebar-provider.ts:967-981`

A repo-wide search found no non-test runtime caller that provides `awaitSelfModConfirmation`.

So today the UX appears to imply "confirmable self-modification," but the actual behavior is effectively "always block."

### 9. Status-bar cost display exists but is not wired into production runtime

The status bar supports cost/tier rendering:

- `packages/vscode/src/status-bar.ts:94-102`

But a search found no non-test caller of `updateStatusBarWithCost(...)`.

So Blade cost/tier updates are partially wired to the chat webview, but not fully reflected in the VS Code chrome.

### 10. Windows/local packaging ergonomics are still rough

Several package clean scripts are still Unix-only:

- `packages/core/package.json:33-38`
- `packages/desktop/package.json:25-34`
- `packages/vscode/package.json:32-38`

Verified failures on Windows:

- `npm --prefix packages/core run clean`
- `npm --prefix packages/desktop run clean`

VS Code packaging also still assumes a local `vsce` binary:

- `packages/vscode/package.json:32-38`

Verified failure:

- `npm --prefix packages/vscode run package`

That is not "easy to install / easy to ship" yet.

### 11. The full release gate is still not green

Root release check requires:

- `npm run format:check` inside `package.json:15-31`

But `npm run format:check` failed today on 11 files, including:

- `packages/core/src/model-router.ts`
- `packages/danteforge/src/autoforge.ts`
- `packages/vscode/src/agent-tools.ts`
- `packages/vscode/src/sidebar-provider.ts`

So even though build/test/lint are good, the top-level release gate is still not currently clean.

### 12. External acceptance is still incomplete

`npm run smoke:provider` could not run live because no supported provider credentials were configured locally.

`npm run release:doctor` also still reported external blockers:

- no live provider credential configured
- no `NPM_TOKEN`
- no `VSCE_PAT`

This does not mean the code is bad. It means the project is not externally validated end-to-end yet.

## Strengths worth protecting

These are the parts of the project that now feel genuinely strong:

- strong automated test base across packages
- high aggregate coverage
- working CLI smoke flow
- working install smoke flow
- working skill-import smoke flow
- package publish dry-run is clean
- provider router, git engine, sandbox package, and skill-adapter all look like real software rather than fake scaffolding
- Blade progress, cost events, and self-mod guards are moving in the right direction

This is why the project feels close enough to be exciting. The foundation is no longer the problem.

## Minimum bar before calling Blade ready to ship

### Product truthfulness

- remove or fully implement every stubbed VS Code command
- make `/autoforge` actually execute Blade autoforge, not just print settings
- either wire sandboxing for real or stop marketing the toggle as protection
- align provider options across config, onboarding, and runtime

### Runtime correctness

- fix self-update VSIX resolution
- fix provider-specific cost accounting
- wire self-modification confirmation end-to-end
- wire cost/tier status updates into the actual VS Code status bar

### UX and install quality

- replace Unix-only `rm -rf` scripts with cross-platform clean commands
- make VS Code packaging self-contained (`npx @vscode/vsce package` or local dev dependency)
- build a real desktop renderer or stop treating desktop as a meaningful Blade surface

### External validation

- run live provider smoke against at least one supported remote provider
- verify fresh install on a clean Windows box
- verify VS Code extension packaging and installation from a generated VSIX
- verify self-update on a real developer machine
- verify Blade/autoforge from the actual user entry points, not just tests

## Bottom line

My honest read: this repo has crossed the line into "serious project with a strong core." That is real progress.

But it has not yet crossed the line into "Blade is fully operational, easy to install, easy to use, and safe to ship." The remaining work is mostly execution wiring, platform ergonomics, and product honesty. Those are fixable, but they still matter.

If you close the blockers above, Blade can move from "promising and impressive" to "credible release."
