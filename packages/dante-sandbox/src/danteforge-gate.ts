// ============================================================================
// @dantecode/dante-sandbox — DanteForge Gate
// Mandatory pre-execution safety scorer. Every execution request is scored
// before the isolation layer runs it. Blocks critical/high-risk commands.
// Falls back to policy-engine scoring when DanteForge binary is unavailable.
// ============================================================================

import type { GateFn, ExecutionRequest, SandboxDecision } from "./types.js";
import { evaluatePolicy, buildDecision, buildBlockDecision } from "./policy-engine.js";
import { isDockerAvailable, isWorktreeAvailable } from "./capability-check.js";

// ─── Safety Thresholds ────────────────────────────────────────────────────────

const BLOCK_PATTERNS = [
  // Destructive filesystem operations
  /rm\s+-rf\s+\/(?:\s|$)/i,
  /rm\s+-rf\s+~(?:\s|$)/i,
  /mkfs/i,
  /dd\s+if=/i,
  // Fork bomb (flexible whitespace)
  /:\s*\(\s*\)\s*\{.*:\s*\|.*:.*&.*\}/,
  // System control
  /\b(?:shutdown|reboot|halt|poweroff)\b/i,
  // Privilege escalation attempts
  /sudo\s+su\b/i,
  /sudo\s+-s\b/i,
];

const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /curl\s+.*\|\s*(?:sh|bash)/i,
  /wget\s+.*\|\s*(?:sh|bash)/i,
  /eval\s+\$\(/i,
  /git\s+push\s+--force/i,
  /git\s+reset\s+--hard/i,
  /chmod\s+-R\s+777/i,
];

// ─── Gate Implementation ──────────────────────────────────────────────────────

/**
 * Builds a DanteForge gate function using the built-in policy engine.
 * When DanteForge binary scoring is available in the future, this is
 * where the external call would be inserted.
 */
export function buildDanteForgeGate(): GateFn {
  return async (request: ExecutionRequest): Promise<SandboxDecision> => {
    const cmd = request.command;

    // Hard block: critical patterns bypass all other checks
    for (const pattern of BLOCK_PATTERNS) {
      if (pattern.test(cmd)) {
        const strategy = await resolveStrategy();
        return buildBlockDecision(
          request.id,
          `DanteForge gate: blocked critical command pattern (${pattern.source})`,
          strategy,
        );
      }
    }

    // Score dangerous patterns — may warn but not always block
    let safetyScore = 1.0;
    const warnings: string[] = [];
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        safetyScore -= 0.25;
        warnings.push(`dangerous pattern: ${pattern.source}`);
      }
    }
    safetyScore = Math.max(0, safetyScore);

    // Policy engine provides the base risk classification
    const policy = evaluatePolicy(request);
    const strategy = await resolveStrategy();

    if (!policy.allow || safetyScore < 0.1) {
      return buildBlockDecision(
        request.id,
        warnings.length > 0
          ? `DanteForge gate blocked: ${warnings.join("; ")}`
          : policy.reason,
        strategy,
      );
    }

    const decision = buildDecision(request.id, policy, strategy);
    return {
      ...decision,
      gateScore: safetyScore,
      gateVerdict: safetyScore < 0.5 ? "warn" : decision.gateVerdict,
      reason: warnings.length > 0
        ? `DanteForge gate: ${warnings.join("; ")}`
        : decision.reason,
    };
  };
}

async function resolveStrategy(): Promise<"docker" | "worktree" | "host" | "mock"> {
  if (await isDockerAvailable()) return "docker";
  if (await isWorktreeAvailable()) return "worktree";
  return "host";
}

/** A permissive gate for trusted/test environments (mock mode). */
export const permissiveGate: GateFn = async (request) => {
  const policy = evaluatePolicy(request);
  return {
    requestId: request.id,
    allow: policy.allow,
    strategy: "mock",
    reason: policy.reason,
    riskLevel: policy.riskLevel,
    gateVerdict: policy.allow ? "allow" : "block",
    requiresConfirmation: false,
    gateScore: 1.0,
    at: new Date().toISOString(),
  };
};
