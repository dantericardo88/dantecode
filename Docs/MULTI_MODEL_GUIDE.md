# Multi-Model Support Guide

DanteCode is **fully model-agnostic** with production-ready support for 5+ providers and automatic fallback.

## Supported Providers

| Provider | Models | Cost (input/output per 1M tokens) | Status |
|----------|--------|-----------------------------------|--------|
| **Anthropic** | Claude Opus, Sonnet, Haiku | $3.00 / $15.00 | ✅ Primary |
| **OpenAI** | GPT-4, GPT-4 Turbo, o1 | $2.50 / $10.00 | ✅ Tested |
| **X.AI** | Grok Fast, Grok Capable | $0.30-3.00 / $0.60-6.00 | ✅ Tested |
| **Google** | Gemini Pro, Gemini Ultra | $1.25 / $5.00 | ✅ Supported |
| **Groq** | Llama 3, Mixtral | $0.05 / $0.10 | ✅ Supported |

## Quick Start

### 1. Single Provider

```bash
# Use Claude Opus (default)
export ANTHROPIC_API_KEY=sk-ant-...
dantecode

# Use OpenAI GPT-4
export OPENAI_API_KEY=sk-...
dantecode --model gpt-4

# Use Grok
export XAI_API_KEY=xai-...
dantecode --model grok-fast
```

### 2. Automatic Fallback

Configure primary + fallback providers in `.dantecode/config.json`:

```json
{
  "modelRouter": {
    "default": {
      "provider": "anthropic",
      "modelId": "claude-opus-4",
      "maxTokens": 4096
    },
    "fallback": [
      {
        "provider": "openai",
        "modelId": "gpt-4-turbo",
        "maxTokens": 4096
      },
      {
        "provider": "xai",
        "modelId": "grok-fast",
        "maxTokens": 4096
      }
    ]
  }
}
```

**How it works:**
1. Attempts Claude Opus first
2. If unavailable (rate limit, network, API down), automatically falls back to GPT-4 Turbo
3. If GPT-4 also fails, falls back to Grok Fast
4. Returns to primary when it becomes available

### 3. Cost-Aware Routing

DanteCode tracks costs across all providers:

```bash
# Show cost breakdown by provider
dantecode --cost-report

# Set monthly budget limit
dantecode --budget 100  # $100/month cap
```

**Example output:**
```
Cost Report (Last 30 Days):
  Anthropic Claude Opus:    $45.20  (12 sessions)
  OpenAI GPT-4 Turbo:       $8.50   (fallback, 3 sessions)
  X.AI Grok Fast:           $1.20   (fallback, 2 sessions)
  ────────────────────────────────
  Total:                    $54.90
  Budget Remaining:         $45.10 (45%)
```

## Provider Configuration Details

### Anthropic (Claude)

```json
{
  "provider": "anthropic",
  "modelId": "claude-opus-4",
  "maxTokens": 4096,
  "temperature": 0.7
}
```

**Supported models:**
- `claude-opus-4-6` - Most capable, best for complex reasoning
- `claude-sonnet-4-6` - Balanced speed/quality
- `claude-haiku-4-5-20251001` - Fastest, cheapest

**API key:** Set `ANTHROPIC_API_KEY` or store in vault with `/vault set anthropic-api-key`

### OpenAI (GPT)

```json
{
  "provider": "openai",
  "modelId": "gpt-4-turbo",
  "maxTokens": 4096,
  "temperature": 0.7
}
```

**Supported models:**
- `gpt-4` - Most capable GPT-4
- `gpt-4-turbo` - Faster GPT-4 variant
- `o1` - Reasoning model

**API key:** Set `OPENAI_API_KEY` or store in vault

### X.AI (Grok)

```json
{
  "provider": "xai",
  "modelId": "grok-fast",
  "maxTokens": 4096
}
```

**Supported models:**
- `grok-fast` - Fast, low-cost ($0.30/$0.60 per 1M tokens)
- `grok-capable` - Higher capability ($3.00/$6.00 per 1M tokens)

**API key:** Set `XAI_API_KEY` or store in vault

### Google (Gemini)

```json
{
  "provider": "google",
  "modelId": "gemini-pro",
  "maxTokens": 4096
}
```

**Supported models:**
- `gemini-pro` - General purpose
- `gemini-ultra` - Most capable

