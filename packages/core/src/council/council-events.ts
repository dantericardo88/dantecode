// ============================================================================
// @dantecode/core — Council Event Types
// Event constants and payload contracts for the Council Orchestrator.
// Integrates with the existing DanteEventEngine (event-engine.ts).
// ============================================================================

import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Event type union
// ----------------------------------------------------------------------------

export type CouncilEventType =
  | "council:start"
  | "council:lane-assigned"
  | "council:lane-progress"
  | "council:lane-frozen"
  | "council:lane-thawed"
  | "council:lane-completed"
  | "council:lane-failed"
  | "council:overlap-detected"
  | "council:handoff-created"
  | "council:handoff-consumed"
  | "council:merge-started"
  | "council:merge-completed"
  | "council:merge-blocked"
  | "council:verify-passed"
  | "council:verify-failed"
  | "council:push-ready"
  | "council:run-completed"
  | "council:run-failed";

// ----------------------------------------------------------------------------
// Payload types
// ----------------------------------------------------------------------------

export interface CouncilStartPayload {
  runId: string;
  repoRoot: string;
  objective: string;
  agentKinds: string[];
}

export interface CouncilLaneAssignedPayload {
  runId: string;
  laneId: string;
  agentKind: string;
  objective: string;
  ownedFiles: string[];
}

export interface CouncilLaneProgressPayload {
  runId: string;
  laneId: string;
  agentKind: string;
  touchedFiles: string[];
  progressSummary?: string;
}

export interface CouncilLaneFrozenPayload {
  runId: string;
  laneId: string;
  reason: string;
  overlapId?: string;
}

export interface CouncilOverlapDetectedPayload {
  runId: string;
  overlapId: string;
  laneA: string;
  laneB: string;
  level: number;
  files: string[];
}

export interface CouncilHandoffPayload {
  runId: string;
  handoffId: string;
  fromLane: string;
  reason: string;
  touchedFiles: string[];
  recommendedNextAgent?: string;
}

export interface CouncilMergePayload {
  runId: string;
  synthesisId: string;
  candidateLanes: string[];
  confidence: string;
  decision: string;
}

export interface CouncilVerifyPayload {
  runId: string;
  synthesisId: string;
  passed: boolean;
  gateResults: Record<string, boolean>;
}

export interface CouncilRunCompletedPayload {
  runId: string;
  commitHash?: string;
  prUrl?: string;
  verificationPassed: boolean;
}

// ----------------------------------------------------------------------------
// Event factory
// ----------------------------------------------------------------------------

export interface CouncilEvent<T = unknown> {
  id: string;
  type: CouncilEventType;
  payload: T;
  timestamp: string;
  /** Human-readable description for audit logs. */
  description: string;
}

export function createCouncilEvent<T>(
  type: CouncilEventType,
  payload: T,
  description: string,
): CouncilEvent<T> {
  return {
    id: randomUUID().slice(0, 12),
    type,
    payload,
    timestamp: new Date().toISOString(),
    description,
  };
}

// ----------------------------------------------------------------------------
// Typed factory helpers
// ----------------------------------------------------------------------------

export function councilStartEvent(payload: CouncilStartPayload): CouncilEvent<CouncilStartPayload> {
  return createCouncilEvent(
    "council:start",
    payload,
    `Council run ${payload.runId} started: ${payload.objective}`,
  );
}

export function laneAssignedEvent(
  payload: CouncilLaneAssignedPayload,
): CouncilEvent<CouncilLaneAssignedPayload> {
  return createCouncilEvent(
    "council:lane-assigned",
    payload,
    `Lane ${payload.laneId} assigned to ${payload.agentKind}`,
  );
}

export function laneFrozenEvent(
  payload: CouncilLaneFrozenPayload,
): CouncilEvent<CouncilLaneFrozenPayload> {
  return createCouncilEvent(
    "council:lane-frozen",
    payload,
    `Lane ${payload.laneId} frozen: ${payload.reason}`,
  );
}

export function overlapDetectedEvent(
  payload: CouncilOverlapDetectedPayload,
): CouncilEvent<CouncilOverlapDetectedPayload> {
  return createCouncilEvent(
    "council:overlap-detected",
    payload,
    `L${payload.level} overlap between ${payload.laneA} and ${payload.laneB} on files: ${payload.files.join(", ")}`,
  );
}

export function handoffCreatedEvent(
  payload: CouncilHandoffPayload,
): CouncilEvent<CouncilHandoffPayload> {
  return createCouncilEvent(
    "council:handoff-created",
    payload,
    `Handoff ${payload.handoffId} created for lane ${payload.fromLane}: ${payload.reason}`,
  );
}

export function mergeCompletedEvent(
  payload: CouncilMergePayload,
): CouncilEvent<CouncilMergePayload> {
  return createCouncilEvent(
    "council:merge-completed",
    payload,
    `Merge ${payload.synthesisId} completed with ${payload.confidence} confidence → ${payload.decision}`,
  );
}

export function mergeBlockedEvent(payload: CouncilMergePayload): CouncilEvent<CouncilMergePayload> {
  return createCouncilEvent(
    "council:merge-blocked",
    payload,
    `Merge ${payload.synthesisId} blocked — ${payload.decision}`,
  );
}
