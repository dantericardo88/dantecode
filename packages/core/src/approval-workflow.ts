// packages/core/src/approval-workflow.ts
// Structured approval workflow with undo stack and risk classification — closes dim 13 (7→9).
//
// Harvested from: Claude Code approval patterns, Devin checkpoint/resume, Aider confirmation flow.
//
// Provides:
//   - ApprovalRequest/Response lifecycle
//   - Risk classification (safe/caution/dangerous/destructive)
//   - Undo stack for reversible operations
//   - Confirmation templates with diff preview
//   - Batch approval (approve all safe operations)

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = "safe" | "caution" | "dangerous" | "destructive";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "auto-approved" | "expired";

export type OperationType =
  | "file-write"
  | "file-delete"
  | "file-rename"
  | "shell-command"
  | "git-commit"
  | "git-push"
  | "git-reset"
  | "git-branch-delete"
  | "network-request"
  | "package-install"
  | "package-remove"
  | "config-change"
  | "custom";

export interface ApprovalRequest {
  /** Unique identifier */
  id: string;
  /** What type of operation this is */
  operationType: OperationType;
  /** Human-readable description */
  description: string;
  /** The actual command/content to execute */
  payload: string;
  /** Risk level — used for auto-approval decisions */
  riskLevel: RiskLevel;
  /** Whether this operation can be undone */
  isReversible: boolean;
  /** Estimated impact description */
  impact?: string;
  /** Diff preview for file operations */
  diffPreview?: string;
  /** Time when request expires (ms since epoch) */
  expiresAt?: number;
  /** Associated file paths */
  filePaths?: string[];
  /** Parent operation ID for batch grouping */
  batchId?: string;
}

export interface ApprovalResponse {
  requestId: string;
  status: ApprovalStatus;
  decidedAt: string;
  /** Optional note from the approver */
  note?: string;
  /** For partial approval: which items were approved */
  approvedItems?: string[];
}

export interface UndoEntry {
  id: string;
  operationId: string;
  description: string;
  /** Callback that reverts the operation */
  undoFn: () => Promise<void> | void;
  /** When this entry was recorded (ms) */
  recordedAt: number;
  /** Whether this entry has been consumed */
  consumed: boolean;
}

export interface ApprovalWorkflowOptions {
  /** Auto-approve operations at or below this risk level (default: "safe") */
  autoApproveUpTo?: RiskLevel;
  /** Request expiry in ms (default: 300000 = 5 min) */
  requestExpiryMs?: number;
  /** Max undo stack depth (default: 50) */
  maxUndoDepth?: number;
  /** Custom approval prompt formatter */
  formatPrompt?: (req: ApprovalRequest) => string;
}

// ─── Risk Classifier ──────────────────────────────────────────────────────────

const RISK_RANK: Record<RiskLevel, number> = {
  safe: 1,
  caution: 2,
  dangerous: 3,
  destructive: 4,
};

