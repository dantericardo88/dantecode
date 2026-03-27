// ============================================================================
// @dantecode/core — STATE.yaml Parser & Writer
// ============================================================================

import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { DanteCodeState, GStackCommand } from "@dantecode/config-types";
import { detectProjectStack, getGStackDefaults } from "./project-detector.js";

/**
 * Relative path within a project to the STATE.yaml file.
 */
const STATE_YAML_RELATIVE_PATH = ".dantecode/STATE.yaml";

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const ModelConfigSchema = z.object({
  provider: z.enum(["grok", "anthropic", "openai", "google", "groq", "ollama", "custom"]),
  modelId: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  maxTokens: z.number().int().positive(),
  temperature: z.number().min(0).max(2),
  contextWindow: z.number().int().positive(),
  supportsVision: z.boolean(),
  supportsToolCalls: z.boolean(),
  supportsExtendedThinking: z.boolean().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
});

const PDSEGateConfigSchema = z.object({
  threshold: z.number().min(0).max(100),
  hardViolationsAllowed: z.number().int().min(0),
  maxRegenerationAttempts: z.number().int().min(1),
  weights: z.object({
    completeness: z.number(),
    correctness: z.number(),
    clarity: z.number(),
    consistency: z.number(),
  }),
});

const GStackCommandSchema = z.object({
  name: z.string(),
  command: z.string(),
  runInSandbox: z.boolean(),
  timeoutMs: z.number().int().positive(),
  failureIsSoft: z.boolean(),
});

const AutoforgeConfigSchema = z.object({
  enabled: z.boolean(),
  maxIterations: z.number().int().min(1),
  gstackCommands: z.array(GStackCommandSchema),
  lessonInjectionEnabled: z.boolean(),
  abortOnSecurityViolation: z.boolean(),
});

const GitConfigSchema = z.object({
  autoCommit: z.boolean(),
  commitPrefix: z.string(),
  worktreeEnabled: z.boolean(),
  worktreeBase: z.string(),
  signCommits: z.boolean(),
});

const SandboxConfigSchema = z.object({
  enabled: z.boolean(),
  defaultImage: z.string(),
  networkMode: z.enum(["none", "bridge", "host"]),
  memoryLimitMb: z.number().int().positive(),
  cpuLimit: z.number().positive(),
  timeoutMs: z.number().int().positive(),
  autoStart: z.boolean(),
});

const SkillsConfigSchema = z.object({
  directories: z.array(z.string()),
  autoImport: z.boolean(),
  constitutionEnforced: z.boolean(),
  antiStubEnabled: z.boolean(),
});

const AgentsConfigSchema = z.object({
  maxConcurrent: z.number().int().min(1),
  nomaEnabled: z.boolean(),
  fileLockingEnabled: z.boolean(),
  defaultLane: z.enum(["lead", "worker", "reviewer", "orchestrator"]),
});

const AuditConfigSchema = z.object({
  enabled: z.boolean(),
  logDirectory: z.string(),
  retentionDays: z.number().int().positive(),
  includePayloads: z.boolean(),
  sensitiveFieldMask: z.array(z.string()),
});

const LessonsConfigSchema = z.object({
  enabled: z.boolean(),
  maxPerProject: z.number().int().positive(),
  autoInject: z.boolean(),
  minSeverity: z.enum(["info", "warning", "error", "critical"]),
});

const ProjectConfigSchema = z.object({
  name: z.string(),
  language: z.string(),
  framework: z.string().optional(),
  testCommand: z.string().optional(),
  buildCommand: z.string().optional(),
  lintCommand: z.string().optional(),
  sourceDirectories: z.array(z.string()),
  excludePatterns: z.array(z.string()),
});

const SessionHistoryEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number().int().min(0),
  summary: z.string().optional(),
});

/**
 * Full Zod schema for the DanteCodeState object persisted as STATE.yaml.
 */
