# Configuration Schema Reference

DanteCode stores project configuration in `.dantecode/config.json`. All settings in this file are typed and validated on startup.

## Schema

```typescript
interface DantecodeConfig {
  version: string;
  provider: {
    id: "anthropic" | "openai" | "ollama" | "azure";
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };
  features?: {
    fim?: boolean;
    browserPreview?: boolean;
    autonomy?: boolean;
  };
  ui?: {
    theme?: "auto" | "light" | "dark";
    statusBar?: boolean;
  };
}
```

## Fields

### `version`

| Property | Value |
| -------- | ----- |
| Type | `string` |
| Required | Yes |
| Default | `"1.0.0"` |
| Format | Semver (`major.minor.patch`) |

Config schema version. Always set to `"1.0.0"` unless migrating from a pre-1.0 config.

---

### `provider.id`

| Property | Value |
| -------- | ----- |
| Type | `"anthropic" \| "openai" \| "ollama" \| "azure"` |
| Required | Yes |
| Default | `"anthropic"` |

The AI provider to use for all completions and chat. Must be exactly one of the four supported values.

**Set with:** `dantecode config set provider.id anthropic`

---

### `provider.model`

| Property | Value |
| -------- | ----- |
| Type | `string` |
| Required | Yes |
| Default | `"claude-sonnet-4-6"` |

The model identifier for the selected provider. Must be a non-empty string. The available models depend on your provider and account plan.

**Set with:** `dantecode config set provider.model claude-opus-4-7`

---

### `provider.apiKey`

| Property | Value |
| -------- | ----- |
| Type | `string` |
| Required | Yes (except for `ollama`) |
| Default | `""` |

API key for authentication. Required for `anthropic`, `openai`, and `azure`. Not used for `ollama`.

As an alternative to storing the key in config, set the appropriate environment variable:
- Anthropic: `ANTHROPIC_API_KEY`
- OpenAI: `OPENAI_API_KEY`

**Set with:** `dantecode config set provider.apiKey YOUR_KEY`

---

### `provider.baseUrl`

| Property | Value |
| -------- | ----- |
| Type | `string` |
| Required | No |
| Default | (provider default) |
| Format | `http://` or `https://` URL |

Custom base URL for API requests. Use this for:
- Azure OpenAI deployments (required)
- Self-hosted Ollama on a non-standard host/port
- API proxies or local mirrors

**Set with:** `dantecode config set provider.baseUrl https://my-resource.openai.azure.com`

---

### `features.fim`

| Property | Value |
| -------- | ----- |
| Type | `boolean` |
| Required | No |
| Default | `true` |

Enable fill-in-the-middle (FIM) completions for inline ghost-text suggestions while typing. See [How to use FIM](../how-to/use-fim.md) for details.

**Set with:** `dantecode config set features.fim true`

---

### `features.browserPreview`

| Property | Value |
| -------- | ----- |
| Type | `boolean` |
| Required | No |
| Default | `false` |

Enable the browser live-preview panel. When a dev server is running (detected automatically), DanteCode can open a preview iframe in VSCode beside your code.

**Set with:** `dantecode config set features.browserPreview true`

---

### `features.autonomy`

| Property | Value |
| -------- | ----- |
| Type | `boolean` |
| Required | No |
| Default | `false` |

Enable autonomous task completion mode. In autonomy mode, DanteCode completes multi-step tasks without requesting approval for each file change. Use with caution — enable only for tasks where you trust the agent's judgment and can easily review a diff at the end.

**Set with:** `dantecode config set features.autonomy false`

---

### `ui.theme`

| Property | Value |
| -------- | ----- |
| Type | `"auto" \| "light" \| "dark"` |
| Required | No |
| Default | `"auto"` |

Color theme for the DanteCode panel and CLI output. `"auto"` follows the VSCode theme. Unknown values produce a warning but fall back to `"auto"`.

**Set with:** `dantecode config set ui.theme dark`

---

### `ui.statusBar`

| Property | Value |
| -------- | ----- |
| Type | `boolean` |
| Required | No |
| Default | `true` |

Show a DanteCode status indicator in the VSCode status bar (bottom left). The status bar shows: provider name, model, and current token usage.

**Set with:** `dantecode config set ui.statusBar true`

---

## Full example config.json

```json
{
  "version": "1.0.0",
  "provider": {
    "id": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "sk-ant-api03-..."
  },
  "features": {
    "fim": true,
    "browserPreview": false,
    "autonomy": false
  },
  "ui": {
    "theme": "auto",
    "statusBar": true
  }
}
```

## Validation

DanteCode validates the config on startup and before any API call. To check manually:

```bash
dantecode config validate
```

Validation errors include a `fix` hint with the exact command to run.

## Related

- [How to configure a provider](../how-to/configure-provider.md)
- [CLI commands reference](cli-commands.md) — `dantecode config` subcommands
