# DanteCode VSCode Extension

AI-powered coding assistant with full CLI feature parity, planning mode, verification, memory, and multi-agent collaboration.

## Overview

The DanteCode VSCode extension brings the complete power of the DanteCode CLI directly into your editor with an enhanced visual interface. All 86 slash commands are available with autocomplete, and key workflows like planning and verification have dedicated panels.

## Features

### Slash Command Autocomplete

Type `/` in the chat to see all available commands with fuzzy search:

- **Instant suggestions**: < 150ms latency
- **Fuzzy matching**: `/pla` matches `/plan`
- **Arrow key navigation**: Up/Down to select
- **Enter to execute**: Quick command insertion
- **ESC to dismiss**: Close autocomplete

### Planning Mode

Visual workflow for generating, reviewing, and executing implementation plans:

```
/plan Build a todo app with React
```

**Features:**
- **Plan overview**: Goal, complexity, estimated hours, created time
- **Step list**: Files, dependencies, verify commands for each step
- **Approve/Reject buttons**: Visual workflow instead of CLI prompts
- **Execution progress**: Real-time status updates per step
- **Plan persistence**: Saved to `.dantecode/plans/` for later review
- **Plan history**: List and load all saved plans

**Workflow:**
1. Generate plan with `/plan <goal>`
2. Review steps and dependencies
3. Approve to start execution or reject to regenerate
4. Track progress as each step completes

### Verification Panel

Run PDSE quality checks with color-coded visual results:

```
/pdse src/app.ts
```

**Features:**
- **Score display**: 0-100 with color coding (red < 70, yellow 70-84, green >= 85)
- **Issue list**: Grouped by category with line numbers
- **File links**: Click to jump to issues
- **Batch verification**: Check multiple files
- **History tracking**: Compare scores over time

### Memory Panel

Browse and search your agent's memory:

```
/memory list
/memory search <query>
/memory stats
```

**Features:**
- **Memory browser**: Navigate all stored memories
- **Semantic search**: Find relevant context quickly
- **Memory stats**: Utilization, entry count, oldest/newest
- **Cross-session search**: Find memories from past sessions
- **Forget command**: Remove outdated memories

### Background Agents

Run long-running tasks in the background:

```
/bg Run full test suite
/bg Generate documentation
```

**Features:**
- **Live task list**: See all running agents
- **Progress updates**: Real-time status for each agent
- **Task cancellation**: Stop agents from the panel
- **Result notifications**: Toast when tasks complete

### Multi-Agent Party Mode

Orchestrate multiple agents collaborating on a task:

```
/party Build authentication system
```

**Features:**
- **Fleet view**: Visual dashboard of all active agents
- **Worktree isolation**: Each agent in its own git worktree
- **Real-time coordination**: See agents communicate
- **Merge coordination**: Automatic conflict resolution

### Automation Dashboard

Manage webhooks, schedules, and file watchers:

```
/automate dashboard
```

**Features:**
- **Webhook listeners**: GitHub, GitLab, custom webhooks
- **Scheduled tasks**: Cron-based automation
- **File watchers**: Trigger on file changes
- **Execution history**: View past automation runs
- **Template library**: Pre-built automation patterns

### Semantic Code Search

Build indexes and search your codebase semantically:

```
/index
/search authentication logic
```

**Features:**
- **Semantic matching**: Find conceptually similar code
- **Fast results**: Indexed search < 500ms
- **File context**: Preview matches with surrounding code
- **Jump to definition**: Click to navigate

## All Available Commands

### Workflow (5 commands)
- `/plan <goal>` - Generate implementation plan
- `/magic <task>` - Balanced autoforge preset
- `/inferno <task>` - Maximum-power preset with OSS discovery
- `/forge <goal>` - Execute GSD waves for a feature
- `/autoforge <task>` - Deterministic auto-orchestration

### Git (4 commands)
- `/commit [message]` - Create a git commit
- `/diff [file]` - Show git diff
- `/revert` - Revert last commit
- `/undo` - Undo last edit

### System (16 commands)
- `/help` - Show available commands
- `/status` - System status dashboard
- `/model <provider/model>` - Switch AI model
- `/history` - Chat history
- `/session list|save|load` - Session management
- `/export <path>` - Export session
- `/import <path>` - Import session
- `/skill <name> [args]` - Execute or manage skills
- `/skills` - List available skills
- `/fork` - Fork current session
- `/lessons` - View learned lessons
- `/gaslight` - Toggle gaslight mode
- `/theme` - Change UI theme
- `/cost` - Show cost tracking
- `/sandbox` - Toggle sandbox mode
- `/mcp` - MCP server management

### Search (3 commands)
- `/index` - Build semantic code index
- `/search <query>` - Semantic code search
- `/research` - Research mode with web search

### Agent (3 commands)
- `/bg <task>` - Run task in background
- `/party <goal>` - Multi-agent collaboration
- `/fleet` - Fleet management

## Installation

### From VSCode Marketplace

1. Open VSCode
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (Mac)
3. Search for "DanteCode"
4. Click Install

