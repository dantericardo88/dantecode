# DanteCode Security Policy

## Data Handling

### What leaves your machine
- API calls to configured model providers (Anthropic, Grok, OpenAI, etc.)
- Only the content you explicitly send in messages
- No code is stored on DanteCode servers (we have none)

### What stays local
- All session history (`.dantecode/sessions/`)
- All memory/context (`.dantecode/` directory)
- PDSE scores and health trends (`~/.dantecode/pdse-trends.jsonl`)
- STATE.yaml configuration

### API Key Storage
- VS Code extension: SecretStorage API (OS keychain or encrypted VS Code storage)
- CLI: Environment variables or STATE.yaml (never committed to git)
- No keys are transmitted except to their respective provider APIs

## Vulnerability Reporting

Report security vulnerabilities to: security@dantecode.dev

Please do NOT file public GitHub issues for security vulnerabilities.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.9.x   | yes       |
| < 0.9   | no        |
