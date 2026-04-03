/**
 * triggers.ts
 *
 * Trigger Detector — detects when the Gaslight engine should activate.
 * Four channels: explicit-user, verification, policy, audit.
 */

import type { GaslightConfig, GaslightTrigger } from "./types.js";

// Patterns for explicit user triggers
const EXPLICIT_PATTERNS: RegExp[] = [
  /\bgo\s+deeper\b/i,
  /\bagain\s+but\s+better\b/i,
  /\btruth\s+mode\b/i,
  /\bis\s+this\s+really\s+your\s+best\b/i,
  /\bdo\s+better\b/i,
  /\bimprove\s+this\b/i,
  /\/gaslight\s+on\b/i,
  /\bchallenge\s+this\b/i,
  /\bre-?think\s+this\b/i,
  /\brefine\s+this\b/i,
];

/**
 * Detect if a user message contains an explicit gaslight trigger.
 */
export function detectExplicitTrigger(
  message: string,
  config: GaslightConfig,
  sessionId?: string,
): GaslightTrigger | null {
  if (!config.enabled) return null;

  for (const pattern of EXPLICIT_PATTERNS) {
    const match = message.match(pattern);
    if (match) {
      return {
        channel: "explicit-user",
        phrase: match[0],
        sessionId,
        at: new Date().toISOString(),
      };
    }
  }
  return null;
}

/**
 * Detect if a verification score is below the auto-trigger threshold.
 */
export function detectVerificationTrigger(
  score: number,
  config: GaslightConfig,
  sessionId?: string,
): GaslightTrigger | null {
  if (!config.enabled) return null;
  if (config.autoTriggerThreshold <= 0) return null;
  if (score >= config.autoTriggerThreshold) return null;

  return {
    channel: "verification",
    score,
    sessionId,
    at: new Date().toISOString(),
  };
}

/**
 * Detect if a task class policy allows auto-trigger.
 */
export function detectPolicyTrigger(
  taskClass: string,
  config: GaslightConfig,
  sessionId?: string,
): GaslightTrigger | null {
  if (!config.enabled) return null;
  if (!config.policyTaskClasses.includes(taskClass)) return null;

  return {
    channel: "policy",
    taskClass,
    sessionId,
    at: new Date().toISOString(),
  };
}

/**
 * Randomly trigger for audit sampling.
 */
export function detectAuditTrigger(
  config: GaslightConfig,
  sessionId?: string,
  randomFn: () => number = Math.random,
): GaslightTrigger | null {
  if (!config.enabled) return null;
  if (config.auditRate <= 0) return null;
  if (randomFn() >= config.auditRate) return null;

  return {
    channel: "audit",
    sessionId,
    at: new Date().toISOString(),
  };
}

/**
 * Run all trigger detectors and return the first that fires.
 */
export function detectTrigger(opts: {
  message?: string;
  verificationScore?: number;
  taskClass?: string;
  config: GaslightConfig;
  sessionId?: string;
  randomFn?: () => number;
}): GaslightTrigger | null {
  const { message, verificationScore, taskClass, config, sessionId, randomFn } = opts;

  if (message) {
    const t = detectExplicitTrigger(message, config, sessionId);
    if (t) return t;
  }

  if (verificationScore !== undefined) {
    const t = detectVerificationTrigger(verificationScore, config, sessionId);
    if (t) return t;
  }

  if (taskClass) {
    const t = detectPolicyTrigger(taskClass, config, sessionId);
    if (t) return t;
  }

  return detectAuditTrigger(config, sessionId, randomFn);
}