const DESTRUCTIVE_SHELL_PATTERNS = [
  /\brm\s+-rf?\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+clean\s+-/,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\b:\s*\(\s*\)\s*\{/,         // fork bomb
];

const DANGEROUS_SHELL_PATTERNS = [
  /\bgit\s+push\b/,
  /\bnpm\s+publish\b/,
  /\bdocker\s+rm\b/,
  /\bkill\b/,
  /\bpkill\b/,
];

const CAUTION_SHELL_PATTERNS = [
  /\bnpm\s+install\b/,
  /\byarn\s+add\b/,
  /\bpip\s+install\b/,
  /\bgit\s+commit\b/,
  /\bcurl\b/,
  /\bwget\b/,
];

/**
 * Classify the risk level of an operation based on its type and payload.
 */
export function classifyRisk(operationType: OperationType, payload: string): RiskLevel {
  if (operationType === "file-delete" || operationType === "git-branch-delete") return "dangerous";
  if (operationType === "git-reset") return "destructive";
  if (operationType === "git-push") return "dangerous";

  if (operationType === "shell-command") {
    if (DESTRUCTIVE_SHELL_PATTERNS.some((re) => re.test(payload))) return "destructive";
    if (DANGEROUS_SHELL_PATTERNS.some((re) => re.test(payload))) return "dangerous";
    if (CAUTION_SHELL_PATTERNS.some((re) => re.test(payload))) return "caution";
  }

  if (operationType === "package-remove") return "caution";
  if (operationType === "package-install") return "caution";
  if (operationType === "network-request") return "caution";
  if (operationType === "file-write") return "safe";
  if (operationType === "git-commit") return "caution";
  if (operationType === "config-change") return "caution";

  return "safe";
}

/**
 * Determine if an operation is reversible by type.
 */
export function isOperationReversible(operationType: OperationType): boolean {
  const irreversible: OperationType[] = [
    "file-delete",
    "git-push",
    "package-install",
    "package-remove",
    "network-request",
  ];
  return !irreversible.includes(operationType);
}

// ─── Request Builder ──────────────────────────────────────────────────────────

let _idCounter = 0;
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++_idCounter}`;
}

/**
 * Build an ApprovalRequest with auto-classified risk.
 */
export function buildApprovalRequest(
  operationType: OperationType,
  description: string,
  payload: string,
  extras: Partial<Pick<ApprovalRequest, "impact" | "diffPreview" | "filePaths" | "batchId" | "expiresAt">> = {},
  options: Pick<ApprovalWorkflowOptions, "requestExpiryMs"> = {},
): ApprovalRequest {
  const riskLevel = classifyRisk(operationType, payload);
  const isReversible = isOperationReversible(operationType);
  const expiresAt = extras.expiresAt ?? Date.now() + (options.requestExpiryMs ?? 300_000);

  return {
    id: generateId("req"),
    operationType,
    description,
    payload,
    riskLevel,
    isReversible,
    expiresAt,
    ...extras,
  };
}

// ─── Confirmation Formatter ───────────────────────────────────────────────────

const RISK_BADGE: Record<RiskLevel, string> = {
  safe: "🟢 SAFE",
  caution: "🟡 CAUTION",
  dangerous: "🔴 DANGEROUS",
  destructive: "💀 DESTRUCTIVE",
};

/**
 * Format an approval request into a human-readable confirmation prompt.
 */
export function formatApprovalPrompt(req: ApprovalRequest): string {
  const lines = [
    `## Approval Required`,
    `**Operation:** ${req.description}`,
    `**Type:** \`${req.operationType}\``,
    `**Risk:** ${RISK_BADGE[req.riskLevel]}`,
    `**Reversible:** ${req.isReversible ? "Yes" : "No"}`,
  ];

  if (req.filePaths && req.filePaths.length > 0) {
    lines.push(`**Files:** ${req.filePaths.join(", ")}`);
  }

  if (req.impact) {
    lines.push(`**Impact:** ${req.impact}`);
  }

  if (req.diffPreview) {
    lines.push("**Preview:**");
    lines.push("```diff");
    lines.push(req.diffPreview);
    lines.push("```");
  }

  lines.push("");
  lines.push(`\`${req.payload}\``);
  lines.push("");
  lines.push("**Approve? [y/n/d(iff)]**");

  return lines.join("\n");
}

// ─── Auto-Approval Engine ─────────────────────────────────────────────────────

/**
 * Check if a request can be auto-approved given the configured threshold.
 */
export function canAutoApprove(
  req: ApprovalRequest,
  autoApproveUpTo: RiskLevel = "safe",
): boolean {
  if (req.expiresAt && Date.now() > req.expiresAt) return false;
  return RISK_RANK[req.riskLevel] <= RISK_RANK[autoApproveUpTo];
}

/**
 * Auto-approve all requests that fall within the threshold.
 * Returns the list of auto-approved and the list that still need manual review.
 */
export function partitionForAutoApproval(
  requests: ApprovalRequest[],
  autoApproveUpTo: RiskLevel = "safe",
): { autoApproved: ApprovalRequest[]; needsReview: ApprovalRequest[] } {
  const autoApproved: ApprovalRequest[] = [];
  const needsReview: ApprovalRequest[] = [];
  for (const req of requests) {
    if (canAutoApprove(req, autoApproveUpTo)) autoApproved.push(req);
    else needsReview.push(req);
  }
  return { autoApproved, needsReview };
}

// ─── Undo Stack ───────────────────────────────────────────────────────────────

export class UndoStack {
  private _entries: UndoEntry[] = [];
  private _maxDepth: number;

  constructor(maxDepth = 50) {
    this._maxDepth = maxDepth;
  }

  /**
   * Push a new undo entry. Oldest entries are evicted when maxDepth is exceeded.
   */
  push(operationId: string, description: string, undoFn: () => Promise<void> | void): string {
    const id = generateId("undo");
    this._entries.push({
      id,
      operationId,
      description,
      undoFn,
      recordedAt: Date.now(),
      consumed: false,
    });
    if (this._entries.length > this._maxDepth) {
      this._entries.shift();
    }
    return id;
  }

