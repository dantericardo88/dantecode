// ============================================================================
// @dantecode/core — Skill Wave Orchestrator
// Parses skill instructions into discrete waves, feeds one wave at a time to
// the model, and enforces verification gates between waves. This makes any
// model (Grok, GPT, etc.) follow Claude's natural step-by-step workflow.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single decomposed wave from a skill's instructions. */
export interface SkillWave {
  /** 1-based wave number. */
  number: number;
  /** Short title describing this wave (from heading or generated). */
  title: string;
  /** The full instructions for this wave. */
  instructions: string;
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
const WAVE_SPLIT_RE =
  /^(#{1,4}\s*(?:Wave|Step|Phase)\s+\d+\s*[:\u2014\u2013-]\s*.+)$/gim;

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
function splitByMarkers(
  instructions: string,
  markers: RegExpMatchArray[],
): SkillWave[] {
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
    const fullInstructions = i === 0 && preamble.length > 0
      ? `${preamble}\n\n${body}`
      : body;

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
  return marker
    .replace(/^#+\s*/, "")           // Strip heading hashes
    .replace(/^\d+\.\s*/, "")        // Strip numbered list prefix
    .replace(/^(?:Wave|Step|Phase)\s+\d+\s*[:\u2014\u2013-]\s*/i, "") // Strip Wave/Step/Phase prefix
    .trim() || "Untitled";
}

// ----------------------------------------------------------------------------
// State Management
// ----------------------------------------------------------------------------

/**
 * Creates a fresh orchestrator state from parsed waves.
 */
export function createWaveState(
  waves: SkillWave[],
  maxRetries = 2,
): WaveOrchestratorState {
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
  "- GitHub search: `gh search repos \"query\" --limit 10 --json name,url,description,stargazersCount`",
  "- Web fetch: `curl -sL 'url' | head -200`",
  "- Clone repo: `git clone --depth 1 'url' /tmp/oss-scan/name`",
  "- GitHub API: `gh api 'search/repositories?q=query' --jq '.items[:5] | .[].full_name'`",
  "",
].join("\n");

/**
 * Builds the prompt injection for the current wave.
 * Includes: wave context, current wave instructions, workflow rules.
 */
export function buildWavePrompt(state: WaveOrchestratorState): string {
  const current = getCurrentWave(state);
  if (!current) {
    return "All waves complete. Summarize what was accomplished.";
  }

  const progress = state.completedWaves.length;
  const total = state.waves.length;
  const attempt = state.attempts[current.number] ?? 0;

  const parts: string[] = [
    `## Current Wave: ${current.number}/${total} — ${current.title}`,
    "",
  ];

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
