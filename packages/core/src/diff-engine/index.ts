// ============================================================================
// @dantecode/core — Diff Engine
// Aider-style SEARCH/REPLACE parsing with 4-strategy fuzzy matching,
// plus a multi-file session coordinator for pre-apply review.
// ============================================================================

export {
  parseSearchReplaceBlocks,
  applySearchReplaceBlock,
  findNearestLines,
  FUZZY_THRESHOLD,
} from "./search-replace-parser.js";
export type {
  SearchReplaceBlock,
  ParseSearchReplaceResult,
  ApplySearchReplaceResult,
  MatchQuality,
} from "./search-replace-parser.js";

export { MultiFileDiffSession } from "./multi-file-session.js";
export type { SessionBlock, BlockState } from "./multi-file-session.js";
