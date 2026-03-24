// ============================================================================
// @dantecode/core — Skill Wave Orchestrator
// Parses skill instructions into discrete waves, feeds one wave at a time to
// the model, and enforces verification gates between waves. This makes any
// model (Grok, GPT, etc.) follow Claude's natural step-by-step workflow.
// ============================================================================

import type { CompletionExpectation } from "./completion-verifier.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * Warnings produced when activating a skill via the SkillBridge adapter.
 * Surfaced in the wave prompt preamble for non-green skills.
 */
export interface BridgeActivationWarnings {
  /** The skill name for display. */
  skillName: string;
  /** Conversion quality bucket: green = fully compatible, amber = warnings, red = blocked. */
  bucket: "green" | "amber" | "red";
  /** Numeric conversion score (0–1). */
  conversionScore: number;
  /** Runtime capability gaps detected (e.g., "needs shell", "needs browser"). */
  runtimeWarnings: string[];
  /** Warnings emitted during conversion (e.g., "check MCP config"). */
  conversionWarnings: string[];
  /** Whether any capability gaps were found. */
  hasCapabilityGaps: boolean;
}

/** A single decomposed wave from a skill's instructions. */
export interface SkillWave {
  /** 1-based wave number. */
  number: number;
  /** Short title describing this wave (from heading or generated). */
  title: string;
  /** The full instructions for this wave. */
  instructions: string;
  /** Optional filesystem expectations for wave completion verification. */
  expectations?: CompletionExpectation;
}

/** Tracks wave progression through a skill execution. */
export interface WaveOrchestratorState {
  /** All parsed waves. */
  waves: SkillWave[];
  /** Index of the current wave (0-based). */
  currentIndex: number;
  /** Wave numbers that have been completed. */
  completedWaves: number[];
  /** How many times each wave has been attempted (wave number → count). */
  attempts: Record<number, number>;
  /** Maximum retry attempts per wave before skipping. */
  maxRetries: number;
}

// ----------------------------------------------------------------------------
// Wave Parsing
// ----------------------------------------------------------------------------

