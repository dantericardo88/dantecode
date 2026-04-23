// ============================================================================
// packages/edit-dataset/src/index.ts
// Public API for @dantecode/edit-dataset
// ============================================================================

export type {
  RawCommit,
  RawCommitFile,
  FilePair,
  DiffHunk,
  EditSequenceExample,
  EditHistoryItem,
  AlpacaRecord,
  ChatMLRecord,
} from "./types.js";

export {
  GitHubCommitCollector,
  isQualityCommit,
  type CollectorOptions,
} from "./github-collector.js";

export {
  parseDiffHunks,
  extractContext,
  extractEditSequences,
} from "./edit-extractor.js";

export {
  toAlpacaFormat,
  toChatMLFormat,
  writeJSONL,
  formatAndWrite,
  computeStats,
  type DatasetStats,
} from "./dataset-formatter.js";
