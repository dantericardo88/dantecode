# DanteCode Public OSS v1 Release Runbook

> **Readiness:** See `artifacts/readiness/current-readiness.json` — run `npm run release:generate` to update.

This is the shortest path from a locally green repo to a public OSS v1 release.

## 1. Local readiness

Run the doctor first so the repo tells you which external blockers still remain:

```bash
npm run release:doctor
```

Then run the full local sweep:

```bash
npm run release:check
```

Expected local baseline:

- `npm run release:check` is green
- `npm test` passes
- `npm run test:coverage` passes the stable runtime gate
- CLI, install, skill-import, and publish dry-run smokes all pass

## 2. Live model validation

Set one real provider key, then run:

```bash
npm run smoke:provider -- --require-provider
```

Once the live provider receipt exists for the release commit, generate the same-commit README quickstart proof:

```bash
npm run release:prove-quickstart
```

Accepted env vars:

- `GROK_API_KEY`
- `XAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`

You can also target a local Ollama instance manually:

```bash
npm run smoke:provider -- --provider ollama
```

## 3. Git identity and public push

Make sure git uses your real public identity:

```bash
git config --global user.name "Your Real Name"
git config --global user.email "you@your-domain.com"
```

If the GitHub repo does not exist yet, create it in the browser as an empty repo, then connect and push:

```bash
git remote add origin <repo-url>
git push -u origin main
```

If `origin` already exists, push directly:

```bash
git push -u origin main
```

Watch the first GitHub Actions run and make sure [ci.yml](.github/workflows/ci.yml) goes green.

## 4. Publish secrets

Before creating a public release, add these GitHub Actions secrets:

- `NPM_TOKEN` for npm package publishing
- `VSCE_PAT` only if you want Marketplace publishing for the preview VS Code extension

The CLI and core libraries are the primary OSS v1 release artifacts. The VS Code extension remains preview, and the desktop app remains beta.

## 5. Release workflow

Before tagging a real release, use the publish workflow in dry-run mode from GitHub Actions:

- Workflow: `Publish`
- Trigger: `workflow_dispatch`
- Input: `dry-run = true`

When that passes and the secrets are configured, create the GitHub release to trigger the real publish flow.

## 6. Done means

Call the release complete when all of the following are true:

- `npm run release:doctor` shows no blockers
- `npm run release:check` is green
- `npm run smoke:provider -- --require-provider` is green
- `npm run release:prove-quickstart` records a same-commit quickstart receipt
- The first GitHub Actions CI run is green on the pushed repo
- `NPM_TOKEN` is configured for npm publish
- The public README quickstart works from a clean clone
- `VSCE_PAT` is configured if you want Marketplace publishing for the preview extension