### From VSIX

1. Download the latest `.vsix` from releases
2. Open VSCode
3. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
4. Type "Install from VSIX"
5. Select the downloaded file

## Configuration

### API Keys

1. Click the settings icon in the DanteCode sidebar
2. Enter your API keys:
   - **Anthropic**: For Claude models
   - **OpenAI**: For GPT models
   - **xAI**: For Grok models
3. Keys are stored securely in VSCode secrets

### Model Selection

Click the model dropdown in the chat panel to select:
- **Claude 3.5 Sonnet** (default)
- **Claude 3.5 Haiku**
- **GPT-4**
- **Grok 2**

### Extension Settings

Open VSCode settings (`Ctrl+,`) and search for "dantecode":

- `dantecode.maxTokens`: Max tokens per request (default: 8192)
- `dantecode.temperature`: Model temperature (default: 0.7)
- `dantecode.autoIndexOnSave`: Auto-index on file save (default: false)
- `dantecode.enablePlanningMode`: Enable planning mode (default: true)
- `dantecode.enableBackgroundAgents`: Enable background agents (default: true)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` → "DanteCode: New Chat" | Start new chat session |
| `Ctrl+Shift+P` → "DanteCode: Run PDSE" | Run quality check on current file |
| `Ctrl+Shift+P` → "DanteCode: Index Workspace" | Build semantic index |
| `Ctrl+Enter` in chat | Send message |
| `/` in chat | Show command autocomplete |
| `Esc` in autocomplete | Dismiss autocomplete |

## Context Menu Integration

Right-click in the file explorer or editor:

- **Add to Context**: Add file to chat context
- **Run PDSE**: Run quality check
- **Commit File**: Create commit for this file
- **Verify Selection**: Verify selected code
- **Search Similar**: Find similar code patterns

## Workflow Examples

### Example 1: Plan and Build a Feature

```
1. /plan Add user authentication
2. Review plan in planning panel
3. Click "Approve" button
4. Watch progress as each step executes
5. Review PDSE scores for generated files
```

### Example 2: Background Research + Implementation

```
1. /bg Research authentication best practices
2. Continue working on other tasks
3. Get notification when research completes
4. Review findings
5. /magic Implement authentication based on research
```

### Example 3: Multi-Agent Parallel Work

```
1. /party Build complete CRUD API
2. Agent 1: Database models
3. Agent 2: API routes
4. Agent 3: Tests
5. Auto-merge when all complete
```

## Troubleshooting

### Command not found

- Ensure extension is activated (check status bar)
- Reload window: `Ctrl+Shift+P` → "Reload Window"
- Check extension host logs: `Help` → `Toggle Developer Tools`

### Autocomplete not working

- Type `/` to trigger
- Ensure cursor is at start of line
- Check autocomplete latency in settings

### Planning mode not showing

- Ensure `dantecode.enablePlanningMode` is true
- Check that plan command executed successfully
- View output channel: `View` → `Output` → "DanteCode"

### Memory issues with large repos

- Index incrementally: `/index src/` instead of whole workspace
- Adjust `dantecode.maxTokens` if context window full
- Use `/compact` to compress message history

## Performance

- **Autocomplete latency**: < 150ms
- **Command execution**: < 500ms for local operations
- **Large repo support**: 1000+ files indexed efficiently
- **Long session stability**: 8-hour sessions tested
- **Memory usage**: < 100MB webview overhead

## Testing

90% test coverage with 211 integration tests:

- Message passing (9 tests)
- State synchronization (4 tests)
- Panel creation/destruction (4 tests)
- Command routing (36 tests)
- Webview interactions (4 tests)
- Error handling (3 tests)
- Autocomplete (67 tests)
- Planning mode (36 tests)
- Commands (28 tests)
- Performance (20 tests)

Run tests:
```bash
cd packages/vscode
npm test
```

## Architecture

```
packages/vscode/
├── src/
│   ├── sidebar-provider.ts      # Main chat webview
│   ├── command-completion.ts    # Slash autocomplete engine
│   ├── planning-panel.ts        # Planning mode UI
│   ├── verification-panel.ts    # PDSE verification UI
│   ├── memory-panel.ts          # Memory browser UI
│   ├── agents-panel.ts          # Background agents UI
│   ├── automation-panel.ts      # Automation dashboard
│   ├── command-bridge.ts        # CLI → VSCode bridge
│   └── __tests__/               # 211 integration tests
├── webview/
│   ├── chat.html                # Main chat UI
│   ├── planning.html            # Planning panel UI
│   └── styles.css               # Shared styles
└── package.json
```

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](../../LICENSE)

## Links

- [GitHub Repository](https://github.com/dantericardo88/dantecode)
- [CLI Documentation](../cli/README.md)
- [DanteForge Documentation](../../docs/danteforge.md)
- [Issue Tracker](https://github.com/dantericardo88/dantecode/issues)

---

**Version:** 0.9.2  
**Last Updated:** 2026-04-02  
**Phase 6 Complete:** ✅ Full CLI feature parity achieved
