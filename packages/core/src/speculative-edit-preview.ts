// packages/core/src/speculative-edit-preview.ts
// Speculative inline edit preview — deepens dim 6 (inline edit UX).
//
// Harvested from: Cursor speculative edit mode, Copilot Next Edit Suggestions,
//                 Zed AI inline diff preview.
//
// Provides:
//   - Pre-acceptance diff preview (shows what would change before user commits)
//   - Partial hunk selection (accept only specific hunks, not all)
//   - Confidence scoring per edit hunk
//   - Context-aware edit description generation
//   - Edit chain tracking (sequential edits on the same region)
//   - Conflict detection with unsaved local changes

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditHunkStatus = "pending" | "accepted" | "rejected" | "modified";

export type EditConflictType =
  | "overlapping-range"
  | "stale-content"
  | "merge-conflict"
  | "none";

export interface EditHunk {
  id: string;
  /** Original lines (before the edit) */
  originalLines: string[];
  /** Proposed replacement lines */
  proposedLines: string[];
  /** 1-indexed start line in the original file */
  startLine: number;
  /** 1-indexed end line in the original file (inclusive) */
  endLine: number;
  /** AI confidence for this hunk (0–1) */
  confidence: number;
  /** Human-readable reason for this change */
  rationale?: string;
  /** Current acceptance status */
  status: EditHunkStatus;
  /** User-modified version (if status==="modified") */
  modifiedLines?: string[];
}

export interface SpeculativeEditSession {
  id: string;
  filePath: string;
  /** Full original file content */
  originalContent: string;
  hunks: EditHunk[];
  createdAt: string;
  updatedAt: string;
  /** Overall session status */
  status: "active" | "committed" | "abandoned";
  /** Source that generated the edit (model name, tool, etc.) */
  source?: string;
}

export interface EditPreviewResult {
  /** The previewed content after applying accepted/pending hunks */
  previewContent: string;
  /** Count of lines added */
  linesAdded: number;
  /** Count of lines removed */
  linesDeleted: number;
  /** Count of hunks pending decision */
  pendingHunks: number;
  /** Count of accepted hunks */
  acceptedHunks: number;
  /** Count of rejected hunks */
  rejectedHunks: number;
  /** Any conflict detected */
  conflict: EditConflictType;
}

export interface EditChainEntry {
  sessionId: string;
  hunkId: string;
  action: "accept" | "reject" | "modify";
  timestamp: string;
  previousStatus: EditHunkStatus;
}

// ─── Hunk Builder ─────────────────────────────────────────────────────────────

let _hunkCounter = 0;

export function buildEditHunk(
  originalLines: string[],
  proposedLines: string[],
  startLine: number,
  opts: { confidence?: number; rationale?: string } = {},
): EditHunk {
  return {
    id: `hunk-${++_hunkCounter}`,
    originalLines,
    proposedLines,
    startLine,
    endLine: startLine + originalLines.length - 1,
    confidence: opts.confidence ?? 0.8,
    rationale: opts.rationale,
    status: "pending",
  };
}

/**
 * Parse a unified diff string into EditHunks.
 * Handles standard `@@ -start,count +start,count @@` headers.
 */
export function parseUnifiedDiffToHunks(diff: string, baseConfidence = 0.8): EditHunk[] {
  const hunks: EditHunk[] = [];
  const lines = diff.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!match) { i++; continue; }

    const origStart = parseInt(match[1]!, 10);
    void parseInt(match[2] ?? "1", 10); // origCount — unused but parsed for completeness

    const originalLines: string[] = [];
    const proposedLines: string[] = [];

    i++;
    while (i < lines.length && !lines[i]!.startsWith("@@") && !lines[i]!.startsWith("diff ")) {
      const l = lines[i]!;
      if (l.startsWith("-")) originalLines.push(l.slice(1));
      else if (l.startsWith("+")) proposedLines.push(l.slice(1));
      else { originalLines.push(l.slice(1)); proposedLines.push(l.slice(1)); }
      i++;
    }

    if (originalLines.length > 0 || proposedLines.length > 0) {
      hunks.push(buildEditHunk(originalLines, proposedLines, origStart, { confidence: baseConfidence }));
    }
  }

  return hunks;
}

// ─── Confidence Scorer ────────────────────────────────────────────────────────

/**
 * Adjust hunk confidence based on size and complexity heuristics.
 * Small, targeted changes score higher than large replacements.
 */
