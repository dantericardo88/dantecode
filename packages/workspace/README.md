# @dantecode/workspace

Workspace abstraction for local/remote/container execution symmetry, inspired by OpenHands architecture.

## Features

- **Symmetrical API**: Same interface for local, remote, and container workspaces
- **Lifecycle Management**: Initialize, suspend, resume, and destroy workspaces
- **File Operations**: Full filesystem API with glob patterns and watching
- **Command Execution**: Execute commands with proper isolation
- **Environment Management**: Get/set environment variables per workspace
- **Snapshot/Resume**: Capture and restore complete workspace state
- **Event System**: Observable workspace operations
- **Integration**: Works seamlessly with DanteSandbox

## Installation

```bash
npm install @dantecode/workspace
```

## Quick Start

### Local Workspace

```typescript
import { createLocalWorkspace } from "@dantecode/workspace";

const workspace = createLocalWorkspace("my-workspace", "/tmp/workspace");
await workspace.initialize();

// File operations
await workspace.writeFile("hello.txt", "Hello, World!");
const content = await workspace.readFile("hello.txt");

// Command execution
const result = await workspace.execute("ls -la");
console.log(result.stdout);

// Cleanup
await workspace.destroy();
```

### Container Workspace

```typescript
import { createContainerWorkspace } from "@dantecode/workspace";

const workspace = createContainerWorkspace(
  "container-workspace",
  "/workspace",
  "node:18-alpine"
);

await workspace.initialize();

// Everything runs in an isolated container
await workspace.writeFile("package.json", JSON.stringify({ name: "test" }));
await workspace.execute("npm install express");

await workspace.destroy();
```

### Remote Workspace

```typescript
import { createRemoteWorkspace } from "@dantecode/workspace";

const workspace = createRemoteWorkspace(
  "remote-workspace",
  "/home/user/project",
  "example.com",
  {
    port: 22,
    username: "user",
    privateKeyPath: "~/.ssh/id_rsa",
  }
);

await workspace.initialize();

// Operations execute over SSH
await workspace.writeFile("README.md", "# Remote Project");
const result = await workspace.execute("git status");

await workspace.destroy();
```

## Workspace Manager

```typescript
import { getWorkspaceManager } from "@dantecode/workspace";

const manager = getWorkspaceManager();

// Create workspaces
const ws1 = await manager.create({
  id: "ws-1",
  type: "local",
  basePath: "/tmp/ws1",
});

const ws2 = await manager.create({
  id: "ws-2",
  type: "container",
  basePath: "/workspace",
  image: "ubuntu:latest",
});

// List all workspaces
const workspaces = manager.list();

// Get statistics
const stats = await manager.getStats();

// Cleanup
await manager.destroyAll();
```

## Suspend/Resume

```typescript
const workspace = createLocalWorkspace("resumable", "/tmp/workspace");
await workspace.initialize();

// Do some work
await workspace.writeFile("data.json", JSON.stringify({ count: 42 }));
await workspace.setEnv("MY_VAR", "my-value");

// Suspend and capture snapshot
const snapshot = await workspace.suspend();

// Later... resume from snapshot
await workspace.resume(snapshot);

// State is restored
const content = await workspace.readFile("data.json");
const myVar = await workspace.getEnv("MY_VAR");
```

## File Operations

```typescript
// Read/write files
await workspace.writeFile("config.json", JSON.stringify(config));
const content = await workspace.readFile("config.json");

// List files with glob patterns
const tsFiles = await workspace.listFiles("**/*.ts");
const testFiles = await workspace.listFiles("**/*.test.ts", {
  recursive: true,
  includeHidden: false,
});

// File metadata
const info = await workspace.pathInfo("package.json");
console.log(info.size, info.mtime);

// File operations
await workspace.copy("src.txt", "dest.txt");
await workspace.move("old.txt", "new.txt");
await workspace.delete("temp.txt");

// Directory operations
await workspace.mkdir("nested/dirs", { recursive: true });

// Watch for changes
const unwatch = await workspace.watch("src", (event) => {
  console.log(event.type, event.path);
});
```

