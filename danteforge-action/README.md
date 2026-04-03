# DanteForge Verification Action

Automated code quality verification for your CI pipeline. Runs anti-stub detection, PDSE scoring, and custom verification commands with inline PR annotations.

## Quick Start

```yaml
- uses: dantecode/danteforge-action@v1
  with:
    pdse-threshold: "70"
    gstack-commands: |
      npm run typecheck
      npm test
```

## Features

- **Anti-Stub Detection**: Catches placeholder/stub code that should have been replaced with real implementations
- **PDSE Scoring**: Rates code quality on a 0-100 scale across changed files
- **GStack Commands**: Run any verification commands (tests, linting, type checking)
- **Inline PR Annotations**: Comments directly on the lines with issues
- **SARIF Output**: Upload results to GitHub Code Scanning

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `pdse-threshold` | Minimum average PDSE score to pass | `70` |
| `fail-on-stub` | Fail when stub violations found | `true` |
| `gstack-commands` | Newline-delimited commands to run | `""` |
| `annotations-mode` | `pr-comment`, `check-run`, or `both` | `both` |
| `github-token` | GitHub token for API calls | `${{ github.token }}` |

## Outputs

| Output | Description |
|--------|-------------|
| `passed` | `true` or `false` |
| `pdse-average` | Average PDSE score |
| `stub-count` | Number of stub violations |
| `summary` | Full Markdown report |

## Full Example

```yaml
name: DanteForge Verification
on:
  pull_request:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - run: npm ci

      - uses: dantecode/danteforge-action@v1
        with:
          pdse-threshold: "75"
          fail-on-stub: "true"
          annotations-mode: "both"
          gstack-commands: |
            npm run typecheck
            npm run lint
            npm test

      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: danteforge-results.sarif
```

## SARIF Integration

The action generates a `danteforge-results.sarif` file compatible with GitHub Code Scanning. Upload it with the CodeQL action to see results in the Security tab.

## License

MIT
