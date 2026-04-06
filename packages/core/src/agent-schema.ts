// ============================================================================
// @dantecode/core — Agent Action/Observation Schema
// Typed action/observation schema for DanteCode's agent loop.
// Based on OpenHands' openhands/core/schema/action.py and observation.py.
// ============================================================================

import { randomUUID } from "node:crypto";

// ─── Action Types ─────────────────────────────────────────────────────────────

export type ActionType =
  // Communication
  | "message"
  | "think"
  | "plan"
  // File operations
  | "read"
  | "write"
  | "edit"
  | "search"
  // Execution
  | "bash"
  | "test"
  | "lint"
  // Git
  | "git_commit"
  | "git_push"
  | "git_diff"
  // Agent control
  | "delegate"
  | "finish"
  | "pause"
  | "resume"
  // Memory
  | "recall"
  | "memorize"
  // Loop control
  | "loop_recovery"
  | "continue";

// ─── Observation Types ────────────────────────────────────────────────────────

export type ObservationType =
  | "read_result"
  | "write_result"
  | "edit_result"
  | "search_result"
  | "bash_result"
  | "test_result"
  | "lint_result"
  | "git_result"
  | "delegate_result"
  | "memory_result"
  | "error"
  | "success"
  | "loop_detected";

// ─── Core Interfaces ──────────────────────────────────────────────────────────

export interface AgentAction {
  type: ActionType;
  payload: Record<string, unknown>;
  timestamp: string;
  toolCallId?: string;
  agentId?: string;
}

export interface AgentObservation {
  type: ObservationType;
  /** Which action produced this observation */
  actionType: ActionType;
  payload: Record<string, unknown>;
  success: boolean;
  timestamp: string;
  durationMs?: number;
  tokensUsed?: number;
}

export interface AgentEvent {
  id: string;
  action: AgentAction;
  observation?: AgentObservation;
  /** Monotonically increasing sequence number */
  sequence: number;
}

// ─── Sequence counter (module-level, resets per process) ─────────────────────

let _sequenceCounter = 0;

// ─── Factory Functions ────────────────────────────────────────────────────────

/**
 * Create a new AgentAction with the current timestamp.
 */
export function createAction(
  type: ActionType,
  payload: Record<string, unknown>,
  toolCallId?: string,
): AgentAction {
  return {
    type,
    payload,
    timestamp: new Date().toISOString(),
    ...(toolCallId !== undefined ? { toolCallId } : {}),
  };
}

/**
 * Create a new AgentObservation with the current timestamp.
 */
export function createObservation(
  type: ObservationType,
  actionType: ActionType,
  payload: Record<string, unknown>,
  success: boolean,
  durationMs?: number,
): AgentObservation {
  return {
    type,
    actionType,
    payload,
    success,
    timestamp: new Date().toISOString(),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

/**
 * Create a new AgentEvent, optionally binding an observation.
 * If no sequence is provided, auto-increments the module-level counter.
 */
export function createEvent(
  action: AgentAction,
  observation?: AgentObservation,
  sequence?: number,
): AgentEvent {
  const seq = sequence ?? ++_sequenceCounter;
  return {
    id: randomUUID(),
    action,
    ...(observation !== undefined ? { observation } : {}),
    sequence: seq,
  };
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize an AgentEvent to a JSON string.
 */
export function serializeEvent(event: AgentEvent): string {
  return JSON.stringify(event);
}

/**
 * Deserialize a JSON string back into an AgentEvent.
 * Throws if the string is not valid JSON or missing required fields.
 */
export function deserializeEvent(json: string): AgentEvent {
  const parsed: unknown = JSON.parse(json);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("id" in parsed) ||
    !("action" in parsed) ||
    !("sequence" in parsed)
  ) {
    throw new Error("Invalid AgentEvent JSON: missing required fields (id, action, sequence)");
  }
  return parsed as AgentEvent;
}

// ─── Type Guards ──────────────────────────────────────────────────────────────

/**
 * Returns true if the observation represents a terminal state:
 * - An error observation with success=false, OR
 * - A success observation produced by the "finish" action.
 */
export function isTerminalObservation(obs: AgentObservation): boolean {
  if (obs.type === "error" && !obs.success) return true;
  if (obs.actionType === "finish") return true;
  return false;
}

/**
 * Returns true if the action is potentially destructive (modifies files or git state).
 */
export function isDestructiveAction(action: AgentAction): boolean {
  const destructiveTypes: ActionType[] = ["bash", "write", "edit", "git_commit"];
  return destructiveTypes.includes(action.type);
}
