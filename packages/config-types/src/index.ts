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
  model: ModelConfig;
  createdAt: string;
  updatedAt: string;
  worktreeRef?: string;
  sandboxContainerId?: string;
  agentStack: AgentFrame[];
  todoList: TodoItem[];
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
}

// ----------------------------------------------------------------------------
// Lessons System Types
// ----------------------------------------------------------------------------

/** Severity level for a recorded lesson. */
export type LessonSeverity = "info" | "warning" | "error" | "critical";

/** Source that produced a lesson entry. */
export type LessonSource = "pdse" | "autoforge" | "user" | "constitution" | "review";

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
  source: LessonSource;
}

/** Query parameters for retrieving relevant lessons. */
export interface LessonsQuery {
  projectRoot: string;
  filePattern?: string;
  language?: string;
  limit: number;
  minSeverity?: LessonSeverity;
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
  | "sandbox_stop";

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
  project: ProjectConfig;
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
