// ============================================================================
// @dantecode/workspace — Core Types
// ============================================================================

import { z } from "zod";

// ─── Workspace Status ─────────────────────────────────────────────────────────

export const WorkspaceStatusSchema = z.enum([
  "created",
  "ready",
  "suspended",
  "error",
  "destroyed",
]);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

// ─── Workspace Type ───────────────────────────────────────────────────────────

export const WorkspaceTypeSchema = z.enum([
  "local",
  "remote",
  "container",
  "hybrid",
]);
export type WorkspaceType = z.infer<typeof WorkspaceTypeSchema>;

// ─── File Operation Options ──────────────────────────────────────────────────

export interface ReadFileOptions {
  encoding?: BufferEncoding;
  flag?: string;
}

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  mode?: number;
  flag?: string;
}

export interface ListFilesOptions {
  recursive?: boolean;
  includeHidden?: boolean;
  maxDepth?: number;
  ignorePatterns?: string[];
}

// ─── Command Execution ────────────────────────────────────────────────────────

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: string | boolean;
  timeout?: number;
  input?: string;
  encoding?: BufferEncoding;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

// ─── Workspace Snapshot ───────────────────────────────────────────────────────

export interface WorkspaceSnapshot {
  id: string;
  workspaceId: string;
  timestamp: number;
  type: WorkspaceType;
  status: WorkspaceStatus;

  // State capture
  files: Array<{ path: string; content: string; mode?: number }>;
  env: Record<string, string>;
  cwd: string;

  // Metadata
  metadata: Record<string, unknown>;
  checksum: string;
}

// ─── Workspace Configuration ──────────────────────────────────────────────────

export interface WorkspaceConfig {
  id: string;
  type: WorkspaceType;

  // Base paths
  basePath: string;
  workDir?: string;

  // Environment
  env?: Record<string, string>;

  // Isolation settings
  isolated?: boolean;
  sandboxed?: boolean;

  // Resource limits
  maxFileSize?: number;
  maxDiskUsage?: number;
  maxMemory?: number;

  // Sync settings (for remote/hybrid)
  syncPatterns?: string[];
  excludePatterns?: string[];
  syncInterval?: number;

  // Container settings (for container type)
  image?: string;
  containerName?: string;
  volumes?: Array<{ host: string; container: string }>;

  // Remote settings (for remote type)
  host?: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;

  // Metadata
  metadata?: Record<string, unknown>;
}

// ─── Workspace Events ─────────────────────────────────────────────────────────

export const WorkspaceEventTypeSchema = z.enum([
  "created",
  "ready",
  "suspended",
  "resumed",
  "destroyed",
  "file:changed",
  "file:created",
  "file:deleted",
  "command:started",
  "command:completed",
  "env:changed",
  "sync:started",
  "sync:completed",
  "sync:failed",
  "error",
]);
export type WorkspaceEventType = z.infer<typeof WorkspaceEventTypeSchema>;

export interface WorkspaceEvent {
  type: WorkspaceEventType;
  workspaceId: string;
  timestamp: number;
  data?: unknown;
  error?: string;
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

export type FileChangeType = "created" | "modified" | "deleted";

export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
  timestamp: number;
  workspaceId: string;
}

export type FileWatchCallback = (event: FileChangeEvent) => void | Promise<void>;

// ─── Workspace Stats ──────────────────────────────────────────────────────────

export interface WorkspaceStats {
  workspaceId: string;
  type: WorkspaceType;
  status: WorkspaceStatus;

  // Resource usage
  diskUsage: number;
  fileCount: number;

  // Timing
  createdAt: number;
  lastAccessedAt: number;
  uptime: number;

  // Operations
  commandsExecuted: number;
  filesRead: number;
  filesWritten: number;

  // Sync stats (for remote/hybrid)
  syncCount?: number;
  lastSyncAt?: number;
  bytesTransferred?: number;
}

// ─── Workspace Lifecycle ──────────────────────────────────────────────────────

export interface WorkspaceLifecycleHooks {
  onCreated?: (workspaceId: string) => void | Promise<void>;
  onReady?: (workspaceId: string) => void | Promise<void>;
  onSuspended?: (workspaceId: string, snapshot: WorkspaceSnapshot) => void | Promise<void>;
  onResumed?: (workspaceId: string, snapshot: WorkspaceSnapshot) => void | Promise<void>;
  onDestroyed?: (workspaceId: string) => void | Promise<void>;
  onError?: (workspaceId: string, error: Error) => void | Promise<void>;
}

// ─── Path Resolution ──────────────────────────────────────────────────────────

export interface PathInfo {
  absolute: string;
  relative: string;
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  size?: number;
  mode?: number;
  mtime?: Date;
}
