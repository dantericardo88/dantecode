---
name: blade-progress
version: 1.0.0
trigger: autoforge
description: >
  Wraps any AutoforgeConfig with the Blade v1.2 progress UX: silent mode,
  single-line status updates, PDSE tracking, and cost-aware phase reporting.
  Imported automatically when silentMode=true in BladeAutoforgeConfig.
schema:
  input: BladeAutoforgeConfig
  output: BladeProgressState[]
constitution:
  pdseThreshold: 90
  antiStubEnabled: true
  maxIterations: null
---

# blade-progress

Autoforge skill that encapsulates the Blade v1.2 progress UX. When activated,
replaces per-tool webview messages with a single-line phase indicator.

## Usage

```typescript
import { BladeProgressEmitter } from "@dantecode/danteforge";

const emitter = new BladeProgressEmitter(config, (state) => {
  webview.postMessage({ type: "autoforge_progress", payload: state });
});
```

## Triggers

This skill is triggered automatically when:
1. `/autoforge --silent` is invoked from the CLI
2. `agentMode === "yolo"` in AgentConfig
3. `BladeAutoforgeConfig.silentMode === true`
