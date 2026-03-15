# Contributing to DanteCode

Thank you for your interest in contributing to DanteCode! This guide covers the development workflow, code standards, and submission process.

## Prerequisites

- [Bun](https://bun.sh/) v1.2+
- [Node.js](https://nodejs.org/) v20+
- [Git](https://git-scm.com/)

## Getting Started

```bash
git clone https://github.com/dantecode/dantecode.git
cd dantecode
bun install
bun run build
bun run test
```

## Development Workflow

### Branch Strategy

1. Fork the repository and create a feature branch from `main`:
   ```bash
   git checkout -b feat/your-feature main
   ```
2. Make your changes following the code standards below.
3. Push and open a pull request against `main`.

### Code Standards

DanteCode enforces strict quality gates. All contributions must pass:

| Gate       | Command                 | Requirement                                     |
| ---------- | ----------------------- | ----------------------------------------------- |
| TypeScript | `bun run typecheck`     | Zero type errors across all 9 packages          |
| ESLint     | `bun run lint`          | Zero violations (typescript-eslint flat config) |
| Prettier   | `bun run format:check`  | Zero formatting violations                      |
| Tests      | `bun run test`          | All tests pass                                  |
| Coverage   | `bun run test:coverage` | No coverage regressions                         |
| Anti-Stub  | CI self-check           | No TODO, FIXME, placeholder, or stub patterns   |

### Running Checks Locally

```bash
# Run all gates in sequence
bun run typecheck && bun run lint && bun run format:check && bun run test

# Auto-format code
bun run format

# Run tests with coverage
bun run test:coverage
```

## Project Structure

```
packages/
  config-types/   # Shared TypeScript interfaces
  core/           # Model router, audit logger, state management
  danteforge/     # Anti-stub, PDSE, constitution, autoforge
  git-engine/     # Diff parsing, commits, worktrees, repo-map
  skill-adapter/  # Skill import, registry, wrapping, parsers
  sandbox/        # Docker sandbox with local fallback
  cli/            # Interactive REPL and one-shot CLI
  vscode/         # VS Code extension
  desktop/        # Electron desktop app
```

### Adding a New Package

1. Create `packages/your-package/` with `package.json`, `tsconfig.json`, and `src/index.ts`.
2. Follow the naming convention: `@dantecode/your-package`.
3. Add the package to `turbo.json` pipeline if it has custom build steps.
4. Add tests in `src/*.test.ts` — the root vitest config auto-discovers them.

## Writing Tests

- Tests live alongside source files as `*.test.ts`.
- Use [Vitest](https://vitest.dev/) with `describe`/`it`/`expect`.
- Mock external dependencies (VS Code API, Electron, Docker) — never require real runtimes in unit tests.
- Aim for meaningful coverage, not 100% line coverage. Test behavior, not implementation.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add skill validation endpoint
fix: correct PDSE score rounding for edge case
test: expand constitution checker branch coverage
docs: update README with new provider setup
ci: add npm audit step to CI pipeline
```

## Pull Request Process

1. Ensure all CI checks pass (format, typecheck, lint, test, anti-stub).
2. Write a clear PR description explaining **what** and **why**.
3. Keep PRs focused — one feature or fix per PR.
4. Update documentation if your change affects public APIs or configuration.

## Reporting Issues

Open an issue on GitHub with:

- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, Bun version, Node version)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
