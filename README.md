# DanteCode

DanteCode is a portable, model-agnostic skill runtime and coding agent.

Grok is the default provider, not the product identity. The real product center is interoperability: bringing reusable coding workflows and Claude-style skills into a verification-first runtime that does not lock developers to a single model vendor.

**DanteForge** is the verification layer behind DanteCode. It runs the anti-stub gate, PDSE scoring, constitution checks, and GStack validation so imported or generated workflows have to earn trust before they land.

## OSS v1 status

- CLI: ship target for Public OSS v1
- VS Code extension: preview
- Desktop app: beta

## Why DanteCode

- Portable skill runtime: keep workflows reusable across providers instead of rebuilding them per agent.
- Model-agnostic core: route between Grok, Anthropic, OpenAI, Ollama, or compatible endpoints.
- Verification-first execution: DanteForge checks for stubs, policy violations, and weak outputs before accepting changes.
- Clean-room skill import path: import Claude Code, Continue, and OpenCode style skills through adapters instead of prompt-copy lock-in.
- Git-native workflow support: diff parsing, commits, worktrees, and repo mapping are built in.

## Install

### Published CLI

```bash
npm install -g @dantecode/cli
# or
npx @dantecode/cli --help
```

### From source

```bash
git clone https://github.com/dantecode/dantecode.git
cd dantecode
npm ci
npm run build
npm run cli -- init
npm run cli
```

## Provider setup

Set at least one provider key before using remote models:

```bash
export GROK_API_KEY="xai-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
```

Ollama can run locally without an API key.

## Canonical config path

DanteCode reads project state from `.dantecode/STATE.yaml`.

`dantecode init` creates that file and the surrounding `.dantecode/` structure for you. A minimal example looks like this:

```yaml
version: "1.0.0"
projectRoot: "."
createdAt: "2026-03-16T00:00:00.000Z"
updatedAt: "2026-03-16T00:00:00.000Z"

model:
  default:
    provider: grok
    modelId: grok-3
    maxTokens: 8192
    temperature: 0.1
    contextWindow: 131072
    supportsVision: false
    supportsToolCalls: true
  fallback:
    - provider: anthropic
      modelId: claude-sonnet-4-20250514
      maxTokens: 8192
      temperature: 0.1
      contextWindow: 200000
      supportsVision: true
      supportsToolCalls: true
  taskOverrides: {}

pdse:
  threshold: 85
  hardViolationsAllowed: 0
  maxRegenerationAttempts: 3
  weights:
    completeness: 0.3
    correctness: 0.3
    clarity: 0.2
    consistency: 0.2
```

## Validation

```bash
npm run release:doctor
npm run release:check
```

For the individual gates:

```bash
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:coverage
npm run smoke:cli
npm run smoke:install
npm run smoke:skill-import
npm run publish:dry-run
```

Current local validation baseline:

- `npm run release:doctor`: reports remaining external blockers and remediation steps
- `npm run release:check`: full local ship-readiness sweep is green
- `npm test`: 562 tests across 24 suites
- `npm run test:coverage`: strict coverage gate for the stable runtime packages
- `npm run smoke:cli`: built CLI help/init/config/skills flow passes
- `npm run smoke:install`: packed npm install path and installed CLI bootstrap pass
- `npm run smoke:skill-import`: fixture-based Claude-style skill import, wrap, registry, and validation pass
- `npm run publish:dry-run`: publishable packages pack cleanly; only npm auth warnings remain without login
- Stable runtime coverage gate: `core`, `danteforge`, `git-engine`, `skill-adapter`
- Preview and beta surfaces still run in `npm test`, but do not block OSS v1 coverage thresholds

## Package map

```text
packages/
  config-types/   Shared types and schemas
  core/           Model router, provider adapters, STATE.yaml handling, audit log
  danteforge/     PDSE, anti-stub, constitution, lessons, autoforge, GStack
  git-engine/     Diff parsing, commits, worktrees, repo map
  skill-adapter/  Skill import, registry, wrapping, parser adapters
  sandbox/        Docker and local execution helpers
  cli/            Public OSS v1 command-line client
  vscode/         Preview VS Code extension
  desktop/        Beta desktop shell
```

## Release model

- npm packages are the primary OSS v1 distribution path.
- `@dantecode/cli` is the default install target.
- Core libraries publish as scoped npm packages.
- VS Code packaging and publish remain in workflow, but the extension is still preview.
- Desktop remains beta and is not launch-critical for OSS v1.

## Remaining external ship checks

These require credentials or an external service and are not completed by the local repo alone:

- Push to GitHub and observe the first green Actions run
- Set real git identity for public commit attribution
- Add `NPM_TOKEN` and `VSCE_PAT` secrets when publishing
- Run `npm run smoke:provider -- --require-provider` with a real provider key
- Optionally run one real third-party skill import beyond the local fixture smoke test

## More docs

- [VISION.md](VISION.md)
- [RELEASE.md](RELEASE.md)
- [SPEC.md](SPEC.md)
- [PLAN.md](PLAN.md)
- [TASKS.md](TASKS.md)
- [CHANGELOG.md](CHANGELOG.md)

## License

[MIT](LICENSE)
