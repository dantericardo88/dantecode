// ============================================================================
// @dantecode/core — Follow-up Suggestions (QwenCode fast-model pattern)
// Generates short follow-up questions after a complete AI response to help
// users continue the conversation naturally.
// ============================================================================

import type { ModelRouterImpl } from "./model-router.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const FOLLOWUP_SYSTEM_PROMPT = [
  "You are a helpful assistant that generates short follow-up questions.",
  "Given an AI response, suggest 2-3 questions the user might ask next.",
  "Rules:",
  "- Each question must be 2-12 words.",
  "- Questions should be concrete and actionable.",
  "- Do not number them or use bullet points in the JSON.",
  'Return ONLY a JSON array of strings, e.g.: ["How do I test this?", "Can you add error handling?"]',
  "If no useful follow-ups exist, return an empty array: []",
].join("\n");

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Truncate the response to a reasonable window for the LLM summarizer.
 * We only need the last ~1500 chars of the response to infer good follow-ups.
 */
function truncateResponse(response: string, maxChars = 1_500): string {
  if (response.length <= maxChars) return response;
  return "..." + response.slice(-maxChars);
}

function parseJsonArray(raw: string): string[] {
  try {
    // Trim markdown code fences if the model wrapped the JSON
    const cleaned = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, 3); // hard cap at 3
    }
  } catch {
    // Malformed JSON — return empty
  }
  return [];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generates follow-up question suggestions for a completed AI response.
 *
 * Only runs when:
 * - conversationTurns >= 2 (at least one exchange has happened)
 * - lastResponse is non-empty
 *
 * Uses a fast model to keep latency low. Returns an empty array on any error
 * so callers never need to handle exceptions.
 *
 * @param lastResponse    The assistant's last full response text.
 * @param conversationTurns  Number of completed user/assistant round-trips.
 * @param router          The ModelRouterImpl to use for generation.
 * @param maxSuggestions  Maximum suggestions to return (default: 3).
 */
export async function generateFollowupSuggestions(
  lastResponse: string,
  conversationTurns: number,
  router: ModelRouterImpl,
  maxSuggestions = 3,
): Promise<string[]> {
  // Gate: only generate after at least 2 turns and when there is content
  if (conversationTurns < 2 || lastResponse.trim().length === 0) {
    return [];
  }

  try {
    const snippet = truncateResponse(lastResponse);
    const userPrompt =
      `Given this AI response, generate ${maxSuggestions} short follow-up questions ` +
      `the user might ask. 2-12 words each. Return as JSON array.\n\nResponse:\n${snippet}`;

    const result = await router.generate(
      [{ role: "user", content: userPrompt }],
      {
        system: FOLLOWUP_SYSTEM_PROMPT,
        maxTokens: 256,
        // Prefer a fast/cheap tier for suggestions
        taskType: "chat",
      },
    );

    const raw = typeof result === "string" ? result : (result as { text?: string }).text ?? "";
    const suggestions = parseJsonArray(raw);
    return suggestions.slice(0, maxSuggestions);
  } catch {
    // Non-critical — never surface errors to callers
    return [];
  }
}
