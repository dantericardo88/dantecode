// ============================================================================
// Model Adaptation Store — D-12A persistent store for model quirk observations,
// versioned candidate overrides, and experiment results.
// Persists to .dantecode/model-adaptation.json, LRU 200 observations.
// Backward-compatible with D-12 callers until Phase 3.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type {
  QuirkKey,
  QuirkObservation,
  CandidateOverride,
  OverrideStatus,
  ExperimentResult,
  ModelAdaptationSnapshot,
} from "./model-adaptation-types.js";
import { generateId, migrateLegacyQuirkClass } from "./model-adaptation-types.js";
import { ExperimentRateLimiter } from "./model-adaptation-experiment.js";

// Re-exports for backward compat
export type {
  QuirkObservation,
  CandidateOverride,
  ModelAdaptationSnapshot,
} from "./model-adaptation-types.js";
export type { LegacyQuirkClass as QuirkClass } from "./model-adaptation-types.js";
export type { QuirkKey } from "./model-adaptation-types.js";

/** Composite key — kept for detector (model-adaptation.ts) compatibility. */
export interface ModelAdaptationKey {
  provider: string;
  modelId: string;
  workflowType?: string;
  commandType?: string;
}

/** Type-safe draft input for D-12A callers. */
export type D12ADraftInput = Omit<CandidateOverride, "id" | "version" | "status" | "createdAt">;

/** Legacy draft input shape (D-12 callers). */
export interface LegacyDraftInput {
  key: ModelAdaptationKey;
  quirkClass: string;
  payload: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// V1 legacy shapes (disk migration + runtime shim)
// ---------------------------------------------------------------------------

interface LegacyObservation {
  quirkClass: string;
  description: string;
  evidence: string;
  observedAt: string;
  sessionId: string;
}
interface LegacyOverride {
  id: string;
  key: ModelAdaptationKey;
  quirkClass: string;
  quirkSignature: string;
  overrideType: string;
  payload: string;
  version: number;
  evidenceCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  promotionEvidence?: { testsPass: boolean; smokePass: boolean; pdseScore?: number };
}
interface LegacySnapshot {
  observations: LegacyObservation[];
  overrides: LegacyOverride[];
  version: number;
}

// ---------------------------------------------------------------------------
// Migration + detection helpers
// ---------------------------------------------------------------------------

function migrateObservation(old: LegacyObservation): QuirkObservation {
  const quirkKey = migrateLegacyQuirkClass(old.quirkClass) ?? "provider_specific_dispatch_shape";
  return {
    id: generateId("obs"),
    quirkKey,
    provider: "legacy",
    model: "legacy",
    workflow: "other",
    promptTemplateVersion: "legacy",
    failureTags: [old.quirkClass],
    outputCharacteristics: [],
    evidenceRefs: [old.evidence],
    createdAt: old.observedAt,
  };
}

function migrateOverride(old: LegacyOverride): CandidateOverride {
  const quirkKey = migrateLegacyQuirkClass(old.quirkClass) ?? "provider_specific_dispatch_shape";
  const s = old.status as OverrideStatus;
  const validStatus = [
    "draft",
    "testing",
    "awaiting_review",
    "promoted",
    "rejected",
    "rolled_back",
  ].includes(s)
    ? s
    : ("draft" as const);
  return {
    id: old.id,
    provider: old.key.provider,
    model: old.key.modelId,
    quirkKey,
    status: validStatus,
    scope: { workflow: old.key.workflowType, commandName: old.key.commandType },
    patch: { promptPreamble: old.payload },
    basedOnObservationIds: [],
    version: old.version,
    createdAt: old.createdAt,
    promotedAt: old.status === "promoted" ? old.updatedAt : undefined,
    rejectedAt: old.status === "rejected" ? old.updatedAt : undefined,
  };
}

function isLegacyObs(obj: Record<string, unknown>): boolean {
  return typeof obj.quirkClass === "string" && typeof obj.evidence === "string";
}

function legacyObsToV2(old: LegacyObservation): Omit<QuirkObservation, "id" | "createdAt"> {
  const quirkKey = migrateLegacyQuirkClass(old.quirkClass) ?? "provider_specific_dispatch_shape";
  return {
    quirkKey,
    provider: "",
    model: "",
    workflow: "other",
    promptTemplateVersion: "legacy",
    failureTags: [old.quirkClass],
    outputCharacteristics: [],
    evidenceRefs: [old.evidence],
  };
}

function isLegacyDraft(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.quirkClass === "string" &&
    typeof obj.payload === "string" &&
    obj.key !== undefined &&
    typeof (obj.key as Record<string, unknown>).provider === "string"
  );
}

