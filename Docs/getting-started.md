# Getting Started with DanteCode

DanteCode is an AI coding assistant that runs in your terminal and VSCode. It connects to Anthropic, OpenAI, or Ollama to help you write, review, and refactor code.

## Install

```bash
npm install -g @dantecode/cli
```

Requires Node.js 18+.

## Step 1: Configure your provider

Run the interactive setup:

```bash
dantecode init
```

This creates a `.dantecode/` directory in your project and walks you through selecting a provider and entering your API key.

**Quick manual setup** — set provider and API key directly:

```bash
dantecode config set provider.id anthropic
dantecode config set provider.apiKey <ANTHROPIC_API_KEY>
dantecode config set provider.model claude-sonnet-4-6
```

For OpenAI:

```bash
dantecode config set provider.id openai
dantecode config set provider.apiKey sk-YOUR-OPENAI-KEY
dantecode config set provider.model gpt-4o
```

For a local Ollama instance (no API key required):

```bash
dantecode config set provider.id ollama
dantecode config set provider.model llama3
```

## Step 2: Verify configuration

```bash
dantecode config validate
```

You should see `✓ Config is valid`. If not, follow the fix hint printed next to each error.

## Step 3: Run your first task

Open a project directory and ask DanteCode to help:

```bash
cd my-project
dantecode "Add input validation to the signup form"
```

DanteCode reads your project files, plans changes, and writes them. You approve each change in the diff view.

## Step 4 (optional): Install the VSCode extension

Search for **DanteCode** in the VSCode Extensions panel or install from the command line:

```bash
code --install-extension dantecode.dantecode
```

Once installed, a DanteCode panel appears in the sidebar. Click the chat icon and start asking questions about your code.

## What's next?

- [First task tutorial](tutorials/first-task.md) — a full walkthrough from zero to merged PR
- [Configure provider](how-to/configure-provider.md) — advanced provider configuration options
- [Enable FIM completions](how-to/use-fim.md) — inline ghost-text suggestions as you type
- [CLI commands reference](reference/cli-commands.md) — full list of commands and flags
- [Architecture overview](explanation/architecture.md) — how DanteCode works under the hood