export const DanteCodeStateSchema = z.object({
  version: z.string(),
  projectRoot: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  model: z.object({
    default: ModelConfigSchema,
    fallback: z.array(ModelConfigSchema),
    taskOverrides: z.record(z.string(), ModelConfigSchema),
  }),
  pdse: PDSEGateConfigSchema,
  autoforge: AutoforgeConfigSchema,
  git: GitConfigSchema,
  sandbox: SandboxConfigSchema,
  skills: SkillsConfigSchema,
  agents: AgentsConfigSchema,
  audit: AuditConfigSchema,
  sessionHistory: z.array(SessionHistoryEntrySchema),
  lessons: LessonsConfigSchema,
  project: ProjectConfigSchema,
});

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Reads and parses the STATE.yaml file from the project root.
 *
 * Parses the YAML content using the `yaml` package and validates it
 * against the Zod schema. Returns a fully typed `DanteCodeState` object.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns The parsed and validated DanteCodeState.
 * @throws If the file does not exist, cannot be parsed, or fails validation.
 */
export async function readStateYaml(projectRoot: string): Promise<DanteCodeState> {
  const filePath = join(projectRoot, STATE_YAML_RELATIVE_PATH);

  const content = await readFile(filePath, "utf-8");
  const raw: unknown = YAML.parse(content);
  const result = DanteCodeStateSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid STATE.yaml at ${filePath}:\n${issues}`);
  }

  return result.data as DanteCodeState;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Atomically writes the STATE.yaml file to the project root.
 *
 * Performs an atomic write by first writing to a `.tmp` file, then renaming
 * it over the target path. This prevents corruption from partial writes
 * during a crash or power loss.
 *
 * The `updatedAt` timestamp is automatically set to the current time.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param state - The DanteCodeState object to serialize and write.
 */
export async function writeStateYaml(projectRoot: string, state: DanteCodeState): Promise<void> {
  const filePath = join(projectRoot, STATE_YAML_RELATIVE_PATH);
  const tmpPath = filePath + ".tmp";

  // Ensure the directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Update the timestamp
  const updatedState: DanteCodeState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  // Validate before writing
  const result = DanteCodeStateSchema.safeParse(updatedState);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Cannot write invalid STATE.yaml:\n${issues}`);
  }

  const yamlContent = YAML.stringify(updatedState, {
    indent: 2,
    lineWidth: 120,
  });

  // Atomic write: write to tmp, then rename
  await writeFile(tmpPath, yamlContent, "utf-8");
  await rename(tmpPath, filePath);
}

// ─── Initialize ───────────────────────────────────────────────────────────────

/**
 * Options for customizing the initial STATE.yaml when calling `initializeState`.
 * All fields are optional; when omitted, sensible defaults are used.
 * If no `language` override is given, the project root is auto-scanned with
 * `detectProjectStack()` and language-aware GStack defaults are applied.
 */
export interface InitializeStateOptions {
  provider?: "grok" | "anthropic" | "openai" | "google" | "groq" | "ollama" | "custom";
  modelId?: string;
  contextWindow?: number;
  maxTokens?: number;
  temperature?: number;
  supportsVision?: boolean;
  supportsToolCalls?: boolean;
  language?: string;
  gstackOverrides?: GStackCommand[];
}

/**
 * Creates a default STATE.yaml for a new project.
 *
 * Uses sensible defaults for all configuration sections. When called without
 * options, the default model is Grok (grok-3) and GStack commands default to
 * TypeScript tooling.
 *
 * When `options` are provided, the model provider, language, and GStack
 * commands can be customized. If no language is specified in options, the
 * project root is scanned with `detectProjectStack()` to auto-detect the
 * language and select appropriate GStack commands.
 *
 * If the `.dantecode/` directory does not exist, it is created automatically.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param options - Optional initialization overrides.
 * @returns The initialized DanteCodeState object.
 */
