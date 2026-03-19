import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export const WORKFLOW_CONTRACT_VERSION = "danteforge.workflow/v1";

export type WorkflowExecutionMode = "staged" | "freeform";
export type WorkflowFailurePolicy = "hard_stop" | "continue";
export type WorkflowRollbackPolicy = "preserve_untracked" | "clean_untracked";
export type WorkflowWorktreePolicy = "preferred" | "required" | "disabled";
export type WorkflowRunStatus = "queued" | "executing" | "blocked" | "completed";

export interface WorkflowContract {
  contractVersion: string;
  stages: string[];
  executionMode: WorkflowExecutionMode;
  failurePolicy: WorkflowFailurePolicy;
  verificationRequired: boolean;
  rollbackPolicy: WorkflowRollbackPolicy;
  worktreePolicy: WorkflowWorktreePolicy;
  evidenceOnlyStreaming: boolean;
  hostRepoSelfEdit: boolean;
}

export interface WorkflowCommand {
  name: string;
  description: string;
  usage: string;
  filePath: string;
  body: string;
  contract: WorkflowContract;
}

export interface WorkflowParseResult {
  command?: WorkflowCommand;
  error?: string;
}

export interface WorkflowEvidenceEvent {
  type: "tool_started" | "tool_result" | "verification" | "git_action" | "blocked" | "stage_update";
  timestamp: string;
  detail: string;
  success?: boolean;
}

export interface WorkflowExecutionContext {
  command: WorkflowCommand;
  invocation: string;
  userArgs: string;
  status: WorkflowRunStatus;
  evidence: WorkflowEvidenceEvent[];
}

export interface WorkflowLoadOptions {
  homeDir?: string;
}

type FrontmatterValue = string | boolean | string[];

export async function loadWorkflowCommands(
  projectRoot: string,
  options: WorkflowLoadOptions = {},
): Promise<WorkflowParseResult[]> {
  const results: WorkflowParseResult[] = [];
  const directories = [join(projectRoot, "commands"), join(options.homeDir ?? homedir(), ".codex", "commands")];

  for (const directory of directories) {
    const entries = await safeReadDir(directory);
    for (const entry of entries) {
      if (!entry.endsWith(".md")) {
        continue;
      }

      const filePath = join(directory, entry);
      try {
        const raw = await readFile(filePath, "utf-8");
        results.push(parseWorkflowCommand(raw, filePath, entry));
      } catch {
        results.push({ error: `Unable to read workflow file: ${filePath}` });
      }
    }
  }

  return results;
}

export async function loadWorkflowCommand(
  projectRoot: string,
  commandName: string,
  options: WorkflowLoadOptions = {},
): Promise<WorkflowParseResult> {
  const normalizedName = commandName.trim().toLowerCase();
  const results = await loadWorkflowCommands(projectRoot, options);

  for (const result of results) {
    if (result.command?.name === normalizedName) {
      return result;
    }
  }

  return { error: `Workflow command /${normalizedName} was not found in repo commands/ or ~/.codex/commands.` };
}

export function parseWorkflowCommand(
  raw: string,
  filePath: string,
  fileName = filePath,
): WorkflowParseResult {
  const { frontmatter, body } = extractFrontmatter(raw);
  const fallbackName = fileName.replace(/\.md$/i, "").toLowerCase();
  const name = String(frontmatter["name"] ?? fallbackName).trim().toLowerCase();
  const description = String(frontmatter["description"] ?? `Workflow command /${name}`).trim();
  const usage = String(frontmatter["usage"] ?? `/${name}`).trim();
  const contractResult = parseWorkflowContract(frontmatter, name);

  if ("error" in contractResult) {
    return {
      error: `Workflow /${name} is invalid: ${contractResult.error}`,
    };
  }

  return {
    command: {
      name,
      description,
      usage,
      filePath,
      body: body.trim(),
      contract: contractResult.contract,
    },
  };
}

export function createWorkflowExecutionContext(
  command: WorkflowCommand,
  invocation: string,
): WorkflowExecutionContext {
  const args = invocation.trim().replace(new RegExp(`^/${command.name}\\b`, "i"), "").trim();
  return {
    command,
    invocation,
    userArgs: args,
    status: "queued",
    evidence: [],
  };
}

export function buildWorkflowInvocationPrompt(context: WorkflowExecutionContext): string {
  const { command, userArgs } = context;
  const stages = command.contract.stages.join(" -> ");
  const lines = [
    `Workflow contract activated: /${command.name}`,
    `User goal: ${userArgs || "(no explicit goal provided)"}`,
    "",
    "Contract metadata:",
    `- contract_version: ${command.contract.contractVersion}`,
    `- stages: ${stages}`,
    `- execution_mode: ${command.contract.executionMode}`,
    `- failure_policy: ${command.contract.failurePolicy}`,
    `- verification_required: ${command.contract.verificationRequired}`,
    `- rollback_policy: ${command.contract.rollbackPolicy}`,
    `- worktree_policy: ${command.contract.worktreePolicy}`,
    `- evidence_only_streaming: ${command.contract.evidenceOnlyStreaming}`,
    `- host_repo_self_edit: ${command.contract.hostRepoSelfEdit}`,
    "",
    "Workflow instructions:",
    command.body || "No additional instructions provided.",
    "",
    "Runtime rules:",
    "- Do not treat this as a freeform chat request.",
    "- Execute stages in order and stop immediately on blocked or failed tool steps.",
    "- Do not claim completion, verification, or deployment unless supported by real tool evidence.",
    "- Preserve unrelated untracked files in the main checkout.",
  ];

  return lines.join("\n");
}

