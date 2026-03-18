// ============================================================================
// @dantecode/sandbox — Public API
// ============================================================================

// ─── Container Lifecycle ─────────────────────────────────────────────────────

export { SandboxManager } from "./container.js";
export type { ExecOptions } from "./container.js";

// ─── High-Level Executor ─────────────────────────────────────────────────────

export { SandboxExecutor, createDefaultSandboxSpec } from "./executor.js";
export type { AuditLoggerFn } from "./executor.js";

// ─── Fallback (No Docker) ────────────────────────────────────────────────────

export { LocalExecutor } from "./fallback.js";
