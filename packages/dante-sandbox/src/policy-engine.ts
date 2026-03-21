// ============================================================================
// @dantecode/dante-sandbox — Policy Engine
// Classifies execution requests by risk and enforces blocked-command rules.
// ============================================================================

import type {
  ExecutionRequest,
  RiskLevel,
  GateVerdict,
  SandboxDecision,
  IsolationStrategy,
} from "./types.js";

// ─── Risk Patterns ────────────────────────────────────────────────────────────

type RiskPattern = { pattern: RegExp; risk: RiskLevel; reason: string };

const CRITICAL_PATTERNS: RiskPattern[] = [
  {
    pattern: /rm\s+-rf\s+\/(?:\s|$)/,
    risk: "critical",
    reason: "recursive delete of root filesystem",
  },
  { pattern: /mkfs/, risk: "critical", reason: "filesystem formatting" },
  { pattern: /dd\s+if=/, risk: "critical", reason: "raw disk write" },
  { pattern: /:\s*\(\s*\)\s*\{.*:\s*\|.*:.*&.*\}/, risk: "critical", reason: "fork bomb" },
  { pattern: /shutdown|reboot|halt|poweroff/, risk: "critical", reason: "system shutdown command" },
  { pattern: /chmod\s+-R\s+777\s+\//, risk: "critical", reason: "world-write on root" },
  { pattern: />\s*\/dev\/sd[a-z]/, risk: "critical", reason: "direct disk write" },
];

const HIGH_PATTERNS: RiskPattern[] = [
  { pattern: /rm\s+-rf/, risk: "high", reason: "recursive delete" },
  { pattern: /sudo\s+rm/, risk: "high", reason: "privileged delete" },
  { pattern: /sudo\s+chmod/, risk: "high", reason: "privileged permission change" },
  { pattern: /curl\s+.*\|\s*(?:sh|bash)/, risk: "high", reason: "remote code execution via pipe" },
  { pattern: /wget\s+.*\|\s*(?:sh|bash)/, risk: "high", reason: "remote code execution via pipe" },
  { pattern: /eval\s+\$\(/, risk: "high", reason: "eval with command substitution" },
  { pattern: /git\s+push\s+--force/, risk: "high", reason: "force git push" },
  { pattern: /git\s+reset\s+--hard/, risk: "high", reason: "destructive git reset" },
];

const MEDIUM_PATTERNS: RiskPattern[] = [
  { pattern: /rm\s+-r(?!f)/, risk: "medium", reason: "recursive delete without force" },
  { pattern: /curl|wget|fetch/, risk: "medium", reason: "network request" },
  { pattern: /npm\s+publish|yarn\s+publish/, risk: "medium", reason: "package publishing" },
  { pattern: /git\s+push(?!\s+--force)/, risk: "medium", reason: "git push" },
  { pattern: /docker\s+run/, risk: "medium", reason: "docker container launch" },
  { pattern: /sudo/, risk: "medium", reason: "privileged execution" },
];

// ─── Trusted Task Classes (low risk by class) ────────────────────────────────

const LOW_RISK_TASK_CLASSES = new Set(["read", "grep", "ls", "git-read", "typecheck"]);

// ─── Policy Engine ────────────────────────────────────────────────────────────

export interface PolicyDecision {
  riskLevel: RiskLevel;
  gateVerdict: GateVerdict;
  reason: string;
  allow: boolean;
}

/**
 * Classifies the risk of a command and returns a policy verdict.
 * Does NOT call DanteForge — that's done in the SandboxEngine gate step.
 * This provides the baseline policy before the DanteForge scoring layer.
 */
export function evaluatePolicy(request: ExecutionRequest): PolicyDecision {
  const cmd = request.command.toLowerCase();

  // Critical: always block
  for (const p of CRITICAL_PATTERNS) {
    if (p.pattern.test(cmd)) {
      return {
        riskLevel: "critical",
        gateVerdict: "block",
        reason: `Critical risk: ${p.reason}`,
        allow: false,
      };
    }
  }

  // High: block unless explicit override configured
  for (const p of HIGH_PATTERNS) {
    if (p.pattern.test(cmd)) {
      return {
        riskLevel: "high",
        gateVerdict: "warn",
        reason: `High risk: ${p.reason}`,
        allow: true, // warn but allow — DanteForge gate may block further
      };
    }
  }

  // Medium: warn
  for (const p of MEDIUM_PATTERNS) {
    if (p.pattern.test(cmd)) {
      return {
        riskLevel: "medium",
        gateVerdict: "warn",
        reason: `Medium risk: ${p.reason}`,
        allow: true,
      };
    }
  }

  // Trusted task class → low
  if (LOW_RISK_TASK_CLASSES.has(request.taskType)) {
    return { riskLevel: "low", gateVerdict: "allow", reason: "trusted task class", allow: true };
  }

  return {
    riskLevel: "low",
    gateVerdict: "allow",
    reason: "no policy violations detected",
    allow: true,
  };
}

/**
 * Builds a SandboxDecision from a PolicyDecision.
 * gateScore defaults to 1.0 for allow, 0.0 for block (DanteForge can refine this).
 */
export function buildDecision(
  requestId: string,
  policy: PolicyDecision,
  strategy: IsolationStrategy,
): SandboxDecision {
  return {
    requestId,
    allow: policy.allow,
    strategy,
    reason: policy.reason,
    riskLevel: policy.riskLevel,
    gateVerdict: policy.gateVerdict,
    requiresConfirmation: !policy.allow,
    gateScore: policy.allow ? (policy.riskLevel === "low" ? 1.0 : 0.6) : 0.0,
    at: new Date().toISOString(),
  };
}

/** Returns a block decision (used when DanteForge gate fails). */
export function buildBlockDecision(
  requestId: string,
  reason: string,
  strategy: IsolationStrategy,
): SandboxDecision {
  return {
    requestId,
    allow: false,
    strategy,
    reason,
    riskLevel: "high",
    gateVerdict: "block",
    requiresConfirmation: true,
    gateScore: 0.0,
    at: new Date().toISOString(),
  };
}
