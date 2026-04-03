// ============================================================================
// @dantecode/config-types — PRD D4.1 Complete Type Definitions
// ============================================================================

// ----------------------------------------------------------------------------
// Model & Provider Types
// ----------------------------------------------------------------------------

/** Supported model provider identifiers. */
export type ModelProvider =
  | "grok"
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "ollama"
  | "custom";

/** Reasoning effort setting for models that support extended thinking. */
export type ReasoningEffort = "low" | "medium" | "high";

/** Configuration for a single model endpoint. */
export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
  contextWindow: number;
  supportsVision: boolean;
  supportsToolCalls: boolean;
  supportsExtendedThinking?: boolean;
  reasoningEffort?: ReasoningEffort;
}

/** Router configuration that selects models with fallback and per-task overrides. */
export interface ModelRouterConfig {
  default: ModelConfig;
  fallback: ModelConfig[];
  overrides: Record<string, ModelConfig>;
}

// ----------------------------------------------------------------------------
// Session & Context Types
// ----------------------------------------------------------------------------

/** A single block within multi-modal message content. */
export interface ContentBlock {
  type: "text" | "image" | "document";
  text?: string;
  imageData?: string;
  mimeType?: string;
}

/** Describes a tool invocation requested by the model. */
export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Result returned from executing a tool. */
export interface ToolResultBlock {
  toolUseId: string;
  content: string;
  isError: boolean;
}

/** A single message within a session conversation. */
export interface SessionMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  timestamp: string;
  modelId?: string;
  toolUse?: ToolUseBlock;
  toolResult?: ToolResultBlock;
  pdseScore?: PDSEScore;
  tokensUsed?: number;
}

/** Status of a to-do item within a session. */
export type TodoStatus = "pending" | "in_progress" | "completed" | "failed";

/** A single to-do item tracked within a session. */
export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  createdAt: string;
  completedAt?: string;
  parentId?: string;
}

/** Status of an agent frame within the agent stack. */
export type AgentFrameStatus = "running" | "completed" | "failed" | "cancelled";

/** A frame on the agent execution stack. */
export interface AgentFrame {
  agentId: string;
  agentType: string;
  startedAt: string;
  touchedFiles: string[];
  status: AgentFrameStatus;
  subAgentIds: string[];
}

/** A full interactive session. */
export interface Session {
  id: string;
  projectRoot: string;
  messages: SessionMessage[];
  activeFiles: string[];
  readOnlyFiles: string[];
  model: ModelConfig;
  createdAt: string;
  updatedAt: string;
  worktreeRef?: string;
  sandboxContainerId?: string;
  agentStack: AgentFrame[];
  todoList: TodoItem[];
  /** User-assigned display name for this session (set via /name command). */
  name?: string;
}

/** Durable execution status for long-running agent workflows. */
export type DurableRunStatus = "running" | "waiting_user" | "completed" | "failed" | "cancelled";

/** Why a durable run paused instead of completing. */
export type PauseReason =
  | "model_timeout"
  | "tool_timeout"
  | "verification_failed"
  | "recoverable_error"
  | "user_input_required"
  | "process_restart";

/** Confirmed execution fact captured in the durable evidence ledger. */
export interface ExecutionEvidence {
  id: string;
  kind:
    | "file_write"
    | "verification_pass"
    | "source_fetch"
    | "agent_spawn"
    | "commit"
    | "blocked_action"
    | "tool_result";
  success: boolean;
  label: string;
  timestamp: string;
  filePath?: string;
  command?: string;
  sourceUrl?: string;
  agentId?: string;
  details?: Record<string, unknown>;
}

/** User-facing resume guidance persisted with a durable run. */
export interface ResumeHint {
  runId: string;
  summary: string;
  lastConfirmedStep?: string;
  lastSuccessfulTool?: string;
  nextAction: string;
  continueCommand: string;
}

/** Persisted durable execution state for resumable workflows. */
export interface DurableRun {
  id: string;
  projectRoot: string;
  sessionId: string;
  prompt: string;
  workflow: string;
  status: DurableRunStatus;
  createdAt: string;
  updatedAt: string;
  pauseReason?: PauseReason;
  touchedFiles: string[];
  evidenceCount: number;
  lastConfirmedStep?: string;
  lastSuccessfulTool?: string;
  nextAction?: string;
  resumeHint?: ResumeHint;
  legacySource?: "autoforge_checkpoint" | "background_task";
}

