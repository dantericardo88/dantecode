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

export { MultiAgent, type MultiAgentConfig } from "./multi-agent.js";