**API key:** Set `GOOGLE_API_KEY` or store in vault

### Groq (Fast Inference)

```json
{
  "provider": "groq",
  "modelId": "llama3-70b",
  "maxTokens": 4096
}
```

**Supported models:**
- `llama3-70b` - Meta's Llama 3 70B
- `mixtral-8x7b` - Mistral's MoE model

**API key:** Set `GROQ_API_KEY` or store in vault

## Advanced Features

### Model Switching Mid-Session

```bash
# Switch to different model during conversation
/model gpt-4-turbo

# Switch back to default
/model default

# List available models
/model list
```

### Dynamic Model Selection

DanteCode can automatically choose models based on task type:

```json
{
  "modelRouter": {
    "routes": {
      "code_generation": {
        "provider": "anthropic",
        "modelId": "claude-opus-4"
      },
      "code_review": {
        "provider": "openai",
        "modelId": "gpt-4-turbo"
      },
      "documentation": {
        "provider": "xai",
        "modelId": "grok-fast"
      }
    }
  }
}
```

### Provider Health Monitoring

```bash
# Check provider availability
dantecode --health

# Output:
# Provider Health:
#   ✅ Anthropic Claude:  Available (42ms)
#   ✅ OpenAI GPT-4:      Available (98ms)
#   ⚠️  X.AI Grok:        Rate limited (retry after 2m)
#   ❌ Google Gemini:     Unavailable
```

## Fallback Behavior

DanteCode implements **intelligent fallback** with these rules:

1. **Rate Limits:** Automatically switches to fallback provider
2. **Network Errors:** Retries with exponential backoff, then fallback
3. **API Downtime:** Immediate fallback, periodic health checks
4. **Context Window:** Falls back to model with larger context if needed
5. **Cost Budget:** Falls back to cheaper model if budget threshold reached

**Fallback logging:**

All fallback events are logged to `.dantecode/audit.jsonl`:

```json
{
  "timestamp": "2026-03-28T17:30:45Z",
  "type": "model_fallback",
  "primary": "claude-opus-4",
  "fallback": "gpt-4-turbo",
  "reason": "rate_limit",
  "retriesBeforeFallback": 2
}
```

## Testing Multi-Provider Setup

```bash
# Run provider smoke tests
npm run smoke:providers

# Output:
# Testing Anthropic Claude Opus... ✅ (1.2s)
# Testing OpenAI GPT-4 Turbo... ✅ (0.8s)
# Testing X.AI Grok Fast... ✅ (0.5s)
# Testing Google Gemini Pro... ✅ (1.0s)
# Testing Groq Llama 3... ✅ (0.3s)
#
# All 5 providers functional ✅
```

## Security: API Key Management

Never put API keys in git! Use one of these methods:

### Method 1: Environment Variables

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export XAI_API_KEY=xai-...
```

### Method 2: Encrypted Vault (Recommended)

```bash
# Store keys securely (encrypted at rest)
/vault set anthropic-api-key
/vault set openai-api-key
/vault set xai-api-key

# List stored keys (values hidden)
/vault list

# Output:
# Vault Secrets:
#   anthropic-api-key  (set 2 days ago)
#   openai-api-key     (set 2 days ago)
#   xai-api-key        (set 2 days ago)
```

### Method 3: .env File

Create `.dantecode/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
XAI_API_KEY=xai-...
```

**Important:** `.env` is in `.gitignore` by default

## Cost Optimization Strategies

### 1. Tiered Approach

Use cheaper models for simple tasks, expensive models for complex reasoning:

```json
{
  "modelRouter": {
    "routes": {
      "code_review": { "provider": "xai", "modelId": "grok-fast" },
      "architecture": { "provider": "anthropic", "modelId": "claude-opus-4" },
      "documentation": { "provider": "groq", "modelId": "llama3-70b" }
    }
  }
}
```

**Savings:** ~70% cost reduction for typical workloads

### 2. Budget Alerts

```bash
# Set budget with alerts
dantecode --budget 100 --alert-at 80

