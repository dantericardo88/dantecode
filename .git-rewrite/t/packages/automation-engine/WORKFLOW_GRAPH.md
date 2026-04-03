# Workflow Graph - Graph-Based Workflow Execution

LangGraph-inspired declarative workflow system for DanteCode. Build stateful, resumable workflows with conditional branching and automatic checkpointing.

## Overview

The Workflow Graph system provides:

- **Declarative DSL** - Build workflows with a fluent API
- **State Channels** - Typed state management with reducers
- **Conditional Edges** - Dynamic branching based on state
- **Checkpointing** - Resume from any point using EventSourcedCheckpointer
- **Observability** - Event-driven execution tracking
- **Type Safety** - Full TypeScript support with inference

## Core Concepts

### State Schema

Define your workflow state with typed channels and reducers:

```typescript
import { defineStateSchema, ChannelReducers } from "@dantecode/automation-engine";

interface MyState {
  counter: number;
  items: string[];
  metadata: Record<string, unknown>;
}

const schema = defineStateSchema<MyState>({
  counter: {
    default: 0,
    reducer: ChannelReducers.sum, // Accumulate values
  },
  items: {
    default: [],
    reducer: ChannelReducers.append, // Append to array
  },
  metadata: {
    default: {},
    reducer: ChannelReducers.merge, // Shallow merge
  },
});
```

### Nodes

Nodes are computation units that read state and produce updates:

```typescript
import { createWorkflowGraph } from "@dantecode/automation-engine";

const graph = createWorkflowGraph(schema)
  .addNode("fetchData", async ({ state, getChannel }) => {
    // Read current state
    const counter = state.counter;

    // Or access channels directly
    const items = getChannel<string[]>("items");

    // Return partial state updates
    return {
      counter: counter + 1,
      items: "newItem",
    };
  })
  .addNode("processData", async ({ state, emit }) => {
    // Emit custom events
    emit("processing", { count: state.items.length });

    return {
      metadata: { processed: true },
    };
  });
```

### Edges

Connect nodes with direct or conditional edges:

```typescript
// Direct edge
graph.addEdge("fetchData", "processData");

// Conditional edge - single target
graph.addConditionalEdge("processData", (state) => {
  return state.items.length > 10 ? "archive" : "continue";
});

// Conditional edge - multiple targets (fan-out)
graph.addConditionalEdge("router", (state) => {
  const targets = [];
  if (state.counter > 5) targets.push("highPath");
  if (state.metadata.urgent) targets.push("urgentPath");
  return targets.length > 0 ? targets : "defaultPath";
});

// Set entry and finish points
graph
  .setEntryPoint("fetchData")
  .setFinishPoint("archive")
  .setFinishPoint("continue");
```

## Complete Example

### Linear Workflow

```typescript
import { createWorkflowGraph, defineStateSchema, ChannelReducers } from "@dantecode/automation-engine";

interface DataProcessingState {
  rawData: string[];
  processedData: string[];
  validatedData: string[];
  errors: string[];
}

const schema = defineStateSchema<DataProcessingState>({
  rawData: { default: [] },
  processedData: { default: [], reducer: ChannelReducers.append },
  validatedData: { default: [], reducer: ChannelReducers.append },
  errors: { default: [], reducer: ChannelReducers.append },
});

const workflow = createWorkflowGraph(schema)
  .addNode("fetch", async () => ({
    rawData: ["item1", "item2", "item3"],
  }))
  .addNode("process", async ({ state }) => ({
    processedData: state.rawData.map((item) => item.toUpperCase()),
  }))
  .addNode("validate", async ({ state }) => {
    const valid = state.processedData.filter((item) => item.length > 0);
    const invalid = state.processedData.filter((item) => item.length === 0);
    return {
      validatedData: valid,
      errors: invalid.map((item) => `Invalid: ${item}`),
    };
  })
  .addEdge("fetch", "process")
  .addEdge("process", "validate")
  .setEntryPoint("fetch")
  .setFinishPoint("validate")
  .compile();

// Execute
const result = await workflow.execute();

console.log(result.state.validatedData); // ["ITEM1", "ITEM2", "ITEM3"]
console.log(result.success); // true
console.log(result.history.length); // 5 (START + 3 nodes + END)
```

### Conditional Branching

