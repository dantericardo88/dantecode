/**
 * types.ts — @dantecode/ux-polish
 *
 * Canonical public type contracts for the DanteCode shared UX/Polish engine.
 * These types are stable surface contracts — all six organs depend on them.
 */

// ---------------------------------------------------------------------------
// Surface type
// ---------------------------------------------------------------------------

/** Which rendering surface a UX call targets. */
export type UXSurface = "cli" | "repl" | "vscode";

// ---------------------------------------------------------------------------
// Organ A — Rich Renderer contracts
// ---------------------------------------------------------------------------

/** Result returned from renderRichOutput(). */
export interface RichRenderResult {
  /** Target surface this was rendered for. */
  surface: UXSurface;
  /** Whether the render succeeded. */
  rendered: boolean;
  /** Theme name active during this render. */
  theme: string;
  /** The rendered string (empty if rendered === false). */
  output: string;
}

/** Layout density for rich rendering. */
export type RenderDensity = "compact" | "normal" | "verbose";

/** Payload types supported by the rich renderer. */
export type RenderPayloadKind =
  | "text"
  | "markdown"
  | "table"
  | "diff"
  | "status"
  | "progress"
  | "error"
  | "success"
  | "warning"
  | "info";

/** Input payload for renderRichOutput(). */
export interface RenderPayload {
  kind: RenderPayloadKind;
  content: string;
  /** Optional structured data (for table/diff kinds). */
  data?: Record<string, unknown>;
}

/** Options for renderRichOutput(). */
export interface RenderOptions {
  /** Rendering density. Default: "normal". */
  density?: RenderDensity;
  /** Whether to use ANSI colors. Default: true. */
  colors?: boolean;
  /** Override active theme for this call. */
  theme?: string;
}

// ---------------------------------------------------------------------------
// Organ B — Progress Orchestrator contracts
// ---------------------------------------------------------------------------

/** Status values for a tracked progress operation. */
export type ProgressStatus = "pending" | "running" | "paused" | "completed" | "failed";

/** State record for a single tracked progress item. */
export interface ProgressState {
  /** Unique identifier for this progress item. */
  id: string;
  /** Human-readable phase label (e.g. "Building", "Testing"). */
  phase: string;
  /** 0–100 completion percentage (optional). */
  progress?: number;
  /** Current lifecycle status. */
  status: ProgressStatus;
  /** Optional detail message shown alongside the status. */
  message?: string;
  /** ISO-8601 timestamp when this item started. */
  startedAt?: string;
  /** ISO-8601 timestamp when this item ended (completed/failed). */
  endedAt?: string;
}

/** Configuration for startProgress(). */
export interface ProgressConfig {
  /** Initial phase label. */
  phase: string;
  /** Initial message. */
  message?: string;
  /** Initial progress percentage (0–100). */
  initialProgress?: number;
}

/** Patch object for updateProgress(). */
export type ProgressPatch = Partial<
  Pick<ProgressState, "phase" | "progress" | "status" | "message">
>;

// ---------------------------------------------------------------------------
// Organ C — Onboarding / Flow Engine contracts
// ---------------------------------------------------------------------------

/** Result of a runOnboardingWizard() call. */
export interface OnboardingResult {
  /** Whether onboarding completed fully. */
  completed: boolean;
  /** Steps that were successfully completed. */
  stepsCompleted: string[];
  /** The next suggested step after completion (or after partial completion). */
  nextSuggestedStep?: string;
}

/** Onboarding step definition. */
export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  /** Whether this step can be skipped. Default: false. */
  skippable?: boolean;
}

/** Context passed to runOnboardingWizard(). */
export interface OnboardingContext {
  /** Whether running in a CI environment (skip interactive prompts). */
  ci?: boolean;
  /** Force re-run even if onboarding was already completed. */
  force?: boolean;
  /** Custom steps to inject (replaces defaults if provided). */
  steps?: OnboardingStep[];
  /** Project root directory. Default: process.cwd(). */
  projectRoot?: string;
}

// ---------------------------------------------------------------------------
// Organ E — Help / Error Intelligence contracts
// ---------------------------------------------------------------------------

/** Result of a formatHelpfulError() call. */
export interface ErrorHelpResult {
  /** Short title for the error (e.g. "TypeScript Error"). */
  title: string;
  /** Human-readable explanation of what happened. */
  explanation: string;
  /** 1–3 actionable next steps. */
  nextSteps: string[];
  /** Optional DanteForge PDSE/confidence hint. */
  confidenceHint?: string;
  /** Whether this error is likely transient (retry may help). */
  transient?: boolean;
}

/** Context passed to formatHelpfulError(). */
export interface ErrorContext {
  /** PDSE score at time of error (0–1). */
  pdseScore?: number;
  /** Which pipeline/command was running. */
  pipeline?: string;
  /** Whether to include verbose stack trace. Default: false. */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Organ D — Theme + Token contracts
// ---------------------------------------------------------------------------

/** Supported built-in theme names. */
export type ThemeName = "default" | "minimal" | "rich" | "matrix" | "ocean";

/** Semantic color roles. */
export interface SemanticColors {
  success: string;
  error: string;
  warning: string;
  info: string;
  progress: string;
  muted: string;
  reset: string;
}

/** Theme definition (resolved tokens). */
export interface ResolvedTheme {
  name: string;
  colors: SemanticColors;
  icons: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Organ F — Preference / UX Memory contracts
// ---------------------------------------------------------------------------

/** Suggestion item returned by getContextualSuggestions(). */
export interface UXSuggestion {
  command: string;
  label: string;
  reason: string;
  priority: "high" | "medium" | "low";
}

/** Context passed to getContextualSuggestions(). */
export interface SuggestionContext {
  pdseScore?: number;
  activeErrors?: string[];
  pipelineState?: "idle" | "running" | "complete" | "failed";
  recentCommands?: string[];
  contextPercent?: number;
  hasUncommittedChanges?: boolean;
  isFirstMessage?: boolean;
  editedFilePaths?: string[];
  currentQuery?: string;
}

/** UX preference keys. */
export interface UXPreferenceRecord {
  theme: ThemeName;
  colors: boolean;
  density: RenderDensity;
  richMode: boolean;
  showPdseInline: boolean;
  showSuggestions: boolean;
  showToolAnnotations: boolean;
  onboardingComplete: boolean;
  accessibilityMode: boolean;
}