# Sends notification when $80 spent (80% of budget)
```

### 3. Provider Cost Comparison

| Task | Claude Opus | GPT-4 Turbo | Grok Fast | Savings |
|------|-------------|-------------|-----------|---------|
| Code review | $0.15 | $0.10 | $0.03 | 80% |
| Docs | $0.08 | $0.05 | $0.02 | 75% |
| Architecture | $0.25 | $0.20 | $0.08 | 68% |

## Troubleshooting

### Provider Not Working

1. Check API key is set: `/vault list` or `echo $ANTHROPIC_API_KEY`
2. Verify provider availability: `dantecode --health`
3. Check rate limits: Review `.dantecode/audit.jsonl` for `rate_limit` events
4. Test directly: `npm run smoke:providers`

### Fallback Not Triggering

1. Verify fallback configured in `.dantecode/config.json`
2. Check logs: `tail -f .dantecode/audit.jsonl | grep fallback`
3. Ensure fallback providers have valid API keys
4. Test manually: `/model <fallback-provider>`

### Cost Tracking Incorrect

1. Regenerate cost report: `dantecode --cost-report --refresh`
2. Check audit log: `grep cost .dantecode/audit.jsonl`
3. Verify pricing in `packages/core/src/model-router.ts` (may need update)

## Architecture: How Multi-Model Works

```
User Request
    ↓
ModelRouter
    ↓
Try Primary Provider (e.g., Claude Opus)
    ↓
[Success?] → Return result
    ↓ [Failure]
Log event to audit.jsonl
    ↓
Try Fallback #1 (e.g., GPT-4 Turbo)
    ↓
[Success?] → Return result (mark as fallback)
    ↓ [Failure]
Try Fallback #2 (e.g., Grok Fast)
    ↓
[Success?] → Return result (mark as fallback)
    ↓ [All Failed]
Return error with details
```

**Key Files:**
- `packages/core/src/model-router.ts` - Router implementation
- `packages/core/src/providers/` - Provider adapters
- `packages/core/src/credential-vault.ts` - Encrypted key storage
- `.dantecode/audit.jsonl` - Provider usage logs
- `.dantecode/config.json` - Model configuration

## Real-World Examples

### Example 1: Agency with Multiple Clients

```json
{
  "modelRouter": {
    "default": {
      "provider": "anthropic",
      "modelId": "claude-opus-4"
    },
    "fallback": [
      { "provider": "openai", "modelId": "gpt-4-turbo" },
      { "provider": "xai", "modelId": "grok-fast" }
    ]
  }
}
```

**Benefit:** Never blocked by single provider rate limits

### Example 2: Cost-Conscious Startup

```json
{
  "modelRouter": {
    "default": {
      "provider": "groq",
      "modelId": "llama3-70b"
    },
    "fallback": [
      { "provider": "xai", "modelId": "grok-fast" }
    ]
  }
}
```

**Benefit:** 95% cost savings vs Claude Opus

### Example 3: Enterprise with Compliance

```json
{
  "modelRouter": {
    "default": {
      "provider": "openai",
      "modelId": "gpt-4-turbo"
    },
    "routes": {
      "pii_handling": {
        "provider": "google",
        "modelId": "gemini-pro",
        "region": "us-central1"
      }
    }
  }
}
```

**Benefit:** Regional compliance (GDPR, data residency)

## Comparison with Competitors

| Feature | DanteCode | Cursor | Aider | Cline |
|---------|-----------|--------|-------|-------|
| Multi-provider | ✅ 5+ | ❌ 1 | ✅ 2 | ✅ 3 |
| Auto fallback | ✅ Yes | ❌ No | ❌ No | ⚠️ Manual |
| Cost tracking | ✅ Per provider | ❌ No | ⚠️ Basic | ❌ No |
| Encrypted keys | ✅ Vault | ❌ Plain | ❌ Plain | ⚠️ VSCode secrets |
| Dynamic routing | ✅ Task-based | ❌ No | ❌ No | ❌ No |

**DanteCode advantage:** Only agent with production-grade multi-model support

## Next Steps

1. **Set up providers:** Add API keys for 2+ providers
2. **Configure fallback:** Edit `.dantecode/config.json`
3. **Test it:** Run `npm run smoke:providers`
4. **Monitor costs:** Use `/cost-report` regularly
5. **Optimize:** Switch cheaper models for simple tasks

## Support

- **Documentation:** See [docs/ARCHITECTURE.md](./ARCHITECTURE.md) for internals
- **Issues:** Report at [github.com/dantericardo88/dantecode/issues](https://github.com/dantericardo88/dantecode/issues)
- **API Docs:** See [docs/API.md](./API.md) for programmatic usage