/** Regex that splits on wave-like headings in markdown. */
const WAVE_SPLIT_RE = /^(#{1,4}\s*(?:Wave|Step|Phase)\s+\d+\s*[:\u2014\u2013-]\s*.+)$/gim;

/**
 * Parses skill instructions into discrete waves.
 *
 * Tries to detect wave/step/phase markers in the markdown. If none are found,
 * falls back to splitting on H2 headings. If still no structure, returns the
 * entire instruction block as a single wave.
 *
 * @param instructions - The full skill instruction text (markdown).
 * @returns Array of parsed waves (always at least one).
 */
export function parseSkillWaves(instructions: string): SkillWave[] {
  // Strategy 1: Explicit Wave/Step/Phase markers
  const waveMarkers = [...instructions.matchAll(WAVE_SPLIT_RE)];
  if (waveMarkers.length >= 2) {
    return splitByMarkers(instructions, waveMarkers);
  }

  // Strategy 2: H2 headings (## Title)
  const h2Markers = [...instructions.matchAll(/^(##\s+.+)$/gm)];
  if (h2Markers.length >= 2) {
    return splitByMarkers(instructions, h2Markers);
  }

  // Strategy 3: Numbered top-level sections (1. Title, 2. Title)
  const numberedMarkers = [...instructions.matchAll(/^(\d+\.\s+\S.+)$/gm)];
  if (numberedMarkers.length >= 2) {
    return splitByMarkers(instructions, numberedMarkers);
  }

  // Fallback: single wave with all instructions
  return [
    {
      number: 1,
      title: "Full Execution",
      instructions: instructions.trim(),
    },
  ];
}

/**
 * Splits instruction text by detected markers into waves.
 */
function splitByMarkers(instructions: string, markers: RegExpMatchArray[]): SkillWave[] {
  const waves: SkillWave[] = [];

  // Check if there's content before the first marker (preamble)
  const firstMarkerIndex = markers[0]!.index!;
  const preamble = instructions.slice(0, firstMarkerIndex).trim();

  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!;
    const markerText = marker[0]!;
    const start = marker.index! + markerText.length;
    const end = i + 1 < markers.length ? markers[i + 1]!.index! : instructions.length;
    const body = instructions.slice(start, end).trim();

    // Extract title from marker (strip heading markers like ## or "Wave 1:")
    const title = extractTitle(markerText);

    // For the first wave, prepend any preamble content
    const fullInstructions = i === 0 && preamble.length > 0 ? `${preamble}\n\n${body}` : body;

    waves.push({
      number: i + 1,
      title,
      instructions: fullInstructions,
    });
  }

  return waves;
}

/**
 * Extracts a clean title from a heading marker string.
 */
function extractTitle(marker: string): string {
  return (
    marker
      .replace(/^#+\s*/, "") // Strip heading hashes
      .replace(/^\d+\.\s*/, "") // Strip numbered list prefix
      .replace(/^(?:Wave|Step|Phase)\s+\d+\s*[:\u2014\u2013-]\s*/i, "") // Strip Wave/Step/Phase prefix
      .trim() || "Untitled"
  );
}

// ----------------------------------------------------------------------------
// State Management
// ----------------------------------------------------------------------------

/**
 * Creates a fresh orchestrator state from parsed waves.
 */
export function createWaveState(waves: SkillWave[], maxRetries = 2): WaveOrchestratorState {
  return {
    waves,
    currentIndex: 0,
    completedWaves: [],
    attempts: Object.fromEntries(waves.map((w) => [w.number, 0])),
    maxRetries,
  };
}

/**
 * Returns the current wave, or null if all waves are complete.
 */
export function getCurrentWave(state: WaveOrchestratorState): SkillWave | null {
  if (state.currentIndex >= state.waves.length) {
    return null;
  }
  return state.waves[state.currentIndex]!;
}

/**
 * Advances to the next wave. Returns true if there are more waves, false if done.
 */
export function advanceWave(state: WaveOrchestratorState): boolean {
  const current = getCurrentWave(state);
  if (!current) return false;

  state.completedWaves.push(current.number);
  state.currentIndex++;
  return state.currentIndex < state.waves.length;
}

/**
 * Records a failed attempt for the current wave.
 * Returns true if retries remain, false if max retries exceeded (should skip).
 */
export function recordWaveFailure(state: WaveOrchestratorState): boolean {
  const current = getCurrentWave(state);
  if (!current) return false;

  const attempts = (state.attempts[current.number] ?? 0) + 1;
  state.attempts[current.number] = attempts;
  return attempts < state.maxRetries;
}

// ----------------------------------------------------------------------------
// Bridge Warning Helpers
// ----------------------------------------------------------------------------

/**
 * Returns true when the runtimeWarnings array has at least one entry.
 */
export function hasBridgeCapabilityGaps(runtimeWarnings: string[]): boolean {
  return runtimeWarnings.length > 0;
}

/**
 * Builds a markdown preamble block for skills converted via SkillBridge that
 * have amber or red quality buckets. Returns an empty string for green skills.
 */
export function buildBridgeWarningPreamble(warnings: BridgeActivationWarnings): string {
  if (warnings.bucket === "green" && !warnings.hasCapabilityGaps) {
    return "";
  }

  const lines: string[] = ["## SkillBridge Activation Notice", ""];

  if (warnings.bucket === "red") {
    lines.push(
      "> BLOCKED: This skill was classified as BLOCKED during conversion. Manual review is",
      "> required before execution. Proceed with caution.",
      "",
    );
  } else {
    lines.push(
      "> WARNING: This skill was converted with warnings. Some features may behave differently",
      "> than in the original environment.",
      "",
    );
  }

  if (warnings.runtimeWarnings.length > 0) {
    lines.push("**Runtime capability gaps:**");
    for (const w of warnings.runtimeWarnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  if (warnings.conversionWarnings.length > 0) {
    lines.push("**Conversion warnings:**");
    for (const w of warnings.conversionWarnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  lines.push("---\n");

  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// Prompt Building
// ----------------------------------------------------------------------------

/**
 * Claude Workflow Mode — the core prompt that makes any model behave like Claude.
 * Injected into the system prompt when wave orchestration is active.
 */
export const CLAUDE_WORKFLOW_MODE = [
  "## Claude Workflow Mode — ACTIVE",
  "",
  "You are executing a skill in Claude Workflow Mode. This means you follow",
  "the exact same disciplined workflow that Claude uses naturally:",
  "",
  "### Mandatory Workflow (every wave):",
  "1. **Read full file** before any edit — use Read tool, never guess content",
  "2. **Surgical Edit** — use Edit tool for targeted changes, NEVER Write to rewrite existing files",
  "3. **Verify after each edit** — Read the file again OR run tests/typecheck",
  "4. **One concern per edit** — don't batch unrelated changes",
  "5. **Evidence, not narration** — only claim success after tool results confirm it",
  "",
  "### Wave Execution Rules:",
  "- You will receive ONE wave at a time. Complete it fully before requesting the next.",
  "- Every response MUST include at least one tool call. Text-only responses are rejected.",
  "- When the wave is complete, end your response with: `[WAVE COMPLETE]`",
  "- Do NOT summarize, do NOT skip ahead, do NOT claim future waves are done.",
  "",
  "### Tool Recipes (use these via Bash when needed):",
  '- GitHub search: `gh search repos "query" --limit 10 --json name,url,description,stargazersCount`',
  "- Web fetch: `curl -sL 'url' | head -200`",
  "- Clone repo: `git clone --depth 1 'url' /tmp/oss-scan/name`",
  "- GitHub API: `gh api 'search/repositories?q=query' --jq '.items[:5] | .[].full_name'`",
  "",
].join("\n");

/**
 * Builds the prompt injection for the current wave.
 * Includes: wave context, current wave instructions, workflow rules.
 */
export function buildWavePrompt(
  state: WaveOrchestratorState,
  bridgeWarnings?: BridgeActivationWarnings,
): string {
  const current = getCurrentWave(state);
  if (!current) {
    return "All waves complete. Summarize what was accomplished.";
  }

  // Inject bridge warning preamble on first wave only if bridge skill
  const bridgePreamble =
    bridgeWarnings && state.currentIndex === 0 ? buildBridgeWarningPreamble(bridgeWarnings) : "";

  const progress = state.completedWaves.length;
  const total = state.waves.length;
  const attempt = state.attempts[current.number] ?? 0;

  const parts: string[] = [`## Current Wave: ${current.number}/${total} — ${current.title}`, ""];

  if (progress > 0) {
    const completed = state.completedWaves
      .map((n) => {
        const w = state.waves.find((w) => w.number === n);
        return w ? `  - Wave ${n}: ${w.title}` : `  - Wave ${n}`;
      })
      .join("\n");
    parts.push(`Completed waves:\n${completed}`, "");
  }

  if (attempt > 0) {
    parts.push(
      `> WARNING: This is retry ${attempt + 1}/${state.maxRetries + 1} for this wave.`,
      "> The previous attempt did not pass verification. Fix the issues and try again.",
      "",
    );
  }

  parts.push(
    "### Instructions for this wave:",
    "",
    current.instructions,
    "",
    "---",
    "When this wave is fully complete and verified, end your response with `[WAVE COMPLETE]`.",
    "Do NOT proceed to the next wave — it will be provided automatically.",
  );

  if (bridgePreamble.length > 0) {
    parts.splice(2, 0, bridgePreamble); // insert after header + blank line, before content
  }
  return parts.join("\n");
}

/**
 * Detects if the model's response indicates wave completion.
 */
export const WAVE_COMPLETE_RE = /\[WAVE\s+COMPLETE\]/i;

/**
 * Checks if a model response signals wave completion.
 */
export function isWaveComplete(responseText: string): boolean {
  return WAVE_COMPLETE_RE.test(responseText);
}

/**
 * Validates that [WAVE COMPLETE] appears as a terminal signal, not mid-response.
 * Returns false if there is substantial content (>200 chars) after the signal,
 * which indicates the model mentioned it as part of chain-of-thought, not as
 * a genuine completion signal.
 */
export function isValidWaveCompletion(responseText: string): boolean {
  const match = WAVE_COMPLETE_RE.exec(responseText);
  if (!match) return false;
  const afterSignal = responseText.slice(match.index + match[0].length).trim();
  return afterSignal.length <= 200;
}

// ----------------------------------------------------------------------------
// Wave Completion Verification
// ----------------------------------------------------------------------------

/**
 * Derives filesystem expectations from wave instructions by scanning for
 * file paths mentioned in the instructions text.
 * Extracts paths from: "create/write/generate <path>", backtick-quoted paths with extensions.
 */
export function deriveWaveExpectations(wave: SkillWave): CompletionExpectation {
  const expectedFiles: string[] = [];
  const seen = new Set<string>();

  // Pattern 1: "create/write/generate/add <path>" (with optional quotes/backticks)
  const actionPattern =
    /(?:create|write|generate|add|implement)\s+[`"']?([^\s`"',)]+\.\w{1,8})/gi;
  let match: RegExpExecArray | null;
  while ((match = actionPattern.exec(wave.instructions)) !== null) {
    const file = match[1]!;
    if (!seen.has(file)) {
      seen.add(file);
      expectedFiles.push(file);
    }
  }

  // Pattern 2: backtick-quoted paths with extensions (e.g., `src/utils/helper.ts`)
  const backtickPattern = /`([^`\s]+\.\w{1,8})`/g;
  while ((match = backtickPattern.exec(wave.instructions)) !== null) {
    const file = match[1]!;
    // Filter out obvious non-file patterns
    if (!seen.has(file) && !file.includes("(") && !file.startsWith("http")) {
      seen.add(file);
      expectedFiles.push(file);
    }
  }

  return {
    expectedFiles: expectedFiles.length > 0 ? expectedFiles : undefined,
    intentDescription: wave.title,
  };
}
