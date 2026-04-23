# How to Configure a Provider

DanteCode supports four AI providers: Anthropic, OpenAI, Ollama, and Azure OpenAI. This guide covers how to set up each one, how to switch between them, and how to configure advanced options.

## Quick setup

The fastest way to configure a provider is with `dantecode config set`:

```bash
dantecode config set provider.id <provider-name>
dantecode config set provider.model <model-id>
dantecode config set provider.apiKey <your-api-key>
```

Then validate: `dantecode config validate`

## Anthropic (default)

Anthropic's Claude models are the default provider. Recommended for most users.

**Get an API key:** Visit [console.anthropic.com](https://console.anthropic.com) → API Keys → Create Key.

```bash
dantecode config set provider.id anthropic
dantecode config set provider.model claude-sonnet-4-6
dantecode config set provider.apiKey <ANTHROPIC_API_KEY>
```

**Available models:**
- `claude-sonnet-4-6` — Best balance of quality and speed (recommended)
- `claude-opus-4-7` — Highest quality, slower, higher cost
- `claude-haiku-4-5-20251001` — Fastest, lowest cost

**Environment variable alternative:** Set `ANTHROPIC_API_KEY` in your shell instead of storing the key in config:

```bash
export ANTHROPIC_API_KEY=<ANTHROPIC_API_KEY>
```

## OpenAI

```bash
dantecode config set provider.id openai
dantecode config set provider.model gpt-4o
dantecode config set provider.apiKey sk-YOUR_OPENAI_KEY
```

**Available models:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1`, `o1-mini`

**Environment variable alternative:** `OPENAI_API_KEY`

## Ollama (local, no API key)

Ollama runs models locally on your machine. No API key required, no data sent to external servers.

**Install Ollama:** Download from [ollama.ai](https://ollama.ai) and start it:

```bash
ollama serve
ollama pull llama3
```

Then configure DanteCode:

```bash
dantecode config set provider.id ollama
dantecode config set provider.model llama3
```

**Custom Ollama URL** (if not running on localhost:11434):

```bash
dantecode config set provider.baseUrl http://192.168.1.50:11434
```

**Available models:** any model pulled with `ollama pull` — `llama3`, `mistral`, `codellama`, `deepseek-coder`, etc.

## Azure OpenAI

For enterprise deployments with Azure-hosted OpenAI models:

```bash
dantecode config set provider.id azure
dantecode config set provider.model gpt-4
dantecode config set provider.apiKey YOUR_AZURE_KEY
dantecode config set provider.baseUrl https://YOUR_RESOURCE.openai.azure.com
```

The `baseUrl` must point to your Azure OpenAI resource endpoint (not the deployments URL).

## Switching providers

Switching is just one command:

```bash
dantecode config set provider.id openai
dantecode config set provider.model gpt-4o
dantecode config set provider.apiKey sk-openai-key
```

Your previous config is overwritten. Validate after switching:

```bash
dantecode config validate
```

## View current config

```bash
dantecode config list
```

The API key is masked (`sk-ant-api0****`) for safety.

## Troubleshooting

**"API key is required for provider"**
The selected provider needs an API key but none was found. Run:
```bash
dantecode config set provider.apiKey YOUR_KEY
```

**"Invalid provider id"**
Only `anthropic`, `openai`, `ollama`, `azure` are supported. Check your spelling.

**"Invalid baseUrl"**
The `baseUrl` must start with `http://` or `https://`. Example:
```bash
dantecode config set provider.baseUrl https://my-endpoint.openai.azure.com
```

**Ollama connection refused**
Make sure Ollama is running: `ollama serve`. Check it's reachable: `curl http://localhost:11434/api/tags`

## Related

- [Config schema reference](../reference/config-schema.md) — all config fields with types and defaults
- [CLI commands reference](../reference/cli-commands.md) — `dantecode config` subcommands