export async function initializeState(
  projectRoot: string,
  options?: InitializeStateOptions,
): Promise<DanteCodeState> {
  const now = new Date().toISOString();

  // Resolve model provider settings from options or defaults
  const provider = options?.provider ?? "grok";
  const modelId = options?.modelId ?? "grok-3";
  const contextWindow = options?.contextWindow ?? 131072;
  const maxTokens = options?.maxTokens ?? 8192;
  const temperature = options?.temperature ?? 0.1;
  const supportsVision = options?.supportsVision ?? false;
  const supportsToolCalls = options?.supportsToolCalls ?? true;

  // Resolve language and GStack commands
  let language = options?.language ?? "";
  let gstackCommands: GStackCommand[];

  if (options?.gstackOverrides) {
    gstackCommands = options.gstackOverrides;
  } else {
    // Auto-detect project stack when no explicit GStack overrides given
    const detectedStack = detectProjectStack(projectRoot);
    if (!language && detectedStack.language !== "unknown") {
      language = detectedStack.language;
    }
    gstackCommands = getGStackDefaults(detectedStack);
  }

  const defaultState: DanteCodeState = {
    version: "1.0.0",
    projectRoot,
    createdAt: now,
    updatedAt: now,
    model: {
      default: {
        provider,
        modelId,
        maxTokens,
        temperature,
        contextWindow,
        supportsVision,
        supportsToolCalls,
      },
      fallback: [
        {
          provider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
          maxTokens: 8192,
          temperature: 0.1,
          contextWindow: 200000,
          supportsVision: true,
          supportsToolCalls: true,
        },
      ],
      taskOverrides: {},
    },
    pdse: {
      threshold: 85,
      hardViolationsAllowed: 0,
      maxRegenerationAttempts: 3,
      weights: {
        completeness: 0.3,
        correctness: 0.3,
        clarity: 0.2,
        consistency: 0.2,
      },
    },
    autoforge: {
      enabled: true,
      maxIterations: 5,
      gstackCommands,
      lessonInjectionEnabled: true,
      abortOnSecurityViolation: true,
    },
    git: {
      autoCommit: true,
      commitPrefix: "dantecode:",
      worktreeEnabled: true,
      worktreeBase: ".dantecode/worktrees",
      signCommits: false,
    },
    sandbox: {
      enabled: true,
      defaultImage: "ghcr.io/dantecode/sandbox:latest",
      networkMode: "bridge",
      memoryLimitMb: 2048,
      cpuLimit: 2.0,
      timeoutMs: 300000,
      autoStart: true,
    },
    skills: {
      directories: [".dantecode/skills", "~/.dantecode/skills"],
      autoImport: false,
      constitutionEnforced: true,
      antiStubEnabled: true,
    },
    agents: {
      maxConcurrent: 4,
      nomaEnabled: true,
      fileLockingEnabled: true,
      defaultLane: "lead",
    },
    audit: {
      enabled: true,
      logDirectory: ".dantecode",
      retentionDays: 90,
      includePayloads: true,
      sensitiveFieldMask: ["apiKey", "token", "secret", "password"],
    },
    sessionHistory: [],
    lessons: {
      enabled: true,
      maxPerProject: 500,
      autoInject: true,
      minSeverity: "warning",
    },
    project: {
      name: "",
      language,
      sourceDirectories: ["src"],
      excludePatterns: [
        "node_modules/",
        "dist/",
        ".next/",
        "__pycache__/",
        ".dantecode/worktrees/",
      ],
    },
    progressiveDisclosure: {
      unlocked: false,
    },
    thinkingDisplayMode: "spinner",
  };

  await writeStateYaml(projectRoot, defaultState);
  return defaultState;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Checks whether a STATE.yaml file exists at the project root.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns True if the STATE.yaml file exists and is readable.
 */
export async function stateYamlExists(projectRoot: string): Promise<boolean> {
  const filePath = join(projectRoot, STATE_YAML_RELATIVE_PATH);
  try {
    await readFile(filePath, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the STATE.yaml if it exists, or initializes a new one if it does not.
 *
 * This is a convenience function that combines `stateYamlExists`,
 * `readStateYaml`, and `initializeState` into a single call.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @returns The existing or newly created DanteCodeState.
 */
export async function readOrInitializeState(projectRoot: string): Promise<DanteCodeState> {
  const exists = await stateYamlExists(projectRoot);
  if (exists) {
    return readStateYaml(projectRoot);
  }
  return initializeState(projectRoot);
}

/**
 * Updates specific fields in the STATE.yaml without overwriting the entire file.
 *
 * Reads the current state, merges the provided partial update via shallow
 * spread at the top level, and writes the result atomically.
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param update - A partial DanteCodeState with the fields to update.
 * @returns The updated DanteCodeState.
 */
export async function updateStateYaml(
  projectRoot: string,
  update: Partial<DanteCodeState>,
): Promise<DanteCodeState> {
  const current = await readStateYaml(projectRoot);

  const merged: DanteCodeState = {
    ...current,
    ...update,
    // Preserve immutable identity fields
    version: current.version,
    projectRoot: current.projectRoot,
    createdAt: current.createdAt,
  };

  await writeStateYaml(projectRoot, merged);
  return merged;
}