function legacyDraftToV2(
  old: Record<string, unknown>,
): Omit<CandidateOverride, "id" | "version" | "status" | "createdAt"> {
  const key = old.key as ModelAdaptationKey;
  const quirkKey =
    migrateLegacyQuirkClass(old.quirkClass as string) ?? "provider_specific_dispatch_shape";
  return {
    provider: key.provider,
    model: key.modelId,
    quirkKey,
    scope: { workflow: key.workflowType, commandName: key.commandType },
    patch: { promptPreamble: old.payload as string },
    basedOnObservationIds: [],
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ModelAdaptationStore {
  private observations: QuirkObservation[] = [];
  private overrides: CandidateOverride[] = [];
  private experiments: ExperimentResult[] = [];
  private loaded = false;
  private filePath: string;
  private static readonly MAX_OBSERVATIONS = 200;
  private _pendingWrite: Promise<void> = Promise.resolve();
  private _rawParsed: Record<string, unknown> | null = null;
  private _errorLogger?: (error: Error | string) => void;

  constructor(projectRoot: string, errorLogger?: (error: Error | string) => void) {
    this.filePath = join(projectRoot, ".dantecode", "model-adaptation.json");
    this._errorLogger = errorLogger;
  }

  // -- Persistence ----------------------------------------------------------

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf-8"));
      if (parsed.version === 2) {
        const snap = parsed as ModelAdaptationSnapshot;
        if (Array.isArray(snap.observations)) this.observations = snap.observations;
        if (Array.isArray(snap.overrides)) this.overrides = snap.overrides;
        if (Array.isArray(snap.experiments)) this.experiments = snap.experiments;
        this._rawParsed = parsed;
      } else {
        const legacy = parsed as LegacySnapshot;
        this.observations = Array.isArray(legacy.observations)
          ? legacy.observations.map(migrateObservation)
          : [];
        this.overrides = Array.isArray(legacy.overrides)
          ? legacy.overrides.map(migrateOverride)
          : [];
        this.experiments = [];
      }
    } catch {
      this.observations = [];
      this.overrides = [];
      this.experiments = [];
    }
    this.loaded = true;
  }

  /** Force-reload from disk, picking up external changes (e.g. CLI approve/reject). */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.load();
  }

  async save(rateLimiter?: ExperimentRateLimiter): Promise<void> {
    this._pendingWrite = this._pendingWrite
      .then(() => this._doSave(rateLimiter))
      .catch((err) => {
        try {
          this._errorLogger?.(err instanceof Error ? err : new Error(String(err)));
        } catch {
          /* logger itself is non-fatal */
        }
      });
    return this._pendingWrite;
  }

  private async _doSave(rateLimiter?: ExperimentRateLimiter): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const snap: ModelAdaptationSnapshot & {
        rateLimiterState?: Record<string, { date: string; count: number }>;
      } = {
        version: 2,
        observations: this.observations,
        overrides: this.overrides,
        experiments: this.experiments,
      };
      if (rateLimiter) {
        snap.rateLimiterState = rateLimiter.serialize();
      }
      await writeFile(this.filePath, JSON.stringify(snap, null, 2), "utf-8");
    } catch (err) {
      try {
        this._errorLogger?.(err instanceof Error ? err : new Error(String(err)));
      } catch {
        /* logger itself is non-fatal */
      }
    }
  }

  // -- Observations ---------------------------------------------------------

  /** Record a quirk observation (D-12A or legacy shape). LRU-evicts at 200. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addObservation(obs: any): QuirkObservation {
    const raw = obs as Record<string, unknown>;
    const v2 = isLegacyObs(raw)
      ? legacyObsToV2(raw as unknown as LegacyObservation)
      : (obs as Omit<QuirkObservation, "id" | "createdAt">);
    const observation: QuirkObservation = {
      ...v2,
      id: generateId("obs"),
      createdAt: new Date().toISOString(),
    };
    this.observations.push(observation);
    if (this.observations.length > ModelAdaptationStore.MAX_OBSERVATIONS) {
      this.observations = this.observations.slice(-ModelAdaptationStore.MAX_OBSERVATIONS);
    }
    return observation;
  }

  /** Count observations by quirkKey + provider + model. Legacy overload: (quirkClass, ModelAdaptationKey). */
  countObservations(
    quirkKey: string,
    providerOrKey: string | ModelAdaptationKey,
    model?: string,
  ): number {
    const [prov, mod] =
      typeof providerOrKey === "object"
        ? [providerOrKey.provider, providerOrKey.modelId]
        : [providerOrKey, model ?? ""];
    return this.observations.filter((o) => {
      const obs = o as QuirkObservation & Record<string, unknown>;
      const matchesQuirk =
        obs.quirkKey === quirkKey ||
        (Array.isArray(o.failureTags) && o.failureTags.includes(quirkKey));
      if (!matchesQuirk) return false;
      if (o.provider === "" && o.model === "") {
        return (
          Array.isArray(o.evidenceRefs) &&
          o.evidenceRefs.some((r) => r.includes(prov) && r.includes(mod))
        );
      }
      return o.provider === prov && o.model === mod;
    }).length;
  }

  // -- Overrides ------------------------------------------------------------

  /** Get overrides. Accepts (provider, model, status?) OR (ModelAdaptationKey, status?). */
  getOverrides(
    providerOrKey: string | ModelAdaptationKey,
    modelOrStatus?: string | OverrideStatus,
    status?: OverrideStatus,
  ): CandidateOverride[] {
    let prov: string, mod: string, filterStatus: OverrideStatus | undefined;
    if (typeof providerOrKey === "object") {
      prov = providerOrKey.provider;
      mod = providerOrKey.modelId;
      filterStatus = modelOrStatus as OverrideStatus | undefined;
    } else {
      prov = providerOrKey;
      mod = modelOrStatus as string;
      filterStatus = status;
    }
    return this.overrides.filter((o) => {
      if (o.provider !== prov || o.model !== mod) return false;
      return filterStatus === undefined || o.status === filterStatus;
    });
  }

  /** Return only promoted overrides. Accepts (provider, model) OR (ModelAdaptationKey). */
  getActiveOverrides(
    providerOrKey: string | ModelAdaptationKey,
    model?: string,
  ): CandidateOverride[] {
    return typeof providerOrKey === "object"
      ? this.getOverrides(providerOrKey, "promoted" as OverrideStatus)
      : this.getOverrides(providerOrKey, model!, "promoted");
  }

  /** Create a draft override (D-12A or legacy shape). */
  addDraft(draft: D12ADraftInput | LegacyDraftInput | Record<string, unknown>): CandidateOverride {
    const now = new Date().toISOString();
    const legacy = isLegacyDraft(draft);
    const v2 = legacy
      ? legacyDraftToV2(draft)
      : (draft as Omit<CandidateOverride, "id" | "version" | "status" | "createdAt">);
    const override = {
      ...(legacy ? draft : {}),
      ...v2,
      id: generateId("ovr"),
      version: 1,
      status: "draft" as const,
      createdAt: now,
    } as CandidateOverride;
    this.overrides.push(override);
    return override;
  }

  /** Transition an override's status. Legacy evidence param accepted but ignored. */
  updateStatus(id: string, status: OverrideStatus, _evidence?: unknown): boolean {
    const override = this.overrides.find((o) => o.id === id);
    if (!override) return false;
    override.status = status;
    if (status === "promoted") override.promotedAt = new Date().toISOString();
    if (status === "rejected") override.rejectedAt = new Date().toISOString();
    return true;
  }

  /** Rollback an override: marks rolled_back, creates new draft with rollbackOfVersion. */
  rollbackOverride(overrideId: string): CandidateOverride | null {
    const original = this.overrides.find((o) => o.id === overrideId);
    if (!original) return null;
    const rolledBackVersion = original.version;
    original.status = "rolled_back";
    const rollback: CandidateOverride = {
      id: generateId("ovr"),
      provider: original.provider,
      model: original.model,
      quirkKey: original.quirkKey,
      status: "draft",
      scope: { ...original.scope },
      patch: { ...original.patch },
      basedOnObservationIds: [...original.basedOnObservationIds],
      version: original.version + 1,
      createdAt: new Date().toISOString(),
      rollbackOfVersion: rolledBackVersion,
    };
    this.overrides.push(rollback);
    return rollback;
  }

  /** Count promoted overrides for a specific quirkKey. */
  getPromotionCount(quirkKey: QuirkKey): number {
    return this.overrides.filter((o) => o.quirkKey === quirkKey && o.status === "promoted").length;
  }

  // -- Experiments ----------------------------------------------------------

  addExperiment(result: ExperimentResult): void {
    this.experiments.push(result);
  }

  getExperiments(overrideId?: string): ExperimentResult[] {
    if (overrideId === undefined) return [...this.experiments];
    return this.experiments.filter((e) => e.overrideId === overrideId);
  }

  getExperimentsByQuirk(quirkKey: QuirkKey): ExperimentResult[] {
    return this.experiments.filter((e) => e.quirkKey === quirkKey);
  }

  // -- Snapshot -------------------------------------------------------------

  snapshot(): ModelAdaptationSnapshot {
    return {
      version: 2,
      observations: [...this.observations],
      overrides: [...this.overrides],
      experiments: [...this.experiments],
    };
  }

  /** Load rate limiter state from the persisted store, if present. */
  loadRateLimiterState(): ExperimentRateLimiter | null {
    if (
      this._rawParsed &&
      typeof this._rawParsed === "object" &&
      "rateLimiterState" in this._rawParsed &&
      this._rawParsed.rateLimiterState &&
      typeof this._rawParsed.rateLimiterState === "object"
    ) {
      return ExperimentRateLimiter.deserialize(
        this._rawParsed.rateLimiterState as Record<string, { date: string; count: number }>,
      );
    }
    return null;
  }
}
