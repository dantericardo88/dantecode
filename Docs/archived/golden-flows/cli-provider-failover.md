# Golden Flow GF-05 — Provider Failover

> **Gate:** Must pass before private daily-driver declaration.
> **Purpose:** Prove that when the primary provider fails, DanteCode switches to the
> fallback provider and records the switch in the run report.

---

## Prerequisites

- GF-01 passing
- At least two providers configured (e.g. Anthropic as primary, OpenAI as fallback)
- Both API keys available in the environment

---

## Step 1 — Configure primary and fallback providers

```
dantecode config show
# Verify primary provider is set
```

Set a fallback:

```
dantecode config set model.fallback.provider openai
dantecode config set model.fallback.modelId gpt-4o
```

Or edit `.dantecode/STATE.yaml` directly:

```yaml
model:
  default:
    provider: anthropic
    modelId: claude-sonnet-4-6
    contextWindow: 200000
  fallback:
    provider: openai
    modelId: gpt-4o
    contextWindow: 128000
```

---

## Step 2 — Simulate primary provider failure

Set the primary API key to an invalid value to force failure:

```
ANTHROPIC_API_KEY=sk-invalid-test dantecode "write a short greeting function in src/hello.ts"
```

Or use the session flag to override the key:

```
dantecode --provider anthropic --model-key sk-invalid-test "write a short greeting function"
```

---

## Step 3 — Observe failover behavior

Expected output:

```
Provider: anthropic / claude-sonnet-4-6

Attempting request...
  ✗ Primary provider failed: 401 Unauthorized (API key invalid)
  → Falling back to: openai / gpt-4o

Retry with fallback provider...
  ✓ Fallback provider responded

[Task proceeds and completes via openai/gpt-4o]

Running DanteForge verification...
  ✓ Anti-stub scan:     PASSED
  ✓ Constitution check: PASSED
  ✓ PDSE score:         80/100

✓ Verified — changes ready for review.
```

---

## Step 4 — Inspect the run report

The verification receipt must record the provider switch:

```
/status
```

Expected:

```
Session: sess_20260324_xxxxx
Provider: openai / gpt-4o  ← shows the fallback that completed the task
Primary provider: anthropic (failed — 401 Unauthorized)
Fallback activated: yes
```

---

## Step 5 — Verify receipt on disk

The receipt JSON must contain the provider switch:

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "providerSwitchReason": "primary_failed",
  "primaryProvider": "anthropic",
  "primaryFailureReason": "401 Unauthorized"
}
```

---

## Step 6 — Restore and run with valid credentials

```
# Restore valid key
dantecode "write a short greeting function in src/hello.ts"

# Verify primary provider is used again
/status
# Provider: anthropic / claude-sonnet-4-6
```

---

## Acceptance criteria

- [ ] When primary provider returns an error, DanteCode tries the fallback
- [ ] Task completes via fallback provider without user intervention
- [ ] Run report clearly states which provider completed the task
- [ ] Receipt records both the primary failure reason and the fallback provider used
- [ ] After restoring valid credentials, primary provider is used again

---

## Fail codes

| Code | Symptom |
|------|---------|
| `PROV-002` | Fallback path never triggered — error is surfaced to user instead |
| `GF-004` | Failover is simulated (mocked) rather than using a real second provider |
| `CLI-005` | Provider state is unclear — user cannot tell which provider ran |