// ----------------------------------------------------------------------------
// PDSE Scoring Types
// ----------------------------------------------------------------------------

/** Classification of a PDSE violation. */
export type ViolationType =
  | "stub_detected"
  | "incomplete_function"
  | "missing_error_handling"
  | "type_any"
  | "hardcoded_secret"
  | "background_process"
  | "console_log_leftover"
  | "test_skip"
  | "import_unused"
  | "dead_code";

/** A single violation detected during PDSE scoring. */
export interface PDSEViolation {
  type: ViolationType;
  severity: "hard" | "soft";
  file: string;
  line?: number;
  message: string;
  pattern?: string;
}

/** Composite PDSE quality score for a generation output. */
export interface PDSEScore {
  completeness: number;
  correctness: number;
  clarity: number;
  consistency: number;
  overall: number;
  violations: PDSEViolation[];
  passedGate: boolean;
  scoredAt: string;
  scoredBy: string;
}

/** Configuration for the PDSE quality gate. */
export interface PDSEGateConfig {
  threshold: number;
  hardViolationsAllowed: number;
  maxRegenerationAttempts: number;
  weights: {
    completeness: number;
    correctness: number;
    clarity: number;
    consistency: number;
  };
}

// ----------------------------------------------------------------------------
// DanteForge Autoforge Types
// ----------------------------------------------------------------------------

/** A single gStack command definition for the autoforge pipeline. */
export interface GStackCommand {
  name: string;
  command: string;
  runInSandbox: boolean;
  timeoutMs: number;
  failureIsSoft: boolean;
}

/** Result of executing a single gStack command. */
export interface GStackResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

/** Record of a single autoforge iteration. */
export interface AutoforgeIteration {
  iterationNumber: number;
  inputViolations: PDSEViolation[];
  gstackResults: GStackResult[];
  lessonsInjected: string[];
  outputScore: PDSEScore;
  succeeded: boolean;
  durationMs: number;
}

/** Top-level autoforge configuration. */
export interface AutoforgeConfig {
  enabled: boolean;
  maxIterations: number;
  gstackCommands: GStackCommand[];
  lessonInjectionEnabled: boolean;
  abortOnSecurityViolation: boolean;
  autoRunOnWrite: boolean; // Controls whether DanteForge runs automatically after Write/Edit
}

/** Extended autoforge config for Blade v1.2. */
export interface BladeAutoforgeConfig extends AutoforgeConfig {
  /** When true, ignore maxIterations and continue until allGStackPassed && pdse >= 90. */
  persistUntilGreen?: boolean;
  /** Absolute maximum rounds even when persistUntilGreen=true. Default 200. */
  hardCeiling?: number;
  /** Enable silent progress UX (suppress per-tool webview messages). Default false. */
  silentMode?: boolean;
}

/** Live state of a blade autoforge run, emitted as webview progress events. */
export interface BladeProgressState {
  /** Current autoforge phase number (1-based). */
  phase: number;
  /** Total phases configured in AutoforgeConfig.maxIterations. */
  totalPhases: number;
  /** Percent complete: floor((phase - 1) / totalPhases * 100). */
  percentComplete: number;
  /** Last PDSE score from runLocalPDSEScorer on the most recently written file. */
  pdseScore: number;
  /** Accumulated session cost in USD from ModelRouterImpl.getCostEstimate(). */
  estimatedCostUsd: number;
  /** Human-readable current task label (e.g., "Running GStack typecheck"). */
  currentTask: string;
  /** When true, tool logs and bash output are suppressed in the webview. */
  silentMode: boolean;
}

// ----------------------------------------------------------------------------
// Lessons System Types
// ----------------------------------------------------------------------------

/** Severity level for a recorded lesson. */
export type LessonSeverity = "info" | "warning" | "error" | "critical";

/** Classification for a recorded lesson. */
export type LessonType = "failure" | "success" | "preference";

/** Source that produced a lesson entry. */
export type LessonSource =
  | "pdse"
  | "autoforge"
  | "user"
  | "constitution"
  | "review"
  | "agent_loop"
  | "memory-detector";

/** A single learned lesson that can be injected into future prompts. */
export interface Lesson {
  id: string;
  projectRoot: string;
  pattern: string;
  correction: string;
  filePattern?: string;
  language?: string;
  framework?: string;
  occurrences: number;
  lastSeen: string;
  severity: LessonSeverity;
  type: LessonType;
  source: LessonSource;
}

