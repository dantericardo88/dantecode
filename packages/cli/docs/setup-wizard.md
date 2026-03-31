# /setup - Interactive Setup Wizard

The `/setup` command is an interactive wizard that helps you configure DanteCode for your project.

## Usage

```bash
/setup
```

Or force reconfiguration:

```bash
/setup --force
```

## Features

The setup wizard walks you through 5 steps:

### Step 1: API Key Configuration

Configure API keys for various AI providers:
- Anthropic (Claude)
- OpenAI (GPT)
- GitHub
- xAI (Grok)
- Google (Gemini)

The wizard will:
- Check if keys are already set in your environment
- Prompt you to configure missing keys
- Save configured keys to `.env` file

### Step 2: Model Selection

Choose your default AI model from:
- Claude Sonnet 4.6 (Anthropic) — recommended for quality
- Claude Haiku 4.5 (Anthropic) — fast & cheap
- Grok-3 (xAI) — high capability
- GPT-4o (OpenAI) — balanced performance
- Gemini 2.0 Flash (Google) — large context

### Step 3: Project Initialization

Configure core features:
- **DanteForge auto-orchestration** - Enable automated workflow execution
- **Sandbox mode** - Run commands in isolated Docker containers (requires Docker)
- **Git auto-commit** - Automatically commit changes after each task

### Step 4: Configuration Validation

The wizard validates your configuration:
- Checks that required API keys are available
- Verifies Docker is installed (if sandbox enabled)
- Verifies Git is installed (if auto-commit enabled)

### Step 5: Save Configuration

Saves your configuration to:
- `.dantecode/STATE.yaml` - Main configuration file
- `.env` - API keys (remember to add to `.gitignore`!)

### Health Checks

After saving, the wizard runs health checks:
- Model catalog availability
- DanteForge availability
- Docker daemon status (if sandbox enabled)

## Example Session

```
DanteCode Interactive Setup Wizard
────────────────────────────────────────────────────────────
Welcome! This wizard will help you configure DanteCode.
Project: /path/to/your/project

Step 1 of 5 — API Key Configuration
────────────────────────────────────────────────────────────
✓ ANTHROPIC_API_KEY is set in environment
⚠ OPENAI_API_KEY not found in environment
? Configure OpenAI (GPT) now? [y/N] n

Step 2 of 5 — Model Selection
────────────────────────────────────────────────────────────

Which AI model would you like to use?
  > 1. claude-sonnet-4-6 (Anthropic) — recommended for quality
    2. claude-haiku-4-5-20251001 (Anthropic) — fast & cheap
    3. grok-3 (xAI) — high capability
    4. gpt-4o (OpenAI) — balanced performance
    5. gemini-2.0-flash (Google) — large context
    6. Skip — keep existing or default
Select (1–6, default: 1): 1

Step 3 of 5 — Project Initialization
────────────────────────────────────────────────────────────
? Enable DanteForge auto-orchestration? [Y/n] y
? Enable sandbox mode (Docker required)? [y/N] n
? Enable Git auto-commit? [Y/n] y

Step 4 of 5 — Validating Configuration
────────────────────────────────────────────────────────────
✓ Docker detected and available
✓ Git detected and available
✓ All validation checks passed

Step 5 of 5 — Saving Configuration
────────────────────────────────────────────────────────────
✓ Configuration saved to .dantecode/STATE.yaml

Running Health Checks
────────────────────────────────────────────────────────────
✓ Model catalog: OK
✓ DanteForge: OK

Setup Complete
────────────────────────────────────────────────────────────

Configuration Summary:
  Model:       anthropic/claude-sonnet-4-6
  DanteForge:  enabled
  Sandbox:     disabled
  Git:         auto-commit

Setup complete! You're ready to start.
Try: /magic build a todo app
```

## Non-Interactive Mode

For CI/CD or scripted setups, consider using:
- `dantecode init` for automated initialization
- `dantecode config set` for individual settings
- Environment variables for API keys

## Comparison with Other Commands

| Command | Purpose | Interactive |
|---------|---------|-------------|
| `/setup` | Full configuration wizard with validation | Yes |
| `/onboard` | Quick onboarding (uses ux-polish package) | Yes |
| `dantecode init` | Initialize project with defaults | No |
| `dantecode config set` | Change individual settings | No |

## Tips

1. **Security**: Always add `.env` to your `.gitignore` to avoid committing API keys
2. **Docker**: Install Docker before enabling sandbox mode
3. **Reconfiguration**: Use `--force` flag to reconfigure an existing setup
4. **Manual config**: You can always edit `.dantecode/STATE.yaml` directly

## Related Commands

- `/model` - Switch models on the fly
- `/config show` - View current configuration
- `/config set <key> <value>` - Change specific settings
- `/help` - List all available commands
