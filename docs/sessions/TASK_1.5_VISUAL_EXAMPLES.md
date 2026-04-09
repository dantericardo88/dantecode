# Task 1.5: Mode Visibility - Visual Examples

## Status Bar Examples

### Review Mode (Default - Safe)
```
 anthropic/claude-sonnet-4 │ mode:review │ 1,234 tokens │ abc123 │ workspace-write │ PDSE: 85
 ^^^^^^^^^^^^^^^^^^^^^^^^      ^^^^^^^^^^^
       cyan (info)              cyan (safe)
```

### Plan Mode (Read-Only)
```
 anthropic/claude-sonnet-4 │ mode:plan │ 5,678 tokens │ def456 │ workspace-write │ PDSE: 92
                                ^^^^^^^^^
                             cyan (read-only)
```

### Apply Mode (Caution)
```
 anthropic/claude-sonnet-4 │ mode:apply │ 3,456 tokens │ ghi789 │ full-access │ PDSE: 78
                                ^^^^^^^^^^
                            yellow (caution)
```

### Autoforge Mode (Autonomous)
```
 anthropic/claude-sonnet-4 │ mode:autoforge │ 9,012 tokens │ jkl012 │ full-access │ PDSE: 88
                                ^^^^^^^^^^^^^^
                              red (autonomous)
```

### Yolo Mode (Unrestricted)
```
 anthropic/claude-sonnet-4 │ mode:yolo │ 2,345 tokens │ mno345 │ full-access │ PDSE: 95
                                ^^^^^^^^^
                            magenta (unrestricted)
```

## /mode Command Output

### Without Arguments (Show Current Mode)
```
> /mode

Current approval mode: review

Available modes:
  review     - Require approval before workspace mutations and subagents (default, safe)
  plan       - Block workspace mutations and subagents until execution is approved (read-only)
  apply      - Auto-approve edits, still gate shell/git/subagent execution (caution)
  autoforge  - Apply profile for pipeline execution (autonomous)
  Unsafe escape hatch: yolo -> disables the approval gateway (unrestricted)

Legacy aliases: default -> review, auto-edit -> apply

Usage: /mode <mode-name>
```

### Switching Mode
```
> /mode apply
Approval mode set to apply. Status bar updated.

[Status bar immediately reflects: mode:apply in yellow]
```

## Color Coding Legend

| Mode       | Color   | ANSI Code | Meaning           |
|------------|---------|-----------|-------------------|
| review     | Cyan    | \x1b[36m  | Safe, read-only   |
| plan       | Cyan    | \x1b[36m  | Read-only         |
| apply      | Yellow  | \x1b[33m  | Caution           |
| autoforge  | Red     | \x1b[31m  | Autonomous        |
| yolo       | Magenta | \x1b[35m  | Unrestricted      |

## Help Command Enhancement

```
> /help --all

All Commands

Tip: Current mode is always visible in the status bar at the bottom.
Use /mode to view or change approval mode (review/plan/apply/autoforge/yolo).

  Core
    /help                         List available commands
    /mode [mode-name]             Switch approval mode
    ...
```

## Real-World Usage Flow

### 1. Starting a Session
```bash
$ dantecode

Welcome to DanteCode v0.9.2
[model: claude-sonnet-4] [mode:review] [ctx: 0%] [session: a1b2c3]
                          ^^^^^^^^^^^
                          Mode visible on startup

> Build a new feature
[Agent works in review mode, asking for approval before mutations]
```

### 2. Switching to Apply Mode for Faster Iteration
```bash
> /mode apply
Approval mode set to apply. Status bar updated.

[model: claude-sonnet-4] [mode:apply] [ctx: 15%] [session: a1b2c3]
                          ^^^^^^^^^^
                          Yellow = caution

> Continue building the feature
[Agent auto-approves edits, still gates shell commands]
```

### 3. Planning a Complex Change
```bash
> /mode plan
Approval mode set to plan. Status bar updated.

[model: claude-sonnet-4] [mode:plan] [ctx: 25%] [session: a1b2c3]
                          ^^^^^^^^^
                          Cyan = read-only

> Create a detailed plan for refactoring the authentication system
[Agent creates plan without making any file changes]
```

### 4. Checking Current Mode
```bash
> /mode

Current approval mode: plan

[Operator knows immediately what mode they're in without checking status bar]
```

## Key Benefits

1. **Always Visible**: Operator never has to guess what mode they're in
2. **Color Coded**: Visual cues match severity (safe = cyan, danger = red)
3. **Non-Intrusive**: Compact format doesn't clutter the status bar
4. **Immediate Feedback**: Status bar updates instantly on mode change
5. **Consistent**: Same color scheme in /mode command and status bar

## Technical Implementation Notes

- Status bar position: Fixed at terminal bottom row
- Mode field: Always second position after model label
- Update mechanism: Callbacks in repl.ts sync on every round
- Theme integration: Uses ThemeEngine for color consistency
- Graceful degradation: Non-TTY environments skip rendering

## Future Enhancements (Out of Scope for Task 1.5)

- Add mode indicator to VS Code extension sidebar (Task 1.6)
- Add mode change notifications/toasts
- Add mode-specific tips/hints in help system
- Add mode preset macros (e.g., /mode:safe-review)
- Add per-project default mode configuration
