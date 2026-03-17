// ============================================================================
// @dantecode/core — Public API
// ============================================================================

// ─── Model Router ─────────────────────────────────────────────────────────────

export { ModelRouterImpl, shouldContinueLoop } from "./model-router.js";
export type { GenerateOptions, LoopExitReason } from "./model-router.js";

// ─── Providers ────────────────────────────────────────────────────────────────

export {
  buildGrokProvider,
  buildAnthropicProvider,
  buildOpenAIProvider,
  buildOllamaProvider,
  PROVIDER_BUILDERS,
} from "./providers/index.js";
export type { ProviderBuilder } from "./providers/index.js";

// ----------------------------------------------------------------------------
// Runtime Catalog
// ----------------------------------------------------------------------------

export {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  PROVIDER_CATALOG,
  SURFACE_RELEASE_MATRIX,
  getDefaultModelCatalogEntry,
  getModelCatalogEntry,
  getModelsForProvider,
  getProviderCatalogEntry,
  groupCatalogModels,
  inferProviderFromModelId,
  parseModelReference,
} from "./runtime-catalog.js";
export type {
  ModelCatalogEntry,
  ProviderCatalogEntry,
  ProviderSupportTier,
  SurfaceReleaseEntry,
  SurfaceReleaseRing,
} from "./runtime-catalog.js";

// ─── Audit Logger ─────────────────────────────────────────────────────────────

export { appendAuditEvent, readAuditEvents, countAuditEvents } from "./audit.js";
export type { AuditEventInput, ReadAuditOptions } from "./audit.js";

// ─── State Management ─────────────────────────────────────────────────────────

export {
  readStateYaml,
  writeStateYaml,
  initializeState,
  stateYamlExists,
  readOrInitializeState,
  updateStateYaml,
  DanteCodeStateSchema,
} from "./state.js";

// ─── Multi-Agent ───────────────────────────────────────────────────────────────

export {
  MultiAgent,
  type MultiAgentConfig,
  type MultiAgentProgressCallback,
} from "./multi-agent.js";

// ─── Token Counter ───────────────────────────────────────────────────────────

export { estimateTokens, estimateMessageTokens } from "./token-counter.js";

// ─── Session Store ───────────────────────────────────────────────────────────

export { SessionStore } from "./session-store.js";

// ─── Background Agent ────────────────────────────────────────────────────────

export { BackgroundAgentRunner } from "./background-agent.js";
export type { BackgroundProgressCallback, AgentWorkFn } from "./background-agent.js";

// ─── Code Index ──────────────────────────────────────────────────────────────

export { CodeIndex, chunkFile, tokenize } from "./code-index.js";