```typescript
interface ReviewState {
  prNumber: number;
  files: string[];
  complexity: "low" | "medium" | "high";
  reviewPath: string;
}

const schema = defineStateSchema<ReviewState>({
  prNumber: { default: 0 },
  files: { default: [] },
  complexity: { default: "low" as const },
  reviewPath: { default: "" },
});

const workflow = createWorkflowGraph(schema)
  .addNode("analyze", async ({ state }) => {
    const complexity =
      state.files.length > 20 ? "high" :
      state.files.length > 10 ? "medium" : "low";
    return { complexity };
  })
  .addNode("quickReview", async () => ({
    reviewPath: "automated",
  }))
  .addNode("thoroughReview", async () => ({
    reviewPath: "manual",
  }))
  .addNode("expertReview", async () => ({
    reviewPath: "senior-engineer",
  }))
  .addConditionalEdge("analyze", (state) => {
    switch (state.complexity) {
      case "low": return "quickReview";
      case "medium": return "thoroughReview";
      case "high": return "expertReview";
      default: return "quickReview";
    }
  })
  .setEntryPoint("analyze")
  .setFinishPoint("quickReview")
  .setFinishPoint("thoroughReview")
  .setFinishPoint("expertReview")
  .compile();

const result = await workflow.execute({
  input: { prNumber: 123, files: Array(25).fill("file.ts") },
});

console.log(result.state.reviewPath); // "senior-engineer"
```

### Cyclic Workflow

```typescript
interface PollingState {
  attempts: number;
  status: "pending" | "complete" | "failed";
  maxAttempts: number;
}

const schema = defineStateSchema<PollingState>({
  attempts: { default: 0, reducer: ChannelReducers.sum },
  status: { default: "pending" as const },
  maxAttempts: { default: 10 },
});

const workflow = createWorkflowGraph(schema, { maxSteps: 100 })
  .addNode("check", async ({ state }) => {
    // Simulate checking external service
    const isComplete = Math.random() > 0.7;
    return {
      attempts: 1,
      status: isComplete ? "complete" : "pending",
    };
  })
  .addNode("wait", async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return {};
  })
  .addNode("complete", async () => ({}))
  .addNode("failed", async () => ({
    status: "failed" as const,
  }))
  .addConditionalEdge("check", (state) => {
    if (state.status === "complete") return "complete";
    if (state.attempts >= state.maxAttempts) return "failed";
    return "wait";
  })
  .addEdge("wait", "check")
  .setEntryPoint("check")
  .setFinishPoint("complete")
  .setFinishPoint("failed")
  .compile();

const result = await workflow.execute();
console.log(`Completed after ${result.state.attempts} attempts`);
```

## Advanced Features

### Retry Policy

```typescript
graph.addNode(
  "flakyOperation",
  async () => {
    // This might fail
    return await unstableApiCall();
  },
  {
    description: "Call external API",
    timeout: 5000,
    retryPolicy: {
      maxRetries: 3,
      backoff: "exponential",
      delayMs: 1000,
    },
  }
);
```

### Event Observability

```typescript
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();

emitter.on("node:started", ({ nodeName, step }) => {
  console.log(`Starting ${nodeName} at step ${step}`);
});

emitter.on("node:completed", ({ nodeName, durationMs }) => {
  console.log(`Completed ${nodeName} in ${durationMs}ms`);
});

emitter.on("edge:traversed", ({ from, to }) => {
  console.log(`Traversing ${from} → ${to}`);
});

const workflow = createWorkflowGraph(schema, {
  eventEmitter: emitter,
}).compile();
```

### Checkpointing

```typescript
import { WorkflowGraphCheckpointer } from "@dantecode/automation-engine";

const checkpointer = new WorkflowGraphCheckpointer(
  process.cwd(),
  schema,
  { maxEventsBeforeCompaction: 50 }
);

// Create checkpoint callback
const checkpointCallback = checkpointer.createCheckpointCallback(
  "session-123",
  { workflowName: "data-processing" }
);

const workflow = createWorkflowGraph(schema, {
  checkpointAfterNode: true,
}).compile();

// Execute with checkpointing
const result = await workflow.execute();

// Resume from checkpoint
const checkpoints = await checkpointer.list("session-123");
const lastCheckpoint = checkpoints[0];

const resumed = await workflow.execute({
  checkpointId: lastCheckpoint.checkpointId,
});
```

### Integration with Automation Engine