## Command Execution

```typescript
// Execute commands
const result = await workspace.execute("npm test");
console.log(result.stdout, result.stderr, result.exitCode);

// With options
const result = await workspace.execute("echo $MY_VAR", {
  cwd: "subdir",
  env: { MY_VAR: "value" },
  timeout: 5000,
});

// Background execution
const { pid, kill } = await workspace.executeBackground("npm run dev");

// Later...
await kill();
```

## Environment Variables

```typescript
// Get/set environment variables
await workspace.setEnv("NODE_ENV", "production");
const nodeEnv = await workspace.getEnv("NODE_ENV");

// Batch operations
await workspace.setEnvBatch({
  PORT: "3000",
  HOST: "0.0.0.0",
  DEBUG: "true",
});

const allEnv = await workspace.getEnvAll();

// Unset
await workspace.unsetEnv("TEMP_VAR");
```

## Events

```typescript
const unsubscribe = workspace.on((event) => {
  switch (event.type) {
    case "file:changed":
      console.log("File changed:", event.data);
      break;
    case "command:completed":
      console.log("Command done:", event.data);
      break;
    case "error":
      console.error("Error:", event.error);
      break;
  }
});

// Later...
unsubscribe();
```

## Workspace Factory

```typescript
import { WorkspaceFactory } from "@dantecode/workspace";

// Create with full config
const workspace = WorkspaceFactory.create({
  id: "my-workspace",
  type: "local",
  basePath: "/tmp/workspace",
  env: { NODE_ENV: "development" },
  metadata: { project: "my-project" },
});

// Auto-detect type from config
const workspace = WorkspaceFactory.createAuto({
  id: "auto-workspace",
  basePath: "/workspace",
  image: "node:18", // Will auto-detect as container
});

// Create multiple
const workspaces = WorkspaceFactory.createMultiple([
  { id: "ws1", type: "local", basePath: "/tmp/ws1" },
  { id: "ws2", type: "local", basePath: "/tmp/ws2" },
]);
```

## Integration with DanteSandbox

ContainerWorkspace automatically integrates with `@dantecode/dante-sandbox`:

```typescript
import { DanteSandbox } from "@dantecode/dante-sandbox";
import { createContainerWorkspace } from "@dantecode/workspace";

// Setup DanteSandbox
DanteSandbox.setup({ mode: "auto" });

// Container workspace will use DanteSandbox for execution
const workspace = createContainerWorkspace("ws", "/workspace", "node:18");
await workspace.initialize();

// Commands execute through sandbox with proper isolation
await workspace.execute("npm install");
```

## Design Principles

Based on OpenHands workspace architecture:

1. **Symmetry**: Same API works for local/remote/container
2. **Lazy Loading**: Resources allocated on-demand
3. **Observable**: All operations emit events
4. **Safe**: Respects sandbox boundaries and permissions
5. **Efficient**: Incremental sync, lazy evaluation
6. **Resumable**: Full snapshot/resume capabilities

## Architecture

```
Workspace (interface)
├── BaseWorkspace (abstract class)
│   ├── LocalWorkspace (fs + child_process)
│   ├── ContainerWorkspace (DanteSandbox integration)
│   └── RemoteWorkspace (SSH execution)
├── WorkspaceFactory (creation + validation)
└── WorkspaceManager (lifecycle + registry)
```

## TypeScript Support

Fully typed with TypeScript:

```typescript
import type {
  Workspace,
  WorkspaceConfig,
  WorkspaceSnapshot,
  WorkspaceStats,
  ExecResult,
} from "@dantecode/workspace";
```

## Testing

The package includes comprehensive tests with 80%+ coverage:

```bash
npm run test          # Run tests
npm run test:watch    # Watch mode
npm run typecheck     # Type checking
```

## License

MIT