export function scoreHunkConfidence(hunk: EditHunk): number {
  let score = 0.8;

  // Smaller hunks = higher confidence
  const totalLines = hunk.originalLines.length + hunk.proposedLines.length;
  if (totalLines <= 4) score += 0.15;
  else if (totalLines <= 10) score += 0.05;
  else if (totalLines > 30) score -= 0.20;

  // Pure additions (no deletions) = higher confidence
  if (hunk.originalLines.length === 0) score += 0.10;

  // Blank original lines only = lower confidence (probably wrong hunk)
  if (hunk.originalLines.every((l) => l.trim() === "")) score -= 0.15;

  // High ratio of identical lines (minor change) = higher confidence
  const identical = hunk.originalLines.filter((l, i) => l === hunk.proposedLines[i]).length;
  const similarity = hunk.originalLines.length > 0 ? identical / hunk.originalLines.length : 0;
  score += similarity * 0.10;

  return Math.min(1, Math.max(0, score));
}

// ─── Preview Generator ────────────────────────────────────────────────────────

/**
 * Apply hunks to original content and return the preview.
 * Hunks with status "rejected" are skipped.
 * Hunks with status "modified" use modifiedLines.
 */
export function generatePreview(session: SpeculativeEditSession): EditPreviewResult {
  const originalLines = session.originalContent.split("\n");
  const resultLines: string[] = [...originalLines];

  let linesAdded = 0;
  let linesDeleted = 0;
  let pendingHunks = 0;
  let acceptedHunks = 0;
  let rejectedHunks = 0;
  let offset = 0; // Tracks line number shift as we apply hunks

  // Sort hunks by startLine ascending to apply in order
  const sortedHunks = [...session.hunks].sort((a, b) => a.startLine - b.startLine);

  for (const hunk of sortedHunks) {
    if (hunk.status === "rejected") { rejectedHunks++; continue; }
    if (hunk.status === "pending") { pendingHunks++; }
    if (hunk.status === "accepted" || hunk.status === "modified") { acceptedHunks++; }

    const replacementLines = hunk.status === "modified" ? (hunk.modifiedLines ?? hunk.proposedLines) : hunk.proposedLines;
    const startIdx = hunk.startLine - 1 + offset;
    const deleteCount = hunk.originalLines.length;

    resultLines.splice(startIdx, deleteCount, ...replacementLines);
    const delta = replacementLines.length - deleteCount;
    offset += delta;
    linesAdded += Math.max(0, delta);
    linesDeleted += Math.max(0, -delta);
  }

  return {
    previewContent: resultLines.join("\n"),
    linesAdded,
    linesDeleted,
    pendingHunks,
    acceptedHunks,
    rejectedHunks,
    conflict: "none",
  };
}

/**
 * Detect conflicts between a session's hunks and a set of "current" file lines
 * that may have diverged from the original content.
 */
export function detectEditConflicts(
  session: SpeculativeEditSession,
  currentContent: string,
): EditConflictType {
  if (currentContent === session.originalContent) return "none";

  const currentLines = currentContent.split("\n");
  const originalLines = session.originalContent.split("\n");

  if (currentLines.length !== originalLines.length) return "stale-content";

  const mismatchedLines = currentLines.filter((l, i) => l !== originalLines[i]).length;
  if (mismatchedLines > 3) return "merge-conflict";
  if (mismatchedLines > 0) return "stale-content";

  return "none";
}

// ─── Edit Description ─────────────────────────────────────────────────────────

/**
 * Generate a human-readable description of what a hunk changes.
 */
export function describeHunk(hunk: EditHunk): string {
  if (hunk.rationale) return hunk.rationale;

  const orig = hunk.originalLines.length;
  const prop = hunk.proposedLines.length;

  if (orig === 0 && prop > 0) return `Add ${prop} line${prop !== 1 ? "s" : ""} at line ${hunk.startLine}`;
  if (orig > 0 && prop === 0) return `Delete ${orig} line${orig !== 1 ? "s" : ""} at line ${hunk.startLine}`;
  if (orig === 1 && prop === 1) return `Modify line ${hunk.startLine}`;
  if (orig === prop) return `Replace ${orig} line${orig !== 1 ? "s" : ""} starting at ${hunk.startLine}`;
  return `Rewrite ${orig}→${prop} lines at ${hunk.startLine}–${hunk.endLine}`;
}

/**
 * Format the preview result as a human-readable diff summary for AI prompt injection.
 */
export function formatPreviewForPrompt(session: SpeculativeEditSession, preview: EditPreviewResult): string {
  const lines = [
    `## Edit Preview — ${session.filePath}`,
    `Status: ${preview.acceptedHunks} accepted | ${preview.pendingHunks} pending | ${preview.rejectedHunks} rejected`,
    `Change: +${preview.linesAdded}/-${preview.linesDeleted} lines`,
    preview.conflict !== "none" ? `⚠️ Conflict: ${preview.conflict}` : null,
    ``,
    `### Hunks`,
  ];

  for (const hunk of session.hunks) {
    const icon = { pending: "⬜", accepted: "✅", rejected: "❌", modified: "✏️" }[hunk.status];
    const desc = describeHunk(hunk);
    const conf = `${Math.round(hunk.confidence * 100)}%`;
    lines.push(`${icon} [${hunk.id}] ${desc} (confidence: ${conf})`);
  }

  return lines.filter((l): l is string => l !== null).join("\n");
}

