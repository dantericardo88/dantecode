# How to Use FIM Completions

Fill-in-the-middle (FIM) completions give you inline ghost-text suggestions as you type, similar to GitHub Copilot. DanteCode generates completions using your configured provider's model.

## Enable FIM

FIM is enabled by default. If it's been turned off:

```bash
dantecode config set features.fim true
dantecode config validate
```

## Using FIM in VSCode

1. Open a file in VSCode with the DanteCode extension installed
2. Start typing — a grey ghost text suggestion appears automatically
3. Press **Tab** to accept the suggestion
4. Press **Escape** to dismiss it
5. Continue typing to get a new suggestion based on what you typed

FIM works best in the middle of a function body, after a comment, or after a partial expression.

**Example:** You type:

```typescript
function calculateTax(price: number, rate: number
```

DanteCode suggests:

```typescript
): number {
  return price * rate;
}
```

Press Tab to accept.

## Controlling trigger behavior

By default, FIM triggers after a short pause in typing (debounce). You can adjust sensitivity:

```bash
# Disable FIM entirely
dantecode config set features.fim false
```

There is no per-language disable — FIM is active in all file types when enabled.

## How FIM completions work

DanteCode uses a prompt format that sends the text before your cursor (prefix) and the text after your cursor (suffix) to the model, which fills in the middle. This is the same technique used by Codex and Code Llama FIM models.

For Anthropic models, DanteCode uses the standard completion endpoint with a structured FIM prompt. For Ollama with a FIM-capable model (like `codellama:code`), DanteCode uses the native `/api/generate` endpoint with `<PRE>`, `<SUF>`, `<MID>` tokens.

## Best models for FIM

| Provider | Recommended model |
| -------- | ---------------- |
| Anthropic | claude-haiku-4-5-20251001 (fastest) |
| OpenAI | gpt-4o-mini |
| Ollama | codellama:7b-code, deepseek-coder:6.7b |

For the lowest latency, use a smaller/faster model specifically for FIM and your main model for chat. Configure Ollama locally for fastest FIM response times.

## Measuring FIM latency

DanteCode tracks FIM completion latency automatically. View your p50/p95 stats:

```bash
dantecode bench --fim
```

Typical targets: p50 < 500ms, p95 < 1500ms. If your p95 is consistently above 2s, consider switching to a faster model.

## Troubleshooting

**Ghost text never appears**
- Confirm FIM is enabled: `dantecode config list | grep fim`
- Confirm the VSCode extension is active (DanteCode icon in status bar)
- Check the DanteCode output panel (View → Output → DanteCode) for errors

**Ghost text appears but Tab doesn't accept it**
The Tab key may be bound to something else in your VSCode keybindings. Open Keyboard Shortcuts (`Ctrl+K Ctrl+S`) and search for "DanteCode: Accept Completion".

**FIM is slow**
Switch to a faster model for inline completions. Ollama with `codellama:7b-code` typically achieves p50 under 300ms on modern hardware.

## Related

- [Configure provider](configure-provider.md) — set up a provider for completions
- [Config schema reference](../reference/config-schema.md) — `features.fim` field details