/** Query parameters for retrieving relevant lessons. */
export interface LessonsQuery {
  projectRoot: string;
  filePattern?: string;
  language?: string;
  limit: number;
  minSeverity?: LessonSeverity;
  type?: LessonType;
}

// ----------------------------------------------------------------------------
// Skill & Agent Types
// ----------------------------------------------------------------------------

/** Front-matter metadata parsed from a skill markdown file. */
export interface SkillFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  mode?: string;
  hidden?: boolean;
  color?: string;
}

/** A fully resolved skill definition after adapter wrapping. */
export interface SkillDefinition {
  frontmatter: SkillFrontmatter;
  instructions: string;
  sourcePath: string;
  wrappedPath?: string;
  isWrapped: boolean;
  importSource?: string;
  adapterVersion: string;
  constitutionCheckPassed: boolean;
  antiStubScanPassed: boolean;
}

/** Blocks injected by the skill adapter during wrapping. */
export interface SkillAdapter {
  pdseGateBlock: string;
  constitutionBlock: string;
  lessonsBlock: string;
  antiStubBlock: string;
}

/** NOMA lane assignment for an agent. */
export type NomaLane = "lead" | "worker" | "reviewer" | "orchestrator";

/** Definition of an agent and its capabilities. */
export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  tools: string[];
  subagents?: string[];
  nomaLane: NomaLane;
  fileLocks?: string[];
  skillRefs?: string[];
}

// ----------------------------------------------------------------------------
// Git Engine Types
// ----------------------------------------------------------------------------

/** Specification for creating a git commit. */
export interface GitCommitSpec {
  message: string;
  body?: string;
  footer: string;
  files: string[];
  allowEmpty: boolean;
}

/** Specification for creating a git worktree. */
export interface WorktreeSpec {
  branch: string;
  baseBranch: string;
  sessionId: string;
  directory: string;
}

/** A single diff hunk for review or application. */
export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  accepted?: boolean;
}

/** A single line in a colored diff hunk for webview rendering. */
export interface DiffLine {
  /** "add" = green, "remove" = red, "context" = gray, "hunk_header" = dim */
  type: "add" | "remove" | "context" | "hunk_header";
  /** The line content (without the leading +/-/space prefix character). */
  content: string;
  /** Line number in the old file (null for added lines). */
  oldLineNo: number | null;
  /** Line number in the new file (null for removed lines). */
  newLineNo: number | null;
}

/** A complete colored diff result for one file, ready for webview rendering. */
export interface ColoredDiffHunk {
  /** Relative file path from project root. */
  filePath: string;
  /** Total lines added across all hunks. */
  linesAdded: number;
  /** Total lines removed across all hunks. */
  linesRemoved: number;
  /** Ordered array of all diff lines across all hunks. */
  lines: DiffLine[];
  /** True if diff exceeded MAX_DIFF_LINES and was truncated. */
  truncated: boolean;
  /** Total line count in the full diff (for "Show N more lines" label). */
  fullLineCount: number;
}

/** Maximum diff lines to include before truncation. */
export const MAX_DIFF_LINES = 80;

// ----------------------------------------------------------------------------
// Audit Log Types
// ----------------------------------------------------------------------------

/** All possible audit event type identifiers. */
export type AuditEventType =
  | "session_start"
  | "session_end"
  | "file_read"
  | "file_write"
  | "file_edit"
  | "bash_execute"
  | "git_commit"
  | "git_push"
  | "git_worktree_create"
  | "git_worktree_merge"
  | "pdse_gate_pass"
  | "pdse_gate_fail"
  | "autoforge_start"
  | "autoforge_iteration"
  | "autoforge_success"
  | "autoforge_abort"
  | "skill_import"
  | "skill_activate"
  | "lesson_record"
  | "lesson_inject"
  | "agent_spawn"
  | "agent_complete"
  | "noma_violation"
  | "constitution_violation"
  | "sandbox_start"
  | "sandbox_stop"
  | "self_modification_attempt"
  | "self_modification_allowed"
  | "self_modification_denied"
  | "loop_terminated"
  | "tier_escalation"
  | "cost_update"
  | "webhook_received"
  | "git_automation_run"
  | "git_automation_gate_pass"
  | "git_automation_gate_fail"
  | "verification_run"
  | "qa_suite_run"
  | "critic_debate_run"
  | "verification_rail_add";

/** A single auditable event within the system. */
export interface AuditEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  type: AuditEventType;
  payload: Record<string, unknown>;
  modelId: string;
  projectRoot: string;
}

