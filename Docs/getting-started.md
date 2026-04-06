# Getting Started with DanteCode

## Install

### VS Code Extension
1. Open Antigravity / VS Code
2. Install DanteCode from the marketplace or download the `.vsix`
3. Configure your API key in Settings (gear icon in sidebar)

### CLI
```bash
npm install -g @dantecode/cli
dantecode --version
```

## First Session

1. Open a project folder in VS Code
2. Click the DanteCode icon in the sidebar
3. Type your first request, e.g.: "Review this codebase and tell me what it does"

## Key Commands

| Command | What it does |
|---------|-------------|
| `/verify` | Run feature health check — honest GREEN/RED score |
| `/test <file>` | Generate and run tests for a source file |
| `/docs <file>` | Add JSDoc to all public APIs |
| `/migrate cjs-to-esm` | Migrate CommonJS to ES modules |
| `/health` | Show PDSE code quality trends over time |
| `/arena grok/grok-3,anthropic/claude-sonnet-4-6 "task"` | Compare models |
| `/scale 3 "task"` | Run 3 variants, pick best PDSE score |

## Configuration

Edit `.dantecode/STATE.yaml`:
```yaml
model:
  default:
    provider: grok  # or anthropic, openai, openrouter
    modelId: grok-3
    maxTokens: 16384

git:
  autoCommit: false  # set true to auto-commit writes

autoforge:
  enabled: true
  autoRunOnWrite: false
```

## Verification

After any change, run `dantecode verify` to see honest scores:
```
dantecode /verify
```
