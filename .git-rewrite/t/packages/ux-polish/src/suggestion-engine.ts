/**
 * suggestion-engine.ts — @dantecode/ux-polish
 *
 * Re-exports the suggestion engine from help-engine.ts for named import.
 * Also provides a SuggestionEngine class wrapper for stateful usage.
 */

export { getContextualSuggestions } from "./help-engine.js";
export type { UXSuggestion, SuggestionContext } from "./types.js";