// ----------------------------------------------------------------------------
// Sandbox Types
// ----------------------------------------------------------------------------

/** A bind mount specification for a sandbox container. */
export interface SandboxMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

/** Network mode for the sandbox container. */
export type SandboxNetworkMode = "none" | "bridge" | "host";

/** Specification for creating a sandbox container. */
export interface SandboxSpec {
  image: string;
  workdir: string;
  networkMode: SandboxNetworkMode;
  mounts: SandboxMount[];
  env: Record<string, string>;
  memoryLimitMb: number;
  cpuLimit: number;
  timeoutMs: number;
}

/** Result of executing a command inside a sandbox. */
export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// ----------------------------------------------------------------------------
// Cost Routing Types (Blade v1.2)
// ----------------------------------------------------------------------------

/** Context used to select the appropriate model tier for a request. */
export interface RoutingContext {
  /** Estimated input tokens (character count / 4 heuristic). */
  estimatedInputTokens: number;
  /** Task type influences tier selection. */
  taskType: "chat" | "autoforge" | "edit" | "read";
  /** Number of consecutive GStack failures in this session. */
  consecutiveGstackFailures: number;
  /** Number of files in scope for this operation. */
  filesInScope: number;
  /** User manually forced Tier 2 for the session. */
  forceCapable: boolean;
  /** Prompt complexity score (0–1) from analyzeComplexity(). Higher = more complex. */
  promptComplexity?: number;
  /** Model self-rated complexity (0–1), populated after first turn. Overrides lexical score if higher. */
  modelRatedComplexity?: number;
}

/** Live cost estimate for the current session. */
export interface CostEstimate {
  /** Total session cost in USD since last "New Chat". */
  sessionTotalUsd: number;
  /** Cost of the most recent request in USD. */
  lastRequestUsd: number;
  /** Current model tier in use. */
  modelTier: "fast" | "capable";
  /** Total tokens used this session. */
  tokensUsedSession: number;
}

// ----------------------------------------------------------------------------
// Self-Improvement Types
// ----------------------------------------------------------------------------

/** Explicit workflow context that grants protected self-modification access. */
export interface SelfImprovementContext {
  enabled: boolean;
  workflowId: string;
  triggerCommand: string;
  allowedRoots: string[];
  targetFiles?: string[];
  auditMetadata?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// VS Code Extension Types
// ----------------------------------------------------------------------------

/** Message format exchanged between the VS Code webview panel and extension host. */
export interface VSCodePanelMessage {
  type: string;
  payload: Record<string, unknown>;
  sessionId: string;
}

/** Cursor position within a file. */
export interface CursorPosition {
  line: number;
  character: number;
}

/** Context provided to the inline completion provider. */
export interface InlineCompletionContext {
  filePath: string;
  prefix: string;
  suffix: string;
  language: string;
  cursorPosition: CursorPosition;
}

// ----------------------------------------------------------------------------
// State Types
// ----------------------------------------------------------------------------

/** The ordered workflow stages of a DanteCode session. */
export type WorkflowStage =
  | "review"
  | "constitution"
  | "specify"
  | "clarify"
  | "plan"
  | "tasks"
  | "forge"
  | "verify"
  | "synthesize";

/** Git-related configuration within the DanteCode state. */
export interface GitConfig {
  autoCommit: boolean;
  commitPrefix: string;
  worktreeEnabled: boolean;
  worktreeBase: string;
  signCommits: boolean;
  dirtyCommitBeforeEdit: boolean; // Controls auto-commits before Write/Edit operations
}

/** Sandbox-related configuration within the DanteCode state. */
export interface SandboxConfig {
  enabled: boolean;
  defaultImage: string;
  networkMode: SandboxNetworkMode;
  memoryLimitMb: number;
  cpuLimit: number;
  timeoutMs: number;
  autoStart: boolean;
}

/** Skills-related configuration within the DanteCode state. */
export interface SkillsConfig {
  directories: string[];
  autoImport: boolean;
  constitutionEnforced: boolean;
  antiStubEnabled: boolean;
}

/** Agent-related configuration within the DanteCode state. */
export interface AgentsConfig {
  maxConcurrent: number;
  nomaEnabled: boolean;
  fileLockingEnabled: boolean;
  defaultLane: NomaLane;
}

/** Audit log configuration within the DanteCode state. */
export interface AuditConfig {
  enabled: boolean;
  logDirectory: string;
  retentionDays: number;
  includePayloads: boolean;
  sensitiveFieldMask: string[];
}

/** Lessons system configuration within the DanteCode state. */
export interface LessonsConfig {
  enabled: boolean;
  maxPerProject: number;
  autoInject: boolean;
  minSeverity: LessonSeverity;
}

/** Project-specific configuration within the DanteCode state. */
export interface ProjectConfig {
  name: string;
  language: string;
  framework?: string;
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  sourceDirectories: string[];
  excludePatterns: string[];
}

/** A summary entry of a previous session. */
export interface SessionHistoryEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  summary?: string;
}

