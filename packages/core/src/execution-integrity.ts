import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

// ============================================================================
// @dantecode/core — Execution Integrity System
// Prevents LLM overclaiming by enforcing tool-backed evidence for all claims.
// Implements Kilo Code's "soul" - runtime verification of completion.
// ============================================================================

/**
 * Execution Integrity - Core Types
 * These enforce that "done" can only be derived from observed tool results, not assistant text.
 */

// Tool classification for integrity enforcement
export enum ToolClass {
  READ_ONLY = "read_only", // read, search, analyze
  MUTATING = "mutating", // edit, write, apply_patch
  VALIDATING = "validating", // test, lint, typecheck
  COORDINATING = "coordinating", // delegate, plan, orchestrate
}

// Tool execution record - captures what actually happened
export interface ToolExecutionRecord {
  toolName: string;
  toolClass: ToolClass;
  calledAt: string;
  arguments: Record<string, unknown>;
  result: {
    success: boolean;
    error?: string;
    metadata?: Record<string, unknown>;
  };
  executionDuration: number;
}

// Mutation record - proof that a file actually changed
export interface MutationRecord {
  toolName: string;
  filePath: string;
  beforeHash: string | null;
  afterHash: string;
  beforeHashUnavailable?: boolean;
  additions: number;
  deletions: number;
  diffSummary: string;
  appliedAt: string;
  diagnosticsSnapshot?: {
    syntaxErrors: number;
    typeErrors: number;
    lintErrors: number;
    testFailures: number;
  };
}

// Validation record - proof that claimed checks actually ran
export interface ValidationRecord {
  validationType: "syntax" | "typecheck" | "lint" | "test" | "custom";
  toolName: string;
  target: string; // file path, test suite, etc.
  passed: boolean;
  errorCount: number;
  warningCount: number;
  executedAt: string;
  output?: string;
}

// Execution ledger - the runtime source of truth
export interface ExecutionLedger {
  sessionId: string;
  messageId: string;
  mode: "ask" | "plan" | "code" | "debug" | "review" | "orchestrator";
  toolCalls: ToolExecutionRecord[];
  mutations: MutationRecord[];
  validations: ValidationRecord[];
  claimedArtifacts: string[]; // what the assistant claimed to do
  readFiles: string[]; // files read in this session
  fileLocks: Record<string, { lockedAt: string; lockId: string }>;
  completionStatus: {
    canComplete: boolean;
    reasonCode?: CompletionFailureReason;
    missingEvidence: string[];
    summary: string;
  };
}

// Completion gate result - determines if task can end as "done"
export interface CompletionGateResult {
  sessionId: string;
  requestType: "explanation" | "code_change" | "analysis" | "mixed";
  gatePassed: boolean;
  reasonCode?: CompletionFailureReason;
  confidence: number; // 0-100
  evidenceSummary: CompletionEvidenceSummary;
  missingEvidence: string[];
  recommendedActions: string[];
  evaluatedAt: string;
}

interface CompletionEvidenceSummary {
  mutationsFound: number;
  validationsRun: number;
  filesChanged: number;
  claimedChanges: number;
  mutatingToolCalls: number;
  nonObservableMutationCalls: number;
  validationRequested: boolean;
}

// Why completion was blocked
export enum CompletionFailureReason {
  NARRATIVE_WITHOUT_MUTATION = "narrative_without_mutation",
  MISSING_TOOL_EVIDENCE = "missing_tool_evidence",
  MUTATION_REQUESTED_BUT_NO_FILES_CHANGED = "mutation_requested_but_no_files_changed",
  CLAIMED_VALIDATION_NOT_RUN = "claimed_validation_not_run",
  STALE_READ = "stale_read",
  TOOL_CALL_PARSE_FAILURE = "tool_call_parse_failure",
  NO_OBSERVABLE_MUTATION = "no_observable_mutation",
  MODE_PERMISSION_VIOLATION = "mode_permission_violation",
  CONSTITUTION_VIOLATION = "constitution_violation",
}

/**
 * Execution Integrity Manager - Core enforcement engine
 */
export class ExecutionIntegrityManager {
  private ledgers = new Map<string, ExecutionLedger>();
  private fileState = new Map<string, { contentHash: string | "mtime_only"; mtime: number; readInSession: boolean }>();

