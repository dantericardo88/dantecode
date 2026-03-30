/**
 * @dantecode/ux-polish
 *
 * Shared UX / Polish engine for DanteCode.
 * Exports the complete public API across all six organs:
 *   A. Rich Renderer
 *   B. Progress Orchestrator
 *   C. Onboarding / Flow Engine
 *   D. Theme + Design Token Engine
 *   E. Help / Error Intelligence Layer
 *   F. Preference / UX Memory Layer
 */

// ---------------------------------------------------------------------------
// Types (re-export all public types)
// ---------------------------------------------------------------------------

export type {
  UXSurface,
  RichRenderResult,
  RenderDensity,
  RenderPayloadKind,
  RenderPayload,
  RenderOptions,
  ProgressStatus,
  ProgressState,
  ProgressConfig,
  ProgressPatch,
  OnboardingResult,
  OnboardingStep,
  OnboardingContext,
  ErrorHelpResult,
  ErrorContext,
  ThemeName,
  SemanticColors,
  ResolvedTheme,
  UXSuggestion,
  SuggestionContext,
  UXPreferenceRecord,
} from "./types.js";

// ---------------------------------------------------------------------------
// Organ D — Theme + Design Token Engine
// ---------------------------------------------------------------------------

export { ThemeEngine, getThemeEngine, resetThemeEngine } from "./theme-engine.js";
export type { ThemeEngineOptions } from "./theme-engine.js";

export { COLOR_TOKENS, NO_COLORS, resolveColors, supportsColor } from "./tokens/color-tokens.js";
export {
  INDENT,
  COLUMN_WIDTH,
  V_PAD,
  indent,
  padOrTruncate,
  hRule,
} from "./tokens/spacing-tokens.js";
export { ICONS_RICH, ICONS_ASCII, resolveIcons, spinnerFrame } from "./tokens/icon-tokens.js";
export type { IconSet } from "./tokens/icon-tokens.js";

// ---------------------------------------------------------------------------
// Organ A — Rich Renderer
// ---------------------------------------------------------------------------

export { RichRenderer, renderRichOutput } from "./rich-renderer.js";
export type { RichRendererOptions } from "./rich-renderer.js";

// ---------------------------------------------------------------------------
// Organ B — Progress Orchestrator
// ---------------------------------------------------------------------------

export {
  ProgressOrchestrator,
  startProgress,
  updateProgress,
  resetProgressOrchestrator,
} from "./progress-orchestrator.js";
export type { ProgressOrchestratorOptions } from "./progress-orchestrator.js";

// ---------------------------------------------------------------------------
// Organ C — Onboarding / Flow Engine
// ---------------------------------------------------------------------------

export {
  OnboardingWizard,
  runOnboardingWizard,
  resetOnboardingWizard,
} from "./onboarding-wizard.js";
export type { OnboardingWizardOptions, StepRunner } from "./onboarding-wizard.js";

export { OnboardingState } from "./preferences/onboarding-state.js";
export type { OnboardingRecord, OnboardingStateOptions } from "./preferences/onboarding-state.js";

// ---------------------------------------------------------------------------
// Organ E — Help / Error Intelligence Layer
// ---------------------------------------------------------------------------

export { HelpEngine, getContextualSuggestions } from "./help-engine.js";
export type { HelpEntry, HelpSearchResult, HelpEngineOptions } from "./help-engine.js";

export { ErrorHelper, formatHelpfulError, classifyErrorMessage } from "./error-helper.js";
export type { ErrorHelperOptions } from "./error-helper.js";

// ---------------------------------------------------------------------------
// Organ F — Preference / UX Memory Layer
// ---------------------------------------------------------------------------

export { UXPreferences, PREFERENCE_DEFAULTS } from "./preferences/ux-preferences.js";
export type { UXPreferencesOptions } from "./preferences/ux-preferences.js";

// ---------------------------------------------------------------------------
// Interactive Components
// ---------------------------------------------------------------------------

export { Spinner, SPINNERS } from "./components/spinner.js";
export type { SpinnerOptions, SpinnerFrames, SpinnerName } from "./components/spinner.js";

export { ToastManager, toasts } from "./components/toast.js";
export type { Toast, ToastOptions, ToastLevel } from "./components/toast.js";

export { showMenu } from "./components/menu.js";
export type { MenuItem, MenuOptions } from "./components/menu.js";

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export { CliSurface } from "./surfaces/cli-surface.js";
export type { CliSurfaceOptions } from "./surfaces/cli-surface.js";