// ─── Session Manager ──────────────────────────────────────────────────────────

let _sessionCounter = 0;

export class SpeculativeEditManager {
  private _sessions = new Map<string, SpeculativeEditSession>();
  private _chains = new Map<string, EditChainEntry[]>();

  createSession(
    filePath: string,
    originalContent: string,
    hunks: EditHunk[],
    source?: string,
  ): SpeculativeEditSession {
    const id = `edit-session-${++_sessionCounter}`;
    const now = new Date().toISOString();
    const session: SpeculativeEditSession = {
      id,
      filePath,
      originalContent,
      hunks: hunks.map((h) => ({ ...h, confidence: scoreHunkConfidence(h) })),
      createdAt: now,
      updatedAt: now,
      status: "active",
      source,
    };
    this._sessions.set(id, session);
    this._chains.set(id, []);
    return session;
  }

  acceptHunk(sessionId: string, hunkId: string): boolean {
    return this._updateHunkStatus(sessionId, hunkId, "accepted");
  }

  rejectHunk(sessionId: string, hunkId: string): boolean {
    return this._updateHunkStatus(sessionId, hunkId, "rejected");
  }

  modifyHunk(sessionId: string, hunkId: string, modifiedLines: string[]): boolean {
    const session = this._sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    const hunk = session.hunks.find((h) => h.id === hunkId);
    if (!hunk) return false;
    const prev = hunk.status;
    hunk.status = "modified";
    hunk.modifiedLines = modifiedLines;
    session.updatedAt = new Date().toISOString();
    this._chains.get(sessionId)?.push({ sessionId, hunkId, action: "modify", timestamp: session.updatedAt, previousStatus: prev });
    return true;
  }

  acceptAll(sessionId: string): number {
    const session = this._sessions.get(sessionId);
    if (!session || session.status !== "active") return 0;
    let count = 0;
    for (const hunk of session.hunks) {
      if (hunk.status === "pending") { hunk.status = "accepted"; count++; }
    }
    if (count > 0) session.updatedAt = new Date().toISOString();
    return count;
  }

  rejectAll(sessionId: string): number {
    const session = this._sessions.get(sessionId);
    if (!session || session.status !== "active") return 0;
    let count = 0;
    for (const hunk of session.hunks) {
      if (hunk.status === "pending") { hunk.status = "rejected"; count++; }
    }
    if (count > 0) session.updatedAt = new Date().toISOString();
    return count;
  }

  private _updateHunkStatus(sessionId: string, hunkId: string, status: EditHunkStatus): boolean {
    const session = this._sessions.get(sessionId);
    if (!session || session.status !== "active") return false;
    const hunk = session.hunks.find((h) => h.id === hunkId);
    if (!hunk) return false;
    const prev = hunk.status;
    hunk.status = status;
    session.updatedAt = new Date().toISOString();
    const action = status === "accepted" ? "accept" : "reject";
    this._chains.get(sessionId)?.push({ sessionId, hunkId, action, timestamp: session.updatedAt, previousStatus: prev });
    return true;
  }

  /**
   * Undo the last action in the edit chain.
   */
  undoLast(sessionId: string): boolean {
    const chain = this._chains.get(sessionId);
    const session = this._sessions.get(sessionId);
    if (!chain || !session || chain.length === 0) return false;
    const last = chain.pop()!;
    const hunk = session.hunks.find((h) => h.id === last.hunkId);
    if (!hunk) return false;
    hunk.status = last.previousStatus;
    if (last.action === "modify") hunk.modifiedLines = undefined;
    session.updatedAt = new Date().toISOString();
    return true;
  }

  getPreview(sessionId: string): EditPreviewResult | undefined {
    const session = this._sessions.get(sessionId);
    if (!session) return undefined;
    return generatePreview(session);
  }

  commit(sessionId: string): string | undefined {
    const session = this._sessions.get(sessionId);
    if (!session || session.status !== "active") return undefined;
    const preview = generatePreview(session);
    session.status = "committed";
    session.updatedAt = new Date().toISOString();
    return preview.previewContent;
  }

  abandon(sessionId: string): boolean {
    const session = this._sessions.get(sessionId);
    if (!session) return false;
    session.status = "abandoned";
    return true;
  }

  getSession(id: string): SpeculativeEditSession | undefined {
    return this._sessions.get(id);
  }

  getChain(sessionId: string): EditChainEntry[] {
    return this._chains.get(sessionId) ?? [];
  }

  get activeSessions(): SpeculativeEditSession[] {
    return [...this._sessions.values()].filter((s) => s.status === "active");
  }

  get totalSessions(): number { return this._sessions.size; }
}