  private extractToolFilePath(toolRecord: ToolExecutionRecord): string | undefined {
    const metadata = toolRecord.result.metadata;
    const args = toolRecord.arguments;
    const rawPath =
      metadata?.["filePath"] ??
      metadata?.["file_path"] ??
      args["filePath"] ??
      args["file_path"] ??
      args["path"];

    return typeof rawPath === "string" && rawPath.length > 0 ? rawPath : undefined;
  }

  private markFileRead(ledger: ExecutionLedger, filePath: string, mtimeMs?: number): void {
    if (!ledger.readFiles.includes(filePath)) {
      ledger.readFiles.push(filePath);
    }
    this.updateFileReadState(filePath, true, mtimeMs);
  }

  /**
   * Get all ledgers for a session (sorted by message sequence)
   */
  public getSessionLedgers(sessionId: string): ExecutionLedger[] {
    const prefix = `${sessionId}:`;
    return Array.from(this.ledgers.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, ledger]) => ledger)
      .sort((a, b) => a.messageId.localeCompare(b.messageId));
  }

  private buildSessionLedgerSnapshot(
    sessionId: string,
    messageId: string,
  ): { aggregate: ExecutionLedger; target: ExecutionLedger } | undefined {
    const ledgers = this.getSessionLedgers(sessionId);
    if (ledgers.length === 0) {
      return undefined;
    }

    const target =
      ledgers.find((ledger) => ledger.messageId === messageId) ?? ledgers[ledgers.length - 1]!;

    return {
      target,
      aggregate: {
        ...target,
        toolCalls: ledgers.flatMap((ledger) => ledger.toolCalls),
        mutations: ledgers.flatMap((ledger) => ledger.mutations),
        validations: ledgers.flatMap((ledger) => ledger.validations),
        claimedArtifacts: [...new Set(ledgers.flatMap((ledger) => ledger.claimedArtifacts))],
        readFiles: [...new Set(ledgers.flatMap((ledger) => ledger.readFiles))],
        fileLocks: Object.assign({}, ...ledgers.map((ledger) => ledger.fileLocks)),
      },
    };
  }

  /**
   * Start tracking a new session/message
   */
  startSession(
    sessionId: string,
    messageId: string,
    mode: ExecutionLedger["mode"],
  ): ExecutionLedger {
    const ledger: ExecutionLedger = {
      sessionId,
      messageId,
      mode,
      toolCalls: [],
      mutations: [],
      validations: [],
      claimedArtifacts: [],
      readFiles: [],
      fileLocks: {},
      completionStatus: {
        canComplete: true,
        missingEvidence: [],
        summary: "Session started",
      },
    };

    this.ledgers.set(`${sessionId}:${messageId}`, ledger);
    return ledger;
  }



  /**
   * Record a tool call attempt
   */
  recordToolCall(sessionId: string, messageId: string, toolRecord: ToolExecutionRecord): void {
    const key = `${sessionId}:${messageId}`;
    const ledger = this.ledgers.get(key);
    if (!ledger) return;

    ledger.toolCalls.push(toolRecord);

    // Update file state for read operations
    if (toolRecord.toolClass === ToolClass.READ_ONLY) {
      const filePath = this.extractToolFilePath(toolRecord);
      if (filePath) {
        const mtimeMs = toolRecord.result.metadata?.mtimeMs as number | undefined;
        this.markFileRead(ledger, filePath, mtimeMs);
      }
    }

    // Record mutations if tool succeeded
    if (toolRecord.result.success && toolRecord.toolClass === ToolClass.MUTATING) {
      this.recordMutation(sessionId, messageId, toolRecord);
    }

    // Record validations
    if (toolRecord.toolClass === ToolClass.VALIDATING) {
      this.recordValidation(sessionId, messageId, toolRecord);
    }
  }

  /**
   * Record a file mutation with proof
   */
  private recordMutation(
    sessionId: string,
    messageId: string,
    toolRecord: ToolExecutionRecord,
  ): void {
    const key = `${sessionId}:${messageId}`;
    const ledger = this.ledgers.get(key);
    if (!ledger) return;

    // Extract mutation proof from tool result metadata
    const metadata = toolRecord.result.metadata;
    const filePath = this.extractToolFilePath(toolRecord);
    if (!filePath) return;

    if (metadata?.["observableMutation"] === false) {
      return;
    }

    const rawBeforeHash = metadata?.["beforeHash"];
    const beforeHash =
      typeof rawBeforeHash === "string" ? rawBeforeHash :
      rawBeforeHash === null ? null : null;
    const beforeHashUnavailable = beforeHash === null;

    const mutation: MutationRecord = {
      toolName: toolRecord.toolName,
      filePath,
      beforeHash,
      afterHash: typeof metadata?.["afterHash"] === "string" ? metadata["afterHash"] : "",
      beforeHashUnavailable,
      additions: typeof metadata?.["additions"] === "number" ? metadata["additions"] : 0,
      deletions: typeof metadata?.["deletions"] === "number" ? metadata["deletions"] : 0,
      diffSummary: typeof metadata?.["diffSummary"] === "string" ? metadata["diffSummary"] : "",
      appliedAt: toolRecord.calledAt,
      diagnosticsSnapshot:
        typeof metadata?.["diagnostics"] === "object" && metadata["diagnostics"] !== null
        ? {
            syntaxErrors:
              typeof (metadata["diagnostics"] as Record<string, unknown>)["syntaxErrors"] ===
              "number"
                ? ((metadata["diagnostics"] as Record<string, unknown>)["syntaxErrors"] as number)
                : 0,
            typeErrors:
              typeof (metadata["diagnostics"] as Record<string, unknown>)["typeErrors"] ===
              "number"
                ? ((metadata["diagnostics"] as Record<string, unknown>)["typeErrors"] as number)
                : 0,
            lintErrors:
              typeof (metadata["diagnostics"] as Record<string, unknown>)["lintErrors"] ===
              "number"
                ? ((metadata["diagnostics"] as Record<string, unknown>)["lintErrors"] as number)
                : 0,
            testFailures:
              typeof (metadata["diagnostics"] as Record<string, unknown>)["testFailures"] ===
              "number"
                ? ((metadata["diagnostics"] as Record<string, unknown>)["testFailures"] as number)
                : 0,
          }
        : undefined,
    };

    ledger.mutations.push(mutation);

    // Update file state
    this.updateFileReadState(filePath, false);
  }

  /**
   * Record a validation execution
   */
  private recordValidation(
    sessionId: string,
    messageId: string,
    toolRecord: ToolExecutionRecord,
  ): void {
    const key = `${sessionId}:${messageId}`;
    const ledger = this.ledgers.get(key);
    if (!ledger) return;

    const metadata = toolRecord.result.metadata;
    const filePath = this.extractToolFilePath(toolRecord);
    const validation: ValidationRecord = {
      validationType: this.inferValidationType(toolRecord.toolName),
      toolName: toolRecord.toolName,
      target:
        (typeof metadata?.["target"] === "string" ? metadata["target"] : undefined) ||
        filePath ||
        "unknown",
      passed: toolRecord.result.success,
      errorCount:
        typeof metadata?.["errorCount"] === "number"
          ? metadata["errorCount"]
          : toolRecord.result.success
            ? 0
            : 1,
      warningCount: typeof metadata?.["warningCount"] === "number" ? metadata["warningCount"] : 0,
      executedAt: toolRecord.calledAt,
      output: typeof metadata?.["output"] === "string" ? metadata["output"] : undefined,
    };

    ledger.validations.push(validation);
  }

  /**
   * Update file read state for stale-read protection
   */
  private updateFileReadState(
    filePath: string,
    markAsRead: boolean,
    mtimeMs?: number,
    contentHash?: string,
  ): void {
    if (!filePath) return;

    const current = this.fileState.get(filePath) || { contentHash: "", mtime: 0, readInSession: false };
    if (markAsRead) {
      current.readInSession = true;
      if (mtimeMs !== undefined) current.mtime = mtimeMs;
      if (contentHash !== undefined) {
        current.contentHash = contentHash;
      } else {
        // Compute hash if not provided and file is small enough
        try {
          const stats = statSync(filePath);
          if (stats.size < 1024 * 1024) {
            // 1MB limit
            const content = readFileSync(filePath);
            current.contentHash = createHash("sha256").update(content).digest("hex");
          } else {
            current.contentHash = "mtime_only";
          }
        } catch {
          // File might not exist yet or be inaccessible
        }
      }
    }
    this.fileState.set(filePath, current);
  }

  /**
   * Check if a file write is allowed (read-before-write protection)
   */
  canWriteFile(filePath: string, currentMtimeMs?: number): { allowed: boolean; reason?: string } {
    const state = this.fileState.get(filePath);

    if (!state) {
      return { allowed: false, reason: "File not read in session - stale read protection (read before write required)" };
    }

    if (!state.readInSession) {
      return { allowed: false, reason: "File not read in current session - stale read protection" };
    }

    // Performance fast-path: if mtime matches, we assume content matches
    if (currentMtimeMs !== undefined && state.mtime > 0 && currentMtimeMs === state.mtime) {
      return { allowed: true };
    }

    // Check content hash for files < 1MB
    if (
      state.contentHash !== "" &&
      state.contentHash !== "mtime_only"
    ) {
      try {
        const content = readFileSync(filePath);
        const currentContentHash = createHash("sha256").update(content).digest("hex");
        if (currentContentHash !== state.contentHash) {
          return {
            allowed: false,
            reason:
              "File content changed since last read - stale read protection (content hash mismatch)",
          };
        }
      } catch {
        // If we can't read it now, but we had a hash before, it's a conflict
        return { allowed: false, reason: "File inaccessible or deleted since last read" };
      }
    }

    // Fallback: mtime check if content hash wasn't available or was mtime_only
    if (currentMtimeMs !== undefined && state.mtime > 0 && currentMtimeMs !== state.mtime) {
      return { allowed: false, reason: "File modified externally after read - stale read protection" };
    }

    return { allowed: true };
  }

  /**
   * Get the file state map (for evidence persistence)
   */
  getFileState(): Map<string, { contentHash: string | "mtime_only"; mtime: number; readInSession: boolean }> {
    return this.fileState;
  }

  /**
   * Run completion gate - determine if task can end as successful
   */
  runCompletionGate(
    sessionId: string,
    messageId: string,
    userRequest: string,
    assistantResponse: string,
  ): CompletionGateResult {
    const snapshot = this.buildSessionLedgerSnapshot(sessionId, messageId);
    const ledger = snapshot?.aggregate;
    const targetLedger = snapshot?.target;

    if (!ledger) {
      return {
        sessionId,
        requestType: "explanation",
        gatePassed: false,
        reasonCode: CompletionFailureReason.MISSING_TOOL_EVIDENCE,
        confidence: 0,
        evidenceSummary: {
          mutationsFound: 0,
          validationsRun: 0,
          filesChanged: 0,
          claimedChanges: 0,
          mutatingToolCalls: 0,
          nonObservableMutationCalls: 0,
          validationRequested: false,
        },
        missingEvidence: ["No execution ledger found"],
        recommendedActions: ["Ensure execution tracking is enabled"],
        evaluatedAt: new Date().toISOString(),
      };
    }

    // Analyze request type
    const requestType = this.classifyRequest(userRequest);

    // Extract claims from assistant response
    const claimedChanges = this.extractClaims(assistantResponse);
    targetLedger!.claimedArtifacts = claimedChanges;

    // Analyze evidence
    const evidenceSummary = {
      mutationsFound: ledger.mutations.length,
      validationsRun: ledger.validations.length,
      filesChanged: new Set(ledger.mutations.map((m) => m.filePath)).size,
      claimedChanges: claimedChanges.length,
      mutatingToolCalls: ledger.toolCalls.filter((tc) => tc.toolClass === ToolClass.MUTATING).length,
      nonObservableMutationCalls: ledger.toolCalls.filter(
        (tc) =>
          tc.toolClass === ToolClass.MUTATING &&
          tc.result.success &&
          tc.result.metadata?.["observableMutation"] === false,
      ).length,
      validationRequested: this.requiresValidation(userRequest, assistantResponse),
    };

    // Evaluate completion criteria
    const evaluation = this.evaluateCompletion(requestType, ledger, evidenceSummary);

    // Update ledger
    targetLedger!.completionStatus = {
      canComplete: evaluation.gatePassed,
      reasonCode: evaluation.reasonCode,
      missingEvidence: evaluation.missingEvidence,
      summary: evaluation.summary,
    };

    return {
      sessionId,
      requestType,
      gatePassed: evaluation.gatePassed,
      reasonCode: evaluation.reasonCode,
      confidence: evaluation.confidence,
      evidenceSummary,
      missingEvidence: evaluation.missingEvidence,
      recommendedActions: evaluation.recommendedActions,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Classify the type of user request
   */
  private classifyRequest(request: string): CompletionGateResult["requestType"] {
    const lower = request.toLowerCase();

    if (
      lower.includes("explain") ||
      lower.includes("what") ||
      lower.includes("how does") ||
      lower.includes("analyze") ||
      lower.includes("describe")
    ) {
      return "explanation";
    }

    if (
      lower.includes("change") ||
      lower.includes("modify") ||
      lower.includes("update") ||
      lower.includes("fix") ||
      lower.includes("implement") ||
      lower.includes("create") ||
      lower.includes("add")
    ) {
      return "code_change";
    }

    if (
      lower.includes("read") ||
      lower.includes("list") ||
      lower.includes("show") ||
      lower.includes("inspect") ||
      lower.includes("review") ||
      lower.includes("check") ||
      lower.includes("validate") ||
      lower.includes("test")
    ) {
      return "analysis";
    }

    return "mixed";
  }

  /**
   * Extract claimed changes from assistant response
   */
  private extractClaims(response: string): string[] {
    const claims: string[] = [];
    const patterns = [
      /I (?:have\s+)?(?:successfully\s+)?(?:implemented?|created?|built?|changed?|modified?|updated?|fixed?)\s+(.+?)(?:\s+for you|\s+as requested|\.|\n|$)/gi,
      /The (.+?) has been (?:successfully\s+)?(?:implemented?|created?|built?|changed?|modified?|updated?|fixed?)/gi,
      /(?:Successfully\s+)?(?:implemented?|created?|built?|changed?|modified?|updated?|fixed?)\s+(.+?)(?:\s+that|\.|\n|$)/gi,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(response)) !== null) {
        const claim = match[1]?.trim();
        if (claim && claim.length > 5) {
          claims.push(claim);
        }
      }
    }

    return [...new Set(claims)]; // Remove duplicates
  }

  private requiresValidation(userRequest: string, assistantResponse: string): boolean {
    const combined = `${userRequest}\n${assistantResponse}`.toLowerCase();
    const validationPatterns = [
      "test",
      "tests",
      "lint",
      "typecheck",
      "type-check",
      "validate",
      "validation",
      "checked",
      "verified",
      "verification",
      "passes",
      "passing",
    ];

    return validationPatterns.some((pattern) => combined.includes(pattern));
  }

  /**
   * Evaluate if completion criteria are met
   */
  private evaluateCompletion(
    requestType: CompletionGateResult["requestType"],
    ledger: ExecutionLedger,
    evidenceSummary: CompletionEvidenceSummary,
  ): {
    gatePassed: boolean;
    reasonCode?: CompletionFailureReason;
    confidence: number;
    missingEvidence: string[];
    recommendedActions: string[];
    summary: string;
  } {
    const missingEvidence: string[] = [];
    const recommendedActions: string[] = [];
    let confidence = 100;
    let reasonCode: CompletionFailureReason | undefined;
    const setFailure = (
      failure: CompletionFailureReason,
      evidence: string,
      confidencePenalty: number,
      recommendation?: string,
    ) => {
      if (!reasonCode) {
        reasonCode = failure;
      }
      confidence = Math.max(0, confidence - confidencePenalty);
      if (!missingEvidence.includes(evidence)) {
        missingEvidence.push(evidence);
      }
      if (recommendation && !recommendedActions.includes(recommendation)) {
        recommendedActions.push(recommendation);
      }
    };

    // For explanation-only requests, no mutations needed
    if (requestType === "explanation") {
      return {
        gatePassed: true,
        confidence: 100,
        missingEvidence: [],
        recommendedActions: [],
        summary: "Explanation request - no mutations required",
      };
    }

    if (
      ["ask", "plan", "review"].includes(ledger.mode) &&
      evidenceSummary.mutatingToolCalls > 0
    ) {
      setFailure(
        CompletionFailureReason.MODE_PERMISSION_VIOLATION,
        `Mode "${ledger.mode}" is read-only but mutating tools were executed`,
        100,
        "Switch to code/debug mode before running mutating tools",
      );
    }

    if (
      evidenceSummary.nonObservableMutationCalls > 0 &&
      evidenceSummary.mutationsFound === 0
    ) {
      setFailure(
        CompletionFailureReason.NO_OBSERVABLE_MUTATION,
        "Mutating tools reported success but no observable file changes were recorded",
        80,
        "Re-read the target file and apply a concrete edit or write that changes repo state",
      );
    }

    const implementationRequested = requestType === "code_change";

    if (implementationRequested && evidenceSummary.mutationsFound === 0) {
      if (evidenceSummary.claimedChanges > 0) {
        setFailure(
          CompletionFailureReason.NARRATIVE_WITHOUT_MUTATION,
          "Assistant claimed changes but no observable mutating tool execution was recorded",
          90,
          "Use mutating tools (edit, write, apply_patch) and return their real execution evidence",
        );
      } else {
        setFailure(
          CompletionFailureReason.MUTATION_REQUESTED_BUT_NO_FILES_CHANGED,
          "Implementation was requested but no observable file mutations were recorded",
          100,
          "Execute a mutating tool before concluding the implementation task",
        );
      }
    }

    if (evidenceSummary.mutationsFound > 0 && evidenceSummary.mutatingToolCalls === 0) {
      setFailure(
        CompletionFailureReason.MISSING_TOOL_EVIDENCE,
        "Mutations were observed without a corresponding mutating tool call record",
        70,
        "Ensure all file changes flow through registered mutating tools",
      );
    }

    if (evidenceSummary.validationRequested && evidenceSummary.validationsRun === 0) {
      setFailure(
        CompletionFailureReason.CLAIMED_VALIDATION_NOT_RUN,
        "Validation was requested or claimed but no validation records were captured",
        60,
        "Run validation tools (test, lint, typecheck) before claiming checks passed",
      );
    }

    if (evidenceSummary.mutationsFound > 0 && evidenceSummary.filesChanged === 0) {
      setFailure(
        CompletionFailureReason.MUTATION_REQUESTED_BUT_NO_FILES_CHANGED,
        "Mutations were recorded but no file paths were associated with the change set",
        70,
        "Return normalized file paths for every mutating tool result",
      );
    }

    const gatePassed = missingEvidence.length === 0;
    const summary = gatePassed
      ? `Completion approved with ${confidence}% confidence`
      : `Completion blocked: ${missingEvidence.join(", ")}`;

    return {
      gatePassed,
      reasonCode,
      confidence,
      missingEvidence,
      recommendedActions,
      summary,
    };
  }

  /**
   * Infer validation type from tool name
   */
  private inferValidationType(toolName: string): ValidationRecord["validationType"] {
    const lower = toolName.toLowerCase();
    if (lower.includes("test")) return "test";
    if (lower.includes("lint")) return "lint";
    if (lower.includes("typecheck") || lower.includes("tsc")) return "typecheck";
    if (lower.includes("syntax")) return "syntax";
    return "custom";
  }

  /**
   * Get ledger for inspection/debugging
   */
  getLedger(sessionId: string, messageId: string): ExecutionLedger | undefined {
    return this.ledgers.get(`${sessionId}:${messageId}`);
  }

  /**
   * Get all ledgers (for debugging)
   */
  getAllLedgers(): ExecutionLedger[] {
    return Array.from(this.ledgers.values());
  }

  /**
   * Record evidence from a child sub-agent into the parent's ledger (M5).
   * Each record is tagged with source to distinguish parent vs child evidence.
   */
  recordSubAgentEvidence(
    sessionId: string,
    messageId: string,
    childSessionId: string,
    evidence: {
      mutations: MutationRecord[];
      validations: ValidationRecord[];
      toolCalls: ToolExecutionRecord[];
      gateResult?: CompletionGateResult;
    },
  ): void {
    const key = `${sessionId}:${messageId}`;
    const ledger = this.ledgers.get(key);
    if (!ledger) return;

    const sourceTag = `subagent:${childSessionId}`;

    for (const mutation of evidence.mutations) {
      ledger.mutations.push({
        ...mutation,
        toolName: `${mutation.toolName} [${sourceTag}]`,
      });
      // M5: Proactively update parent's file state ledger with child's after-hash for stale protection
      this.updateFileReadState(mutation.filePath, true, undefined, mutation.afterHash);
    }

    for (const validation of evidence.validations) {
      ledger.validations.push({
        ...validation,
        toolName: `${validation.toolName} [${sourceTag}]`,
      });
    }

    for (const toolCall of evidence.toolCalls) {
      ledger.toolCalls.push({
        ...toolCall,
        toolName: `${toolCall.toolName} [${sourceTag}]`,
      });
    }

    // If child gate failed, record a warning in claims
    if (evidence.gateResult && !evidence.gateResult.gatePassed) {
      ledger.claimedArtifacts.push(
        `[SUBAGENT_GATE_FAILED:${childSessionId}] ${evidence.gateResult.reasonCode ?? "unknown"}`,
      );
    }
  }

  /**
   * Clear tracked execution state.
   * Used by tests and by any caller that wants to discard prior session evidence.
   */
  reset(sessionId?: string): void {
    if (!sessionId) {
      this.ledgers.clear();
      this.fileState.clear();
      return;
    }

    const prefix = `${sessionId}:`;
    for (const key of this.ledgers.keys()) {
      if (key.startsWith(prefix)) {
        this.ledgers.delete(key);
      }
    }
  }
}

// Global instance
export const executionIntegrity = new ExecutionIntegrityManager();