export { ReplSurface } from "./surfaces/repl-surface.js";
export type { ReplSurfaceOptions } from "./surfaces/repl-surface.js";

export { VscodeSurface } from "./surfaces/vscode-surface.js";
export type {
  VscodeSurfaceOptions,
  VscodeMessage,
  VscodeMessageKind,
  StatusBarItem,
} from "./surfaces/vscode-surface.js";

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

export { NavController, STANDARD_BINDINGS } from "./accessibility/keyboard-nav.js";
export type {
  NavKey,
  KeyBinding,
  NavState,
  KeyHandler,
  NavControllerOptions,
} from "./accessibility/keyboard-nav.js";

export {
  ScreenReaderSupport,
  detectScreenReaderMode,
  detectReducedMotion,
} from "./accessibility/screen-reader.js";
export type { ScreenReaderOptions, AccessibleAnnouncement } from "./accessibility/screen-reader.js";

export { ContrastValidator } from "./accessibility/contrast-rules.js";
export type {
  ContrastCheck,
  ContrastReport,
  ContrastValidatorOptions,
} from "./accessibility/contrast-rules.js";

// ---------------------------------------------------------------------------
// Suggestion engine (named re-export for explicit import path)
// ---------------------------------------------------------------------------

export { getContextualSuggestions as getSuggestions } from "./suggestion-engine.js";

// ---------------------------------------------------------------------------
// Integration bridges (G12–G16)
// ---------------------------------------------------------------------------

export {
  ModelRouterBridge,
  getModelRouterBridge,
  resetModelRouterBridge,
} from "./integrations/model-router-bridge.js";
export type {
  RouterCapabilityHint,
  RouterStateSnapshot,
  EnrichedSuggestion,
} from "./integrations/model-router-bridge.js";

export { PdseBridge, getPdseBridge, resetPdseBridge } from "./integrations/pdse-bridge.js";
export type { TrustBand, PdseState, PdseTrustHint } from "./integrations/pdse-bridge.js";

export { CheckpointedProgress } from "./integrations/checkpointer-bridge.js";
export type {
  CheckpointerLike,
  CheckpointedProgressOptions,
} from "./integrations/checkpointer-bridge.js";

export { VscodeBridge } from "./integrations/vscode-bridge.js";
export type {
  StatusBarPart,
  SidebarPanel,
  SidebarItem,
  VscodeBridgeOptions,
} from "./integrations/vscode-bridge.js";

export { SlashCommandBridge } from "./integrations/slash-command-bridge.js";
export type {
  CommandSuggestionItem,
  InlineCompletionHint,
  SlashCommandBridgeOptions,
} from "./integrations/slash-command-bridge.js";

// ---------------------------------------------------------------------------
// Consistency audit harness (G17)
// ---------------------------------------------------------------------------

export { ConsistencyAudit } from "./audit/consistency-audit.js";
export type {
  DriftEntry,
  CrossSurfaceRender,
  AuditReport,
  TokenDriftResult,
} from "./audit/consistency-audit.js";

// ---------------------------------------------------------------------------
// Dogfooding benchmark harness (G18)
// ---------------------------------------------------------------------------

export { UXBenchmark } from "./benchmarks/ux-benchmark.js";
export type {
  BenchmarkResult,
  PreviewFeelScore,
  FlowBenchmarkOptions,
  ErrorRecoveryBenchmarkOptions,
} from "./benchmarks/ux-benchmark.js";

// ---------------------------------------------------------------------------
// Memory Engine bridge (G19)
// ---------------------------------------------------------------------------

export {
  MemoryEnginePreferences,
  getMemoryEnginePreferences,
  resetMemoryEnginePreferences,
} from "./integrations/memory-engine-bridge.js";
export type {
  MemoryOrchestratorLike,
  MemoryEnginePreferencesOptions,
} from "./integrations/memory-engine-bridge.js";

// ---------------------------------------------------------------------------
// DanteTUI surfaces (G20-G23)
// ---------------------------------------------------------------------------

export { StatusBar } from "./surfaces/status-bar.js";
export type { StatusBarState } from "./surfaces/status-bar.js";

export { renderDiff, renderBeforeAfter, highlightLine } from "./surfaces/diff-renderer.js";
export type { DiffRenderOptions, DiffRenderResult } from "./surfaces/diff-renderer.js";

export { renderTokenDashboard } from "./surfaces/token-dashboard.js";
export type { TokenUsageData } from "./surfaces/token-dashboard.js";

export { buildPrompt } from "./surfaces/prompt-builder.js";
export type { PromptBuilderState } from "./surfaces/prompt-builder.js";
