// ============================================================================
// packages/edit-dataset/src/types.ts
// Shared types for the edit-sequence dataset collector.
// ============================================================================

/** A raw commit fetched from the GitHub API */
export interface RawCommit {
  sha: string;
  message: string;
  authorName: string;
  authorEmail: string;
  parentCount: number;
  /** Number of files changed */
  filesChanged: number;
  /** Total lines added + deleted */
  totalLines: number;
  /** Changed file entries */
  files: RawCommitFile[];
}

/** One changed file within a commit */
export interface RawCommitFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  additions: number;
  deletions: number;
  patch?: string; // unified diff
  language: string;
}

/** A before/after content pair for a single file in a commit */
export interface FilePair {
  filename: string;
  language: string;
  beforeContent: string;
  afterContent: string;
  patch: string;
}

/** A parsed diff hunk */
export interface DiffHunk {
  startLine: number;   // 1-indexed, in the AFTER file
  endLine: number;     // 1-indexed, inclusive
  oldText: string;
  newText: string;
  context: string;     // 5 surrounding lines (after file)
}

/** One training example: edit history window → next edit */
export interface EditSequenceExample {
  /** Last N edits as context (oldest first) */
  editHistory: EditHistoryItem[];
  /** 5 lines around the most recent edit location (from the after-file) */
  fileContext: string;
  /** Ground truth: the NEXT edit to predict */
  nextEdit: {
    filePath: string;   // basename only
    startLine: number;
    endLine: number;
    diff: string;       // unified diff hunk
  };
}

/** One edit in the history window */
export interface EditHistoryItem {
  filePath: string;   // basename only (privacy)
  startLine: number;
  endLine: number;
  oldText: string;
  newText: string;
  language: string;
}

/** Alpaca training format record */
export interface AlpacaRecord {
  instruction: string;
  input: string;
  output: string;
}

/** ChatML training format record */
export interface ChatMLRecord {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}
