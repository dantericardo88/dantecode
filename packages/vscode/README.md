# DanteCode - AI Coding Assistant with Constitutional Verification

DanteCode is an AI-powered coding assistant for VS Code with built-in quality verification, learned lessons, and multi-provider support.

## Features

### Chat with Tool Execution
Open the sidebar (`Ctrl+Alt+D`) and ask anything. DanteCode has a full agent loop that can read, write, edit files, run commands, and search your codebase.

### Cmd+K Inline Edit
Select code and press `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux) to describe a change. DanteCode generates the edit, shows a diff preview, and lets you accept or reject.

### Real-Time Quality Scoring
PDSE (Production-Deployment Safety Evaluation) scores appear in the status bar, file explorer badges, and inline annotations.

### @file and @folder Mentions
Type `@filename` in chat to add files to context. Type `@foldername` to include entire directories.

### Multi-Provider Support
Works with Grok (xAI), Claude (Anthropic), GPT (OpenAI), Gemini (Google), and Ollama (local).

### Cost Controls
Built-in session and monthly budget limits prevent runaway API costs. Warning at 80%, hard stop at 100%.

### Learned Lessons
DanteCode remembers patterns from past sessions and injects them into every prompt.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Alt+D` | Open chat |
| `Cmd+K` / `Ctrl+K` | Inline edit |
| `Ctrl+Alt+P` | Run PDSE |
| `Ctrl+Alt+V` | Run verification |
| `Ctrl+Alt+C` | Smart commit |
| `Ctrl+Alt+S` | Semantic search |

## Getting Started

1. Install the extension
2. Run **DanteCode: Setup API Keys** from the command palette
3. Open the sidebar and start chatting
4. Try Cmd+K on selected code

## Requirements

- VS Code 1.95+
- API key for at least one provider (Grok, Anthropic, OpenAI, Google) OR local Ollama