```typescript
import {
  defineWorkflowAutomation,
  executeWorkflowAutomation,
} from "@dantecode/automation-engine";

const automation = defineWorkflowAutomation({
  name: "pr-review-workflow",
  schema: defineStateSchema({
    prNumber: { default: 0 },
    approved: { default: false },
  }),
  build: (config) => {
    const graph = createWorkflowGraph(config.stateSchema);
    return graph
      .addNode("fetchPR", async ({ state }) => ({
        // ... fetch PR details
      }))
      .addNode("analyze", async () => ({
        // ... analyze changes
      }))
      .addNode("approve", async () => ({
        approved: true,
      }))
      .addEdge("fetchPR", "analyze")
      .addEdge("analyze", "approve")
      .setEntryPoint("fetchPR")
      .setFinishPoint("approve")
      .compile();
  },
  trigger: {
    event: "pull_request",
  },
});

// Execute as automation
const result = await executeWorkflowAutomation(
  automation,
  { prNumber: 123 },
  {
    projectRoot: process.cwd(),
    sessionId: "session-456",
  }
);
```

## Visualization

Generate DOT graph for visualization:

```typescript
const workflow = createWorkflowGraph(schema)
  .addNode("start", async () => ({}))
  .addNode("process", async () => ({}))
  .addNode("end", async () => ({}))
  .addEdge("start", "process")
  .addEdge("process", "end")
  .setEntryPoint("start")
  .setFinishPoint("end")
  .compile();

const dot = workflow.toDot();
console.log(dot);
// digraph workflow {
//   rankdir=LR;
//   "__start__" [shape=circle];
//   "start" [label="start"];
//   "process" [label="process"];
//   "end" [label="end"];
//   "__end__" [shape=circle];
//   "__start__" -> "start";
//   "start" -> "process";
//   "process" -> "end";
//   "end" -> "__end__";
// }

// Save to file and render with Graphviz:
// echo "$dot" | dot -Tpng > workflow.png
```

## Channel Reducers

Built-in reducers for common patterns:

```typescript
import { ChannelReducers } from "@dantecode/automation-engine";

// Always keep last value (default)
ChannelReducers.lastValue

// Append to array
ChannelReducers.append

// Shallow merge objects
ChannelReducers.merge

// Sum numbers
ChannelReducers.sum

// Set union
ChannelReducers.union

// Custom reducer
const customReducer = (current: number[], update: number) => {
  return [...current, update].sort((a, b) => a - b);
};
```

## Best Practices

1. **Keep nodes focused** - Each node should do one thing well
2. **Use typed schemas** - Define your state interface for type safety
3. **Leverage reducers** - Use built-in reducers for common patterns
4. **Handle errors** - Use try-catch in nodes and retry policies
5. **Monitor execution** - Use event emitters for observability
6. **Checkpoint long workflows** - Enable checkpointing for resumability
7. **Test conditional edges** - Unit test edge conditions separately
8. **Avoid deep nesting** - Keep graphs flat, use subgraphs if needed
9. **Set max steps** - Protect against infinite cycles
10. **Document nodes** - Use metadata descriptions for clarity

## Performance

- Nodes execute sequentially unless multi-target edges create parallelism
- State updates are batched and applied after each node
- Channel versions prevent conflicts in concurrent scenarios
- Checkpoints are incremental (event-sourced)
- Memory usage scales with state size and history length

## API Reference

### WorkflowGraph<TState>

- `addNode(name, fn, metadata?)` - Add computation node
- `addEdge(from, to, label?)` - Add direct edge
- `addConditionalEdge(from, condition, label?)` - Add conditional edge
- `setEntryPoint(name)` - Set entry node
- `setFinishPoint(name)` - Add finish edge to END
- `compile()` - Compile to executable graph

### CompiledWorkflowGraph<TState>

- `execute(options?)` - Execute workflow
- `stream(options?)` - Stream execution events
- `toDot()` - Generate DOT visualization
- `getMetadata()` - Get graph metadata

### NodeContext<TState>

- `state` - Current state snapshot
- `nodeName` - Current node name
- `step` - Execution step
- `getChannel<T>(name)` - Get channel value
- `emit(event, data?)` - Emit custom event

### ExecutionOptions<TState>

- `input?` - Initial state
- `checkpointId?` - Resume from checkpoint
- `maxSteps?` - Override max steps
- `timeout?` - Execution timeout
- `debug?` - Enable debug mode

### ExecutionResult<TState>

- `executionId` - Unique execution ID
- `state` - Final state
- `history` - Node execution history
- `durationMs` - Total duration
- `success` - Whether completed successfully
- `error?` - Error if failed
- `checkpointId?` - Checkpoint ID if saved

## Examples

See tests for comprehensive examples:
- `workflow-graph-state.test.ts` - State management
- `workflow-graph-builder.test.ts` - Graph construction
- `workflow-graph-executor.test.ts` - Execution scenarios
- `workflow-graph-integration.test.ts` - Real-world workflows
