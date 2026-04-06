import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import {
  isQuestionPrompt,
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
} from "./execution-heuristics.js";
import { verifyCompletion } from "./completion-verifier.js";
import { RetryDetector } from "./retry-detector.js";
import type { RetryEntry } from "./retry-detector.js";
import { VerificationGates } from "./verification-gates.js";
import type { BuildGateConfig, TestGateConfig } from "./verification-gates.js";
import { StatusTracker } from "./status-tracker.js";
import type { Evidence, PhaseStatus } from "./status-tracker.js";

const WORKFLOW_PATTERN =
  /\/(?:magic|autoforge|party|inferno|blaze|ember|spark|forge|verify|ship|oss|harvest)\b/i;

const COMPLETION_PATTERN =
  /(?:^|\n)\s*(?:#{1,3}\s*)?(?:summary|results?|complete|done|finished|all\s+(?:done|complete)|pipeline\s+complete|git\s+status|verification\s+results?|changes?\s+made|next\s+steps?|recommendations?)/i;

const GROK_CONFAB_PATTERN =
  /\b(?:typecheck[:\s]+(?:PASS|✅)|lint[:\s]+(?:PASS|✅)|test(?:s|ing)?[:\s]+(?:PASS|✅|\d+\/\d+)|pushed?\s+to\s+origin|files?\s+changed.*\+\d+\s+lines?|PDSE\s+score|no\s+further\s+tools?\s+needed|turbo\s+(?:typecheck|lint|test)\s*[:\s]*(?:PASS|pass|\d+))/im;

const CLAIMED_FILE_PATTERNS = [
  /(?:updated|modified|edited|wrote|created|changed)\s+[`"']?([^\s`"',]+\.\w{1,6})/gi,
  /(?:Write|Edit)\s+(?:to\s+)?[`"']?([^\s`"',]+\.\w{1,6})/g,
];

const CODE_LIKE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".cs",
  ".cpp",
  ".c",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".html",
  ".json",
  ".yaml",
  ".yml",
];

export type ExecutionPolicyEventType =
  | "tool_parse_error"
  | "execution_nudge"
  | "pipeline_continuation"
  | "confab_block"
  | "retry_warning"
  | "retry_stuck"
  | "verification_failed"
  | "verification_passed"
  | "completion_blocked"
  | "completion_allowed"
  | "progress_update"
  | "abort";

export interface ExecutionPolicyEvent {
  type: ExecutionPolicyEventType;
  severity: "info" | "warning" | "error";
  displayText: string;
  followupPrompt?: string;
  metadata?: Record<string, unknown>;
}

export interface NoToolResponseContext {
  prompt: string;
  responseText: string;
  isWorkflow: boolean;
  promptRequestsExecution: boolean;
  executedToolsThisTurn: number;
  filesModified: number;
  toolCallParseErrors: string[];
  executionNudges: number;
  maxExecutionNudges: number;
  pipelineContinuationNudges: number;
  maxPipelineContinuationNudges: number;
  confabulationNudges: number;
  maxConfabulationNudges: number;
  roundNumber: number;
  maxToolRounds: number;
}

export interface ToolCallLike {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultLike {
  isError: boolean;
  content?: string;
}

export interface CompletionVerificationContext {
  projectRoot: string;
  responseText: string;
  isWorkflow: boolean;
  touchedFiles: string[];
  expectedFiles?: string[];
  phaseName?: string;
  intentDescription?: string;
  language?: string;
  testCommand?: string;
}

export interface ExecutionPolicySnapshot {
  retryHistory: RetryEntry[];
  phases: PhaseStatus[];
}

function defaultNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function splitCommand(command: string): { command: string; args: string[] } {
  const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  const [program, ...rest] = parts.map((part) => part.replace(/^"(.*)"$/, "$1"));
  return {
    command: program || command,
    args: rest,
  };
}

function classifyError(errorText: string): { kind: "retryable" | "nonretryable"; label: string } {
  const normalized = errorText.toLowerCase();
  const nonRetryablePatterns = [
    /\b(?:400|401|403|404|405|409)\b/,
    /\bblocked\b/,
    /\bdenied\b/,
    /\bpermission\b/,
    /\bnot supported\b/,
    /\bmalformed json\b/,
    /\bapproval\b/,
    /\boperator denied\b/,
  ];

  for (const pattern of nonRetryablePatterns) {
    if (pattern.test(normalized)) {
      return { kind: "nonretryable", label: normalized.slice(0, 120) || "nonretryable" };
    }
  }

  return { kind: "retryable", label: normalized.slice(0, 120) || "retryable" };
}

function isCodeLikeFile(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return CODE_LIKE_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}

function normalizeTouchedFiles(projectRoot: string, touchedFiles: string[]): string[] {
  return touchedFiles.map((filePath) => {
    const relativePath = relative(projectRoot, filePath);
    return relativePath && !relativePath.startsWith("..") ? relativePath.replace(/\\/g, "/") : filePath;
  });
}

function buildParseErrorPrompt(parseErrors: string[]): string {
  const errorSummary = parseErrors.map((entry, index) => `  Block ${index + 1}: ${entry}`).join("\n");
  return (
    `SYSTEM ERROR: ${parseErrors.length} <tool_use> block(s) contained malformed JSON and were NOT executed:\n${errorSummary}\n\n` +
    `No files were written. No commands ran. REQUIRED: Fix the JSON and re-emit the tool call(s).\n` +
    `Common fixes:\n` +
    `  - Escape double quotes inside string values: " → \\"\n` +
    `  - Escape backslashes: \\ → \\\\\n` +
    `  - Escape newlines inside string values: use \\n not a real newline\n` +
    `  - Avoid unescaped special chars in JSON string values`
  );
}

export function isWorkflowExecutionPrompt(prompt: string, skillActive = false): boolean {
  return skillActive || WORKFLOW_PATTERN.test(prompt) || promptRequestsToolExecution(prompt);
}

export function responseLooksComplete(responseText: string): boolean {
  return COMPLETION_PATTERN.test(responseText) || GROK_CONFAB_PATTERN.test(responseText);
}

export function extractClaimedFilesFromText(text: string): string[] {
  const files = new Set<string>();
  for (const pattern of CLAIMED_FILE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const filePath = match[1];
      if (filePath && filePath.length > 3 && !filePath.startsWith("http") && !filePath.startsWith("//")) {
        files.add(filePath.replace(/\\/g, "/"));
      }
    }
  }
  return [...files];
}

export class ExecutionPolicyEngine {
  private readonly retryDetector: RetryDetector;
  private readonly verificationGates: VerificationGates;
  private readonly statusTracker: StatusTracker;
  private readonly failClosedWorkflows: boolean;

  constructor(options?: { projectRoot?: string; failClosedWorkflows?: boolean }) {
    this.retryDetector = new RetryDetector();
    this.verificationGates = new VerificationGates();
    this.statusTracker = new StatusTracker(options?.projectRoot);
    this.failClosedWorkflows = options?.failClosedWorkflows ?? true;
  }

  snapshot(): ExecutionPolicySnapshot {
    return {
      retryHistory: this.retryDetector.toJSON(),
      phases: this.statusTracker.getAllPhases(),
    };
  }

  hydrate(snapshot?: Partial<ExecutionPolicySnapshot>): void {
    if (snapshot?.retryHistory) {
      this.retryDetector.hydrate(snapshot.retryHistory);
    }
    if (snapshot?.phases) {
      this.statusTracker.reset();
      for (const phase of snapshot.phases) {
        this.statusTracker.phases.set(phase.name, { ...phase });
      }
    }
  }

  getProgress() {
    return this.statusTracker.getActualProgress();
  }

  evaluateNoToolResponse(context: NoToolResponseContext): ExecutionPolicyEvent | null {
    if (context.toolCallParseErrors.length > 0) {
      return {
        type: "tool_parse_error",
        severity: "error",
        displayText: `[tool-parse-error] ${context.toolCallParseErrors.length} block(s) malformed — forcing retry`,
        followupPrompt: buildParseErrorPrompt(context.toolCallParseErrors),
        metadata: { parseErrorCount: context.toolCallParseErrors.length },
      };
    }

    if (
      context.isWorkflow &&
      context.executedToolsThisTurn === 0 &&
      !isQuestionPrompt(context.prompt) &&
      context.promptRequestsExecution &&
      responseNeedsToolExecutionNudge(context.responseText) &&
      context.executionNudges < context.maxExecutionNudges &&
      context.maxToolRounds > 0
    ) {
      return {
        type: "execution_nudge",
        severity: "warning",
        displayText: "[nudge: execute with tools] (no tool calls were emitted)",
        followupPrompt:
          "You described the intended work but did not use any tools. Stop narrating and actually execute the next step with Read, Write, Edit, Bash, Glob, Grep, GitCommit, GitPush, or TodoWrite. Only claim file changes after a successful tool result.",
      };
    }

    if (
      context.isWorkflow &&
      context.executedToolsThisTurn > 0 &&
      context.filesModified > 0 &&
      context.maxToolRounds > 0 &&
      context.pipelineContinuationNudges < context.maxPipelineContinuationNudges &&
      responseLooksComplete(context.responseText)
    ) {
      return {
        type: "pipeline_continuation",
        severity: "warning",
        displayText:
          `[pipeline continuation ${context.pipelineContinuationNudges + 1}/${context.maxPipelineContinuationNudges}] ` +
          "(model stopped mid-pipeline — nudging to continue)",
        followupPrompt:
          "You stopped mid-pipeline with a summary/status response, but the task is NOT complete. The pipeline still has remaining steps. Do NOT summarize — continue executing the next step immediately with tool calls.",
      };
    }

    const isGrokConfab = GROK_CONFAB_PATTERN.test(context.responseText);
    const isClassicConfab = responseLooksComplete(context.responseText);
    // Reads-only confab: require BOTH a confab pattern match AND enough rounds.
    // Workflow commands (/inferno, /blaze, etc.) naturally spend 5-8 rounds reading
    // before writing, so the round threshold must be high enough to avoid false positives.
    const readsOnlyRoundThreshold = context.isWorkflow ? 8 : 3;
    const isReadsOnlyConfab =
      context.executedToolsThisTurn > 0 &&
      isGrokConfab &&
      context.roundNumber >= readsOnlyRoundThreshold;
    if (
      context.isWorkflow &&
      context.filesModified === 0 &&
      context.confabulationNudges < context.maxConfabulationNudges &&
      (isClassicConfab || isReadsOnlyConfab)
    ) {
      const reason = isReadsOnlyConfab && !isClassicConfab ? "reads-only pattern" : "fake completion";
      return {
        type: "confab_block",
        severity: "error",
        displayText:
          `[confab-guard] ${reason} — 0 files modified (${context.confabulationNudges + 1}/${context.maxConfabulationNudges})`,
        followupPrompt:
          "CONFABULATION DETECTED: You have read files and/or claimed to have implemented changes, but ZERO files were actually written in this session. Do NOT write planning text, summaries, or fake verification results. Your VERY NEXT response MUST contain a Write or Edit tool call to create/modify a real file.",
      };
    }

    return null;
  }

  assessToolCall(toolCall: ToolCallLike): ExecutionPolicyEvent | null {
    const similarEntries = this.retryDetector.getSimilarEntries(toolCall);
    if (similarEntries.some((entry) => entry.error?.startsWith("nonretryable:"))) {
      return {
        type: "retry_stuck",
        severity: "error",
        displayText:
          `Retry loop detected: ${toolCall.name} hit a non-retryable failure and is being attempted again.`,
        followupPrompt:
          `SYSTEM: Retry loop detected — ${toolCall.name} previously hit a non-retryable error. Stop repeating this action and try a fundamentally different approach, or ask the user for guidance.`,
        metadata: { similarCount: similarEntries.length },
      };
    }

    const retryStatus = this.retryDetector.assess(toolCall);
    if (retryStatus === "STUCK") {
      return {
        type: "retry_stuck",
        severity: "error",
        displayText: `Retry loop detected: ${toolCall.name} failed ${similarEntries.length}+ times with similar errors. Breaking loop.`,
        followupPrompt:
          `SYSTEM: Retry loop detected — you have called ${toolCall.name} ${similarEntries.length}+ times with similar arguments/errors. This approach is not working. Stop repeating this action and try a fundamentally different approach, or ask the user for help with the underlying issue.`,
        metadata: { similarCount: similarEntries.length },
      };
    }

    if (retryStatus === "WARNING") {
      return {
        type: "retry_warning",
        severity: "warning",
        displayText: `Retry warning: ${toolCall.name} attempted ${similarEntries.length}+ times.`,
        metadata: { similarCount: similarEntries.length },
      };
    }

    return null;
  }

  recordToolResult(toolCall: ToolCallLike, result: ToolResultLike): ExecutionPolicyEvent | null {
    if (!result.isError) {
      this.retryDetector.recordSuccess(toolCall);
      return null;
    }

    const classification = classifyError(result.content ?? "");
    const status = this.retryDetector.recordFailure(
      toolCall,
      `${classification.kind}:${classification.label}`,
    );
    const similarCount = this.retryDetector.getSimilarCount(toolCall);

    if (classification.kind === "nonretryable") {
      return {
        type: "retry_stuck",
        severity: "error",
        displayText:
          `Retry blocked: ${toolCall.name} hit a non-retryable error (${classification.label}).`,
        followupPrompt:
          `SYSTEM: ${toolCall.name} hit a non-retryable error (${classification.label}). Do not repeat it unchanged. Choose a different approach or ask the user for help.`,
        metadata: { similarCount, classification: classification.kind },
      };
    }

    if (status === "STUCK") {
      return {
        type: "retry_stuck",
        severity: "error",
        displayText: `Retry loop detected: ${toolCall.name} failed ${similarCount}+ times with similar errors.`,
        followupPrompt:
          `SYSTEM: Retry loop detected — ${toolCall.name} has now failed ${similarCount}+ times with similar errors. Stop repeating this action and try a different approach.`,
        metadata: { similarCount, classification: classification.kind },
      };
    }

    if (status === "WARNING") {
      return {
        type: "retry_warning",
        severity: "warning",
        displayText: `Retry warning: ${toolCall.name} has failed ${similarCount}+ times.`,
        metadata: { similarCount, classification: classification.kind },
      };
    }

    return null;
  }

  async verifyWorkflowCompletion(
    context: CompletionVerificationContext,
  ): Promise<ExecutionPolicyEvent> {
    const normalizedTouched = normalizeTouchedFiles(context.projectRoot, context.touchedFiles);
    const claimedFiles = extractClaimedFilesFromText(context.responseText);
    const expectedFiles =
      context.expectedFiles && context.expectedFiles.length > 0
        ? context.expectedFiles
        : claimedFiles.length > 0
          ? claimedFiles
          : normalizedTouched;

    const verification = await verifyCompletion(context.projectRoot, {
      expectedFiles: expectedFiles.length > 0 ? expectedFiles : undefined,
      intentDescription: context.intentDescription ?? context.phaseName ?? "Workflow deliverables",
    });

    // Only block if we had concrete expectations to verify.
    // When nothing was written (no touched/claimed/expected files), low-confidence
    // is not a deliverable failure — it just means there's nothing to measure.
    if (verification.verdict !== "complete" && this.failClosedWorkflows && context.isWorkflow && expectedFiles.length > 0) {
      if (context.phaseName) {
        this.statusTracker.markPhaseFailed(context.phaseName, verification.summary);
      }
      return {
        type: "completion_blocked",
        severity: "error",
        displayText: `[deliverables] ${verification.summary}`,
        followupPrompt:
          `VERIFICATION FAILED: ${verification.summary}\n\n` +
          `Expected deliverables are not fully present. Fix the missing or incomplete items before claiming completion again.`,
        metadata: {
          expectedFiles,
          failed: verification.failed,
          passed: verification.passed,
        },
      };
    }

    let buildPassed = true;
    let testsPassed = true;
    const needsCodeVerification = expectedFiles.some(isCodeLikeFile);
    if (needsCodeVerification) {
      const buildConfig = this.createBuildGate(context.projectRoot, context.language);
      if (buildConfig) {
        const buildResult = await this.verificationGates.runBuildGateOnly({
          files: { requiredFiles: expectedFiles, basePath: context.projectRoot },
          build: buildConfig,
        });
        buildPassed = buildResult.passed;
        if (!buildResult.passed) {
          if (context.phaseName) {
            this.statusTracker.markPhaseFailed(context.phaseName, buildResult.errors.join("\n"));
          }
          return {
            type: "verification_failed",
            severity: "error",
            displayText: `[verification] ${buildResult.errors.join(" ")}`,
            followupPrompt:
              `VERIFICATION FAILED: ${buildResult.errors.join("\n")}\n\n` +
              `Typecheck must pass before this workflow can be marked complete.`,
            metadata: { expectedFiles, gateLevel: buildResult.level, errors: buildResult.errors },
          };
        }
      }

      if (context.testCommand) {
        const testConfig = this.createTestGate(context.projectRoot, context.testCommand);
        const testResult = await this.verificationGates.run({ tests: testConfig });
        testsPassed = testResult.passed;
        if (!testResult.passed) {
          if (context.phaseName) {
            this.statusTracker.markPhaseFailed(context.phaseName, testResult.errors.join("\n"));
          }
          return {
            type: "verification_failed",
            severity: "error",
            displayText: `[verification] ${testResult.errors.join(" ")}`,
            followupPrompt:
              `VERIFICATION FAILED: ${testResult.errors.join("\n")}\n\n` +
              `Tests must pass before this workflow can be marked complete.`,
            metadata: { expectedFiles, gateLevel: testResult.level, errors: testResult.errors },
          };
        }
      }
    }

    const evidence: Evidence = {
      filesCreated: expectedFiles,
      filesVerified: verification.fileChecks.filter((check) => check.exists && check.hasContent).map((check) => check.file),
      buildPassed,
      testsPassed,
      timestamp: Date.now(),
    };

    if (context.phaseName) {
      this.statusTracker.markPhaseComplete(context.phaseName, evidence);
    }

    const progress = context.phaseName ? this.statusTracker.getActualProgress() : undefined;
    return {
      type: "completion_allowed",
      severity: "info",
      displayText: `[deliverables] ${verification.summary}`,
      metadata: {
        expectedFiles,
        progress,
        verification,
      },
    };
  }

  private createBuildGate(projectRoot: string, language?: string): BuildGateConfig | null {
    if (
      language?.toLowerCase() === "typescript" &&
      existsSync(resolve(projectRoot, "package.json")) &&
      existsSync(resolve(projectRoot, "tsconfig.json"))
    ) {
      return {
        command: defaultNpmCommand(),
        args: ["run", "typecheck"],
        cwd: projectRoot,
      };
    }
    return null;
  }

  private createTestGate(projectRoot: string, testCommand: string): TestGateConfig {
    const parsed = splitCommand(testCommand);
    return {
      command: parsed.command,
      args: parsed.args,
      cwd: projectRoot,
    };
  }
}