  /**
   * Undo the most recent unconsumed entry.
   */
  async undoLast(): Promise<UndoEntry | undefined> {
    const entry = [...this._entries].reverse().find((e) => !e.consumed);
    if (!entry) return undefined;
    await entry.undoFn();
    entry.consumed = true;
    return entry;
  }

  /**
   * Undo a specific entry by ID.
   */
  async undoById(id: string): Promise<UndoEntry | undefined> {
    const entry = this._entries.find((e) => e.id === id && !e.consumed);
    if (!entry) return undefined;
    await entry.undoFn();
    entry.consumed = true;
    return entry;
  }

  /**
   * Get all available (unconsumed) undo entries.
   */
  getAvailable(): UndoEntry[] {
    return this._entries.filter((e) => !e.consumed);
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this._entries = [];
  }

  get depth(): number {
    return this._entries.filter((e) => !e.consumed).length;
  }
}

// ─── Approval Workflow ────────────────────────────────────────────────────────

export class ApprovalWorkflow {
  private _pending = new Map<string, ApprovalRequest>();
  private _responses = new Map<string, ApprovalResponse>();
  private _undoStack: UndoStack;
  private _options: Required<ApprovalWorkflowOptions>;

  constructor(options: ApprovalWorkflowOptions = {}) {
    this._options = {
      autoApproveUpTo: options.autoApproveUpTo ?? "safe",
      requestExpiryMs: options.requestExpiryMs ?? 300_000,
      maxUndoDepth: options.maxUndoDepth ?? 50,
      formatPrompt: options.formatPrompt ?? formatApprovalPrompt,
    };
    this._undoStack = new UndoStack(this._options.maxUndoDepth);
  }

  /**
   * Submit a request for approval. Auto-approves if within threshold.
   * Returns the response (may be auto-approved).
   */
  submit(
    operationType: OperationType,
    description: string,
    payload: string,
    extras: Partial<
      Pick<ApprovalRequest, "impact" | "diffPreview" | "filePaths" | "batchId" | "expiresAt">
    > = {},
  ): { request: ApprovalRequest; response: ApprovalResponse | null } {
    const req = buildApprovalRequest(operationType, description, payload, extras, {
      requestExpiryMs: this._options.requestExpiryMs,
    });

    if (canAutoApprove(req, this._options.autoApproveUpTo)) {
      const response: ApprovalResponse = {
        requestId: req.id,
        status: "auto-approved",
        decidedAt: new Date().toISOString(),
      };
      this._responses.set(req.id, response);
      return { request: req, response };
    }

    this._pending.set(req.id, req);
    return { request: req, response: null };
  }

  /**
   * Manually approve or reject a pending request.
   */
  decide(requestId: string, approved: boolean, note?: string): ApprovalResponse | undefined {
    const req = this._pending.get(requestId);
    if (!req) return undefined;

    const response: ApprovalResponse = {
      requestId,
      status: approved ? "approved" : "rejected",
      decidedAt: new Date().toISOString(),
      note,
    };
    this._responses.set(requestId, response);
    this._pending.delete(requestId);
    return response;
  }

  /**
   * Get the formatted confirmation prompt for a pending request.
   */
  getPrompt(requestId: string): string | undefined {
    const req = this._pending.get(requestId);
    if (!req) return undefined;
    return this._options.formatPrompt(req);
  }

  /**
   * Register an undo handler after an approved operation executes.
   */
  registerUndo(operationId: string, description: string, undoFn: () => Promise<void> | void): string {
    return this._undoStack.push(operationId, description, undoFn);
  }

  async undoLast(): Promise<UndoEntry | undefined> {
    return this._undoStack.undoLast();
  }

  async undoById(id: string): Promise<UndoEntry | undefined> {
    return this._undoStack.undoById(id);
  }

  get pendingCount(): number {
    return this._pending.size;
  }

  get undoDepth(): number {
    return this._undoStack.depth;
  }

  getPending(): ApprovalRequest[] {
    return [...this._pending.values()];
  }

  getResponse(requestId: string): ApprovalResponse | undefined {
    return this._responses.get(requestId);
  }

  isExpired(requestId: string): boolean {
    const req = this._pending.get(requestId);
    if (!req || !req.expiresAt) return false;
    return Date.now() > req.expiresAt;
  }
}