/** Autonomy engine configuration for meta-reasoning and goal management. */
export interface AutonomyConfig {
  metaReasoningEnabled: boolean; // Controls automatic meta-reasoning
  metaReasoningInterval: number;  // Steps between meta-reasoning runs (default: 15)
}

/** Complete DanteCode state object persisted as STATE.yaml. */
export interface DanteCodeState {
  version: string;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  model: {
    default: ModelConfig;
    fallback: ModelConfig[];
    taskOverrides: Record<string, ModelConfig>;
  };
  pdse: PDSEGateConfig;
  autoforge: AutoforgeConfig;
  git: GitConfig;
  sandbox: SandboxConfig;
  skills: SkillsConfig;
  agents: AgentsConfig;
  audit: AuditConfig;
  sessionHistory: SessionHistoryEntry[];
  lessons: LessonsConfig;
  autonomy: AutonomyConfig;
  project: ProjectConfig;
  progressiveDisclosure: {
    unlocked: boolean;
  };
  thinkingDisplayMode: "spinner" | "progress-bar" | "disabled" | "compact";
}

// ----------------------------------------------------------------------------
// DanteCode STATE.yaml schema aliases
// ----------------------------------------------------------------------------

/** Model section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigModel {
  default: {
    provider: ModelProvider;
    modelId: string;
    maxTokens: number;
    temperature: number;
    contextWindow: number;
  };
  fallback?: Array<{
    provider: ModelProvider;
    modelId: string;
    maxTokens: number;
    temperature: number;
    contextWindow: number;
  }>;
  overrides?: Record<
    string,
    {
      provider: ModelProvider;
      modelId: string;
      maxTokens?: number;
      temperature?: number;
    }
  >;
}

/** PDSE section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigPDSE {
  threshold: number;
  hardViolationsAllowed: number;
  maxRegenerationAttempts: number;
  weights: {
    completeness: number;
    correctness: number;
    clarity: number;
    consistency: number;
  };
}

/** Autoforge section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigAutoforge {
  enabled: boolean;
  maxIterations: number;
  gstackCommands: Array<{
    name: string;
    command: string;
    runInSandbox: boolean;
    timeoutMs: number;
    failureIsSoft: boolean;
  }>;
  lessonInjectionEnabled: boolean;
  abortOnSecurityViolation: boolean;
}

/** Git section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigGit {
  autoCommit: boolean;
  commitPrefix: string;
  worktreeEnabled: boolean;
  worktreeBase: string;
  signCommits: boolean;
}

/** Sandbox section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigSandbox {
  enabled: boolean;
  defaultImage: string;
  networkMode: SandboxNetworkMode;
  memoryLimitMb: number;
  cpuLimit: number;
  timeoutMs: number;
  autoStart: boolean;
}

/** Skills section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigSkills {
  directories: string[];
  autoImport: boolean;
  constitutionEnforced: boolean;
  antiStubEnabled: boolean;
}

/** Agents section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigAgents {
  maxConcurrent: number;
  nomaEnabled: boolean;
  fileLockingEnabled: boolean;
  defaultLane: NomaLane;
}

/** Audit section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigAudit {
  enabled: boolean;
  logDirectory: string;
  retentionDays: number;
  includePayloads: boolean;
  sensitiveFieldMask: string[];
}

/** Lessons section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigLessons {
  enabled: boolean;
  maxPerProject: number;
  autoInject: boolean;
  minSeverity: LessonSeverity;
}

/** Project section of .dantecode/STATE.yaml. */
export interface DanteCodeConfigProject {
  name: string;
  language: string;
  framework?: string;
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  sourceDirectories: string[];
  excludePatterns: string[];
}

// ----------------------------------------------------------------------------
// MCP Protocol Types
// ----------------------------------------------------------------------------

/** Transport protocol for MCP server connections. */
export type MCPTransport = "stdio" | "sse";

