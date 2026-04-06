# Contributing to DanteCode

Thanks for helping build DanteCode.

This repo is shipping toward a Public OSS v1 where the CLI is the primary surface, the VS Code extension is preview, and the desktop app is beta. Contributions should keep that boundary honest.

## Prerequisites

- Node.js 20+
- npm 11+
- Git

## Local setup

```bash
git clone https://github.com/dantericardo88/dantecode.git
cd dantecode
npm ci
npm run release:doctor
npm run build
npm test
npm run release:check
```

## Quality gates

Every contribution should pass the local root gates before review:

| Gate | Command | Expectation |
| --- | --- | --- |
| Build | `npm run build` | All workspaces build |
| Typecheck | `npm run typecheck` | Zero type errors |
| Lint | `npm run lint` | Zero lint violations |
| Format | `npm run format:check` | No formatting drift |
| Tests | `npm test` | All suites pass |
| Coverage | `npm run test:coverage` | Stable runtime packages stay above gate |

Coverage note:

- The strict coverage gate applies to the stable runtime packages: `core`, `danteforge`, `git-engine`, and `skill-adapter`.
- CLI, VS Code, desktop, and sandbox are still exercised in `npm test`, but preview/beta surfaces do not currently set the release coverage threshold.
- `npm run release:check` is the fastest way to run the full ship-readiness sweep, including install, skill-import, and publish smoke checks.
- `npm run release:doctor` is the fastest way to see the remaining git, auth, provider, and publish blockers before a public push.

## Workflow

1. Branch from `main`.
2. Make the smallest coherent change.
3. Update docs when behavior, install steps, or product positioning changes.
4. Run the root gates.
5. Open a focused pull request with a clear why.

## Repo shape

```text
packages/
  config-types/
  core/
  danteforge/
  git-engine/
  skill-adapter/
  sandbox/
  cli/
  vscode/
  desktop/
```

## Guidance

- Preserve the portability-first product direction. DanteCode is not just another agent shell.
- Prefer capability-oriented designs over vendor-specific assumptions.
- Keep `.dantecode/STATE.yaml` as the canonical project config path for OSS v1.
- Do not reintroduce Bun-first instructions into public docs or workflows.
- Treat skill import as clean-room translation and validation work, not prompt harvesting.

## DanteForge Anti-Stub Doctrine

DanteCode enforces a zero-stub policy. The CI pipeline runs an anti-stub scanner on all source files. The following patterns are **forbidden** in non-test files:

- `TODO`, `FIXME`, `HACK` (code markers)
- `throw new Error("not implemented")` or `raise NotImplementedError`
- `as any`, `@ts-ignore`, `@ts-nocheck` (type escape hatches)
- `placeholder` (stub content markers)

If you are generating code with an AI assistant, ensure it produces **complete, production-ready implementations**. The CI will reject stubs.

## Tests

- Put tests next to source as `*.test.ts`.
- Prefer behavior-focused tests over implementation snapshots.
- When fixing a bug, reproduce it with a failing test first if practical.
- Mock external systems unless the test is explicitly an integration or acceptance test.

## Commit style

Conventional Commits are preferred:

```text
feat: add portable skill manifest validation
fix: run gstack shell builtins correctly on windows
docs: align README with npm-first OSS v1 release plan
```

## External release-only steps

Some acceptance steps cannot be completed in a normal contribution without maintainer credentials:

- GitHub push and Actions verification
- npm publish
- VS Code Marketplace publish
- `npm run smoke:provider -- --require-provider` with real API keys

Call those out clearly if your work depends on them.

## How to Add a Slash Command

1. Add to `SLASH_COMMANDS` array in `packages/cli/src/slash-commands.ts`
2. Add a handler case in `routeSlashCommand()`
3. Add to `FEATURE_WIRING_MAP` in `packages/core/src/wiring-auditor.ts`
4. Run `dantecode /verify --feature=<your-feature>` — must show GREEN before PR

## How to Write a Feature Test

In `packages/core/src/feature-tests/index.ts`:
```typescript
const myFeatureScenario: FeatureTestScenario = {
  name: "my-feature",
  description: "Verify my feature does X",
  run: async (projectRoot) => {
    // Do something observable
    // Throw if it doesn't work
    return { score: 9, evidence: "Feature worked: [specific evidence]" };
  },
};
// Add to ALL_SCENARIOS array
```

## PR Requirements

Every PR must include the output of:
```bash
node -e "const {runWiringAudit}=require('./packages/core/dist/index.js');const r=runWiringAudit(process.cwd());console.log(r.overallScore+'/10 | '+r.greenCount+' GREEN | '+r.redCount+' RED')"
```

The score must not decrease from main.

## Honest Scoring Policy

- No feature may be claimed as "done" without `dantecode verify --feature=X` showing GREEN
- No score may be self-assessed — only the wiring auditor output counts
- If you claim 8/10 for a feature, show the `dantecode verify` evidence

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