export function summarizeWorkflowBlocked(
  context: WorkflowExecutionContext,
  reason: string,
): string {
  return `Workflow /${context.command.name} blocked: ${reason}`;
}

export function summarizeWorkflowCompleted(
  context: WorkflowExecutionContext,
  detail: string,
): string {
  return `Workflow /${context.command.name} completed: ${detail}`;
}

function extractFrontmatter(raw: string): {
  frontmatter: Record<string, FrontmatterValue>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match?.[1]) {
    return {
      frontmatter: {},
      body: raw,
    };
  }

  return {
    frontmatter: parseFrontmatterBlock(match[1]),
    body: match[2] ?? "",
  };
}

function parseFrontmatterBlock(block: string): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = {};
  const lines = block.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trimEnd() ?? "";
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match?.[1]) {
      continue;
    }

    const key = match[1];
    const inlineValue = (match[2] ?? "").trim();
    if (!inlineValue) {
      const listValues: string[] = [];
      while (index + 1 < lines.length) {
        const next = lines[index + 1] ?? "";
        const listMatch = next.match(/^\s*-\s+(.*)$/);
        if (!listMatch?.[1]) {
          break;
        }
        listValues.push(stripQuotes(listMatch[1].trim()));
        index += 1;
      }
      if (listValues.length > 0) {
        result[key] = listValues;
      }
      continue;
    }

    result[key] = parseScalar(inlineValue);
  }

  return result;
}

function parseWorkflowContract(
  frontmatter: Record<string, FrontmatterValue>,
  commandName: string,
): { contract: WorkflowContract } | { error: string } {
  const contractVersion = asString(frontmatter["contract_version"]);
  const stages = asStringArray(frontmatter["stages"]);
  const executionMode = asString(frontmatter["execution_mode"]);
  const failurePolicy = asString(frontmatter["failure_policy"]);
  const verificationRequired = asBoolean(frontmatter["verification_required"]);
  const rollbackPolicy = asString(frontmatter["rollback_policy"]);
  const worktreePolicy = asString(frontmatter["worktree_policy"]);
  const evidenceOnlyStreaming = asBoolean(frontmatter["evidence_only_streaming"]);
  const hostRepoSelfEdit = asBoolean(frontmatter["host_repo_self_edit"]);

  if (!contractVersion) {
    return { error: "missing contract_version" };
  }
  if (contractVersion !== WORKFLOW_CONTRACT_VERSION) {
    return {
      error: `unsupported contract_version "${contractVersion}" for /${commandName}; expected ${WORKFLOW_CONTRACT_VERSION}`,
    };
  }
  if (stages.length === 0) {
    return { error: "missing stages" };
  }
  if (!isExecutionMode(executionMode)) {
    return { error: `invalid execution_mode "${executionMode}"` };
  }
  if (!isFailurePolicy(failurePolicy)) {
    return { error: `invalid failure_policy "${failurePolicy}"` };
  }
  if (verificationRequired === null) {
    return { error: "verification_required must be true or false" };
  }
  if (!isRollbackPolicy(rollbackPolicy)) {
    return { error: `invalid rollback_policy "${rollbackPolicy}"` };
  }
  if (!isWorktreePolicy(worktreePolicy)) {
    return { error: `invalid worktree_policy "${worktreePolicy}"` };
  }
  if (evidenceOnlyStreaming === null) {
    return { error: "evidence_only_streaming must be true or false" };
  }
  if (hostRepoSelfEdit === null) {
    return { error: "host_repo_self_edit must be true or false" };
  }

  return {
    contract: {
      contractVersion,
      stages,
      executionMode,
      failurePolicy,
      verificationRequired,
      rollbackPolicy,
      worktreePolicy,
      evidenceOnlyStreaming,
      hostRepoSelfEdit,
    },
  };
}

function parseScalar(value: string): string | boolean {
  if (/^(true|false)$/i.test(value)) {
    return value.toLowerCase() === "true";
  }

  return stripQuotes(value);
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function asString(value: FrontmatterValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: FrontmatterValue | undefined): string[] {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

function asBoolean(value: FrontmatterValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function isExecutionMode(value: string): value is WorkflowExecutionMode {
  return value === "staged" || value === "freeform";
}

function isFailurePolicy(value: string): value is WorkflowFailurePolicy {
  return value === "hard_stop" || value === "continue";
}

function isRollbackPolicy(value: string): value is WorkflowRollbackPolicy {
  return value === "preserve_untracked" || value === "clean_untracked";
}

function isWorktreePolicy(value: string): value is WorkflowWorktreePolicy {
  return value === "preferred" || value === "required" || value === "disabled";
}

async function safeReadDir(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