/** Configuration for a single MCP server connection. */
export interface MCPServerConfig {
  /** Human-readable server name. */
  name: string;
  /** Transport protocol. */
  transport: MCPTransport;
  /** For stdio: the command to spawn. */
  command?: string;
  /** For stdio: arguments to the command. */
  args?: string[];
  /** For sse: the endpoint URL. */
  url?: string;
  /** Environment variables passed to the server process. */
  env?: Record<string, string>;
  /** Whether this server is enabled. */
  enabled: boolean;
}

/** Complete MCP configuration from .dantecode/mcp.json. */
export interface MCPConfig {
  servers: MCPServerConfig[];
}

/** A tool definition discovered from an MCP server. */
export interface MCPToolDefinition {
  /** Name of the tool as declared by the MCP server. */
  name: string;
  /** Human-readable description. */
  description: string;
  /** JSON Schema for the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** The MCP server that provides this tool. */
  serverName: string;
}

// ----------------------------------------------------------------------------
// Chat Persistence Types
// ----------------------------------------------------------------------------

/** A persisted chat session file stored in .dantecode/sessions/. */
export interface ChatSessionFile {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  messages: Array<{
    role: "user" | "assistant" | "system" | "tool";
    content: string;
    timestamp: string;
  }>;
  contextFiles: string[];
  totalTokens?: number;
  totalCostUsd?: number;
  /** Auto-generated 2-3 sentence summary of the session for quick listing. */
  summary?: string;
}

// ----------------------------------------------------------------------------
// Background Agent Types
// ----------------------------------------------------------------------------

/** Status of a background agent task. */
export type BackgroundAgentStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** Optional Docker runtime configuration for a background agent task. */
export interface DockerAgentConfig {
  image: string;
  networkMode?: "none" | "bridge" | "host";
  memoryLimitMb?: number;
  cpuLimit?: number;
  readOnlyMount?: boolean;
}

/** Configuration for cloud-dispatched agent tasks. */
export interface CloudAgentConfig {
  endpoint: string;
  apiToken: string;
  timeoutMs?: number;
  streamProgress?: boolean;
}

/** Dispatch mode for background agent tasks. */
export type DispatchMode = "local" | "docker" | "cloud";

/** Circuit-breaker state recorded on background tasks. */
export type BackgroundBreakerState = "closed" | "open" | "half-open";

/** Persisted checkpoint metadata for a background task. */
export interface BackgroundTaskCheckpoint {
  id: string;
  label: string;
  createdAt: string;
  sessionSnapshot?: Session;
  touchedFiles: string[];
  progress: string;
}

/** A background agent task that runs asynchronously. */
export interface BackgroundAgentTask {
  id: string;
  prompt: string;
  status: BackgroundAgentStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  progress: string;
  output?: string;
  touchedFiles: string[];
  error?: string;
  worktreeDir?: string;
  dockerConfig?: DockerAgentConfig;
  longRunning?: boolean;
  attemptCount?: number;
  checkpointId?: string;
  nextRetryAt?: string;
  breakerState?: BackgroundBreakerState;
  resumeFromTaskId?: string;
  checkpoints?: BackgroundTaskCheckpoint[];
  selfImprovement?: SelfImprovementContext;
}

// ----------------------------------------------------------------------------
// Code Index Types
// ----------------------------------------------------------------------------

/** A chunk of code extracted from a source file for indexing. */
export interface CodeChunk {
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  symbols: string[];
  embedding?: number[];
}

/** Configuration for the semantic code index. */
export interface CodeIndexConfig {
  /** Glob patterns to exclude from indexing. */
  excludePatterns: string[];
  /** Use provider-API embeddings when available (default: false). */
  useEmbeddings: boolean;
  /** Maximum lines per chunk (default: 200). */
  maxChunkLines: number;
}

/** Complete .dantecode/STATE.yaml schema as a TypeScript interface. */
export interface DanteCodeConfig {
  version: string;
  projectRoot: string;
  model: DanteCodeConfigModel;
  pdse: DanteCodeConfigPDSE;
  autoforge: DanteCodeConfigAutoforge;
  git: DanteCodeConfigGit;
  sandbox: DanteCodeConfigSandbox;
  skills: DanteCodeConfigSkills;
  agents: DanteCodeConfigAgents;
  audit: DanteCodeConfigAudit;
  lessons: DanteCodeConfigLessons;
  project: DanteCodeConfigProject;
}
