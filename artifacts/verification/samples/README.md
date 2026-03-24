# artifacts/verification/samples/

Real DanteForge pipeline output generated from actual monorepo source files.

Run `npm run generate:samples` to regenerate.

## Summary

| Category | Count |
|----------|-------|
| Real production files verified | 14 |
| Synthetic stub-fail example | 1 |
| **Total receipts** | **15** |
| Pass rate (real files) | 14/14 |

## Files

| `sample-packages-core-src-token-counter.json` | PASS | pdseScore=100 |
| `sample-packages-core-src-circuit-breaker.json` | PASS | pdseScore=100 |
| `sample-packages-core-src-checkpointer.json` | PASS | pdseScore=100 |
| `sample-packages-core-src-approach-memory.json` | PASS | pdseScore=100 |
| `sample-packages-core-src-audit.json` | PASS | pdseScore=100 |
| `sample-packages-core-src-autoforge-checkpoint.json` | PASS | pdseScore=100 |
| `sample-packages-git-engine-src-index.json` | PASS | pdseScore=100 |
| `sample-packages-skill-adapter-src-registry.json` | PASS | pdseScore=100 |
| `sample-packages-evidence-chain-src-hash-chain.json` | PASS | pdseScore=100 |
| `sample-packages-evidence-chain-src-merkle-tree.json` | PASS | pdseScore=100 |
| `sample-packages-memory-engine-src-index.json` | PASS | pdseScore=100 |
| `sample-packages-config-types-src-index.json` | PASS | pdseScore=98 |
| `sample-packages-dante-gaslight-src-index.json` | PASS | pdseScore=100 |
| `sample-packages-debug-trail-src-index.json` | PASS | pdseScore=98 |
| `sample-stub-fail.json` | FAIL (expected) | Anti-stub hard violation |

## Schema

Each sample contains:

- `file` — relative path of the source file verified
- `note` — description of what this sample demonstrates
- `generatedAt` — ISO timestamp
- `passed` — boolean overall verdict
- `pdseScore` — 0–100 PDSE quality score
- `antiStub` — anti-stub scan result (hardViolations, softViolations counts)
- `constitution` — constitution check result (criticalCount, warningCount)
- `pdse` — full PDSE breakdown (overall, completeness, correctness, clarity, consistency)

## Reproducibility

Same source file + same repo state = same verification outcome (except `generatedAt` timestamp).
This is the determinism guarantee described in docs/verification/receipt-schema.md.
