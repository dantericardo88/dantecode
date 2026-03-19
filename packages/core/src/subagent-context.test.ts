import { describe, it, expect, beforeEach } from "vitest";
import { SubAgentContext } from "./subagent-context.js";
import type { ContextSlice } from "./subagent-context.js";

describe("SubAgentContext", () => {
  let ctx: SubAgentContext;

  beforeEach(() => {
    ctx = new SubAgentContext();
  });

  // 1. createIsolatedContext() creates context with unique sessionId
  it("createIsolatedContext() creates context with a unique sessionId", () => {
    const a = ctx.createIsolatedContext("agent-a");
    const b = ctx.createIsolatedContext("agent-b");
    expect(a.sessionId).toBeTruthy();
    expect(b.sessionId).toBeTruthy();
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  // 2. createIsolatedContext() sets allowed tools
  it("createIsolatedContext() stores the provided allowedTools", () => {
    const tools = ["Read", "Write", "Bash"];
    const slice = ctx.createIsolatedContext("agent-a", { allowedTools: tools });
    expect(slice.allowedTools).toEqual(tools);
  });

  // 3. createIsolatedContext() defaults depth to 0
  it("createIsolatedContext() sets currentDepth to 0", () => {
    const slice = ctx.createIsolatedContext("agent-a");
    expect(slice.currentDepth).toBe(0);
  });

  // 4. createChildContext() increments depth
  it("createChildContext() increments currentDepth by 1 relative to the parent", () => {
    const parent = ctx.createIsolatedContext("agent-parent");
    const child = ctx.createChildContext(parent, "agent-child");
    expect(child.currentDepth).toBe(parent.currentDepth + 1);
  });

  // 5. createChildContext() inherits memory when inheritMemory=true
  it("createChildContext() copies parent memory entries when inheritMemory=true", () => {
    const parent = ctx.createIsolatedContext("agent-parent");
    ctx.addMemoryEntry(parent, "task", "build features", "agent");

    const child = ctx.createChildContext(parent, "agent-child", {
      inheritMemory: true,
    });

    expect(child.memoryEntries).toHaveLength(1);
    expect(child.memoryEntries[0]!.key).toBe("task");
    expect(child.memoryEntries[0]!.value).toBe("build features");
    expect(child.memoryEntries[0]!.source).toBe("parent");
  });

  // 6. createChildContext() does not inherit memory when inheritMemory=false
  it("createChildContext() starts with empty memory when inheritMemory=false", () => {
    const parent = ctx.createIsolatedContext("agent-parent");
    ctx.addMemoryEntry(parent, "task", "build features", "agent");

    const child = ctx.createChildContext(parent, "agent-child", {
      inheritMemory: false,
    });

    expect(child.memoryEntries).toHaveLength(0);
  });

  // 7. validateDepthLimit() true within limit
  it("validateDepthLimit() returns true when currentDepth <= maxDepth", () => {
    const slice = ctx.createIsolatedContext("agent-a", { maxDepth: 3 });
    // currentDepth starts at 0
    expect(ctx.validateDepthLimit(slice)).toBe(true);
  });

  // 8. validateDepthLimit() false when exceeded
  it("validateDepthLimit() returns false when currentDepth exceeds maxDepth", () => {
    const parent = ctx.createIsolatedContext("agent-a", { maxDepth: 0 });
    // Child depth will be 1, which exceeds maxDepth 0.
    const child = ctx.createChildContext(parent, "agent-child", {
      maxDepth: 0,
    });
    expect(ctx.validateDepthLimit(child)).toBe(false);
  });

  // 9. addMemoryEntry() adds entry
  it("addMemoryEntry() inserts a new entry into the context", () => {
    const slice = ctx.createIsolatedContext("agent-a");
    ctx.addMemoryEntry(slice, "status", "running", "agent");
    expect(slice.memoryEntries).toHaveLength(1);
    expect(slice.memoryEntries[0]!.key).toBe("status");
    expect(slice.memoryEntries[0]!.value).toBe("running");
    expect(slice.memoryEntries[0]!.source).toBe("agent");
  });

  // 10. addMemoryEntry() updates existing key
  it("addMemoryEntry() updates value and source when the key already exists", () => {
    const slice = ctx.createIsolatedContext("agent-a");
    ctx.addMemoryEntry(slice, "status", "running", "agent");
    ctx.addMemoryEntry(slice, "status", "done", "tool");

    expect(slice.memoryEntries).toHaveLength(1);
    expect(slice.memoryEntries[0]!.value).toBe("done");
    expect(slice.memoryEntries[0]!.source).toBe("tool");
  });

  // 11. getMemoryEntry() returns entry
  it("getMemoryEntry() returns the correct entry for a known key", () => {
    const slice = ctx.createIsolatedContext("agent-a");
    ctx.addMemoryEntry(slice, "goal", "ship the feature", "parent");

    const entry = ctx.getMemoryEntry(slice, "goal");
    expect(entry).toBeDefined();
    expect(entry!.value).toBe("ship the feature");
  });

  // 12. mergeContextResults() merges child entries to parent
  it("mergeContextResults() copies new child entries into the parent", () => {
    const parent = ctx.createIsolatedContext("agent-parent");
    const child = ctx.createChildContext(parent, "agent-child");

    ctx.addMemoryEntry(child, "result", "42", "agent");

    const result = ctx.mergeContextResults(parent, child);

    expect(result.newKeys).toContain("result");
    expect(result.conflicts).toHaveLength(0);
    expect(ctx.getMemoryEntry(parent, "result")!.value).toBe("42");
  });

  // 13. mergeContextResults() detects conflicts
  it("mergeContextResults() records a conflict when the same key has different values", () => {
    const parent = ctx.createIsolatedContext("agent-parent");
    ctx.addMemoryEntry(parent, "answer", "original", "agent");

    const child = ctx.createChildContext(parent, "agent-child", {
      inheritMemory: true,
    });
    // Override the inherited value in the child.
    ctx.addMemoryEntry(child, "answer", "overridden", "agent");

    const result = ctx.mergeContextResults(parent, child);

    expect(result.conflicts).toContain("answer");
    // Child value wins after merge.
    expect(ctx.getMemoryEntry(parent, "answer")!.value).toBe("overridden");
  });

  // 14. isToolAllowed() returns true for allowed tool
  it("isToolAllowed() returns true when the tool is in allowedTools", () => {
    const slice = ctx.createIsolatedContext("agent-a", {
      allowedTools: ["Read", "Write"],
    });
    expect(ctx.isToolAllowed(slice, "Read")).toBe(true);
    expect(ctx.isToolAllowed(slice, "Bash")).toBe(false);
  });

  // 15. filterTools() filters to allowed tools only
  it("filterTools() returns only the intersection of requested and allowed tools", () => {
    const slice = ctx.createIsolatedContext("agent-a", {
      allowedTools: ["Read", "Glob"],
    });
    const filtered = ctx.filterTools(slice, ["Read", "Write", "Glob", "Bash"]);
    expect(filtered).toEqual(["Read", "Glob"]);
  });
});
