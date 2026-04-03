// ============================================================================
// @dantecode/cli — Evidence Chain Bridge
// Lightweight session-scoped integration that wires @dantecode/evidence-chain
// into the agent-loop hot path. Creates cryptographic receipts for verification
// events and seals the evidence chain at session end.
// ============================================================================

import {
  ReceiptChain,
  createReceipt,
  createEvidenceBundle,
  EvidenceSealer,
  EvidenceType,
  hashDict,
  type Receipt,
  type CertificationSeal,
  type EvidenceBundleData,
} from "@dantecode/evidence-chain";

// ---------------------------------------------------------------------------
// Session Evidence Tracker
// ---------------------------------------------------------------------------

/**
 * Tracks verification evidence across an agent-loop session.
 * Created once at session start; receipts appended on each verification event;
 * sealed at session end to produce a tamper-evident certification seal.
 */
export class SessionEvidenceTracker {
  private readonly sessionId: string;
  private readonly receiptChain: ReceiptChain;
  private readonly bundles: EvidenceBundleData[] = [];
  private readonly sealer: EvidenceSealer;
  private seq = 0;
  private lastBundleHash = "0".repeat(64);

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.receiptChain = new ReceiptChain();
    this.sealer = new EvidenceSealer();
  }

  // ---- Receipt creation helpers ----

  /**
   * Record a verification pass event.
   * @param verifyName Name of the verification command (e.g. "typecheck", "lint")
   * @param command    The actual shell command that was run
   */
  recordVerificationPass(verifyName: string, command: string): Receipt {
    const receipt = createReceipt({
      correlationId: this.sessionId,
      actor: `verify:${verifyName}`,
      action: `verification_pass:${verifyName}`,
      beforeState: { command, status: "running" },
      afterState: { command, status: "passed" },
    });
    this.receiptChain.append(receipt);

    this.bundles.push(
      createEvidenceBundle({
        runId: this.sessionId,
        seq: this.seq++,
        organ: "verification-pipeline",
        eventType: EvidenceType.VERIFICATION_PASSED,
        evidence: {
          verifyName,
          command,
          passed: true,
          receiptId: receipt.receiptId,
        },
        prevHash: this.lastBundleHash,
      }),
    );
    this.lastBundleHash = this.bundles[this.bundles.length - 1]!.hash;

    return receipt;
  }

  /**
   * Record a verification failure event.
   * @param verifyName Name of the verification command
   * @param command    The actual shell command that was run
   * @param errorSig   Error signature (from computeErrorSignature)
   * @param attempt    Current retry attempt number
   * @param maxRetries Maximum retries allowed
   */
  recordVerificationFailure(
    verifyName: string,
    command: string,
    errorSig: string,
    attempt: number,
    maxRetries: number,
  ): Receipt {
    const receipt = createReceipt({
      correlationId: this.sessionId,
      actor: `verify:${verifyName}`,
      action: `verification_fail:${verifyName}`,
      beforeState: { command, status: "running", attempt },
      afterState: { command, status: "failed", errorSig, attempt, maxRetries },
    });
    this.receiptChain.append(receipt);

    this.bundles.push(
      createEvidenceBundle({
        runId: this.sessionId,
        seq: this.seq++,
        organ: "verification-pipeline",
        eventType: EvidenceType.VERIFICATION_FAILED,
        evidence: {
          verifyName,
          command,
          passed: false,
          errorSig,
          attempt,
          maxRetries,
          receiptId: receipt.receiptId,
        },
        prevHash: this.lastBundleHash,
      }),
    );
    this.lastBundleHash = this.bundles[this.bundles.length - 1]!.hash;

    return receipt;
  }

  /**
   * Record a PDSE score event (DanteForge pipeline scoring).
   * @param filePath   The file that was scored
   * @param passed     Whether the file passed DanteForge verification
   * @param summary    DanteForge output summary
   */
  recordPdseScore(filePath: string, passed: boolean, summary: string): Receipt {
    const receipt = createReceipt({
      correlationId: this.sessionId,
      actor: "danteforge",
      action: `pdse_score:${filePath}`,
      beforeState: { filePath, status: "pending" },
      afterState: { filePath, passed, summary: summary.slice(0, 200) },
    });
    this.receiptChain.append(receipt);

    this.bundles.push(
      createEvidenceBundle({
        runId: this.sessionId,
        seq: this.seq++,
        organ: "danteforge-pipeline",
        eventType: EvidenceType.PDSE_SCORED,
        evidence: {
          filePath,
          passed,
          summaryHash: hashDict({ summary }),
          receiptId: receipt.receiptId,
        },
        prevHash: this.lastBundleHash,
      }),
    );
    this.lastBundleHash = this.bundles[this.bundles.length - 1]!.hash;

    return receipt;
  }

  /**
   * Record a tool execution event.
   * @param toolName  Name of the tool (e.g. "Bash", "Write", "Edit")
   * @param input     Tool input parameters
   * @param success   Whether the tool execution succeeded
   */
  recordToolExecution(toolName: string, input: Record<string, unknown>, success: boolean): Receipt {
    const receipt = createReceipt({
      correlationId: this.sessionId,
      actor: `tool:${toolName}`,
      action: success ? `tool_result:${toolName}` : `tool_error:${toolName}`,
      beforeState: { toolName, status: "executing" },
      afterState: { toolName, success },
    });
    this.receiptChain.append(receipt);

    this.bundles.push(
      createEvidenceBundle({
        runId: this.sessionId,
        seq: this.seq++,
        organ: "tool-runtime",
        eventType: success ? EvidenceType.TOOL_RESULT : EvidenceType.TOOL_ERROR,
        evidence: {
          toolName,
          inputKeys: Object.keys(input),
          success,
          receiptId: receipt.receiptId,
        },
        prevHash: this.lastBundleHash,
      }),
    );
    this.lastBundleHash = this.bundles[this.bundles.length - 1]!.hash;

    return receipt;
  }

  // ---- Session seal ----

  /**
   * Seal the evidence chain at session end.
   * Produces a CertificationSeal that cryptographically binds the session ID,
   * all evidence hashes (via the Merkle root), and summary metrics.
   * @param config   Session configuration snapshot (for the configHash field)
   * @param filesModified  Number of files modified during the session
   * @param totalRounds    Number of agent-loop rounds executed
   */
  seal(
    config: Record<string, unknown>,
    filesModified: number,
    totalRounds: number,
  ): CertificationSeal {
    const metrics: Record<string, unknown>[] = [
      { metric: "receipts", value: this.receiptChain.size },
      { metric: "bundles", value: this.bundles.length },
      { metric: "filesModified", value: filesModified },
      { metric: "totalRounds", value: totalRounds },
    ];

    return this.sealer.createSeal({
      sessionId: this.sessionId,
      evidenceRootHash: this.receiptChain.merkleRoot,
      config,
      metrics,
      eventCount: this.receiptChain.size,
    });
  }

  // ---- Accessors ----

  /** Number of receipts recorded so far. */
  get receiptCount(): number {
    return this.receiptChain.size;
  }

  /** Current Merkle root of the receipt chain. */
  get merkleRoot(): string {
    return this.receiptChain.merkleRoot;
  }

  /** All evidence bundles recorded (read-only). */
  get evidenceBundles(): readonly EvidenceBundleData[] {
    return this.bundles;
  }

  /** Export the receipt chain as JSON for persistence. */
  exportChain(): { receipts: Receipt[]; merkleRoot: string } {
    return this.receiptChain.exportToJSON();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new SessionEvidenceTracker for the given session.
 * Lightweight — just initializes the chain structures; no I/O.
 */
export function createSessionEvidenceTracker(sessionId: string): SessionEvidenceTracker {
  return new SessionEvidenceTracker(sessionId);
}
