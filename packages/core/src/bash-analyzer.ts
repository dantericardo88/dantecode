// ============================================================================
// Bash Command Static Analyser — Pattern-Based Pre-Execution Safety Analysis
// (OpenCode pattern: analyse before any shell execution, no tree-sitter dep)
// ============================================================================

import { resolve, isAbsolute } from "node:path";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BashAnalysisResult {
  /** Whether the command is considered safe to run without extra checks. */
  safe: boolean;
  /** Whether explicit user confirmation is required before execution. */
  requiresApproval: boolean;
  /** Human-readable explanation of the risk, if any. */
  reason?: string;
  /** Whether the command accesses paths outside the project root. */
  accessesExternalDirectory: boolean;
  /** List of external absolute paths referenced in the command. */
  externalPaths: string[];
  /** Whether the command is considered destructive (data-loss risk). */
  isDestructive: boolean;
  /** Estimated risk tier. */
  estimatedRiskLevel: "low" | "medium" | "high" | "critical";
}

// ─── Risk pattern sets ────────────────────────────────────────────────────────

/** Commands that are always critical — data loss, exfiltration, or host compromise. */
const CRITICAL_PATTERNS: readonly RegExp[] = [
  // rm -rf / or rm -rf ~
  /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+\/\b/i,
  /\brm\s+(-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+~\b/i,
  // Write to raw block devices
  /\bdd\s+.*\bof=\/dev\//i,
  /\bmkfs\b/i,
  />\s*\/dev\/(s[dh][a-z]|nvme)/i,
  // Fork bomb (allow internal whitespace)
  /:\s*\(\s*\)\s*\{.*:\s*\|.*:.*&.*\}/,
  // SQL catastrophic ops
  /\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b/i,
  // Secret exfiltration via HTTP
  /(?:curl|wget)\s+[^|]*\$(?:HOME|API_KEY|SECRET|TOKEN|PASSWORD|GITHUB_TOKEN|AWS_SECRET)/i,
  // Piping environment to network
  /\benv\b.*\|\s*(?:curl|wget|nc|ncat)\b/i,
  /printenv\s*\|\s*(?:curl|wget|nc|ncat)\b/i,
  // Wipe recent history reset
  /\bgit\s+reset\s+--hard\s+HEAD[~^]/i,
];

/** High-risk patterns — destructive or privileged; require approval. */
const HIGH_PATTERNS: readonly RegExp[] = [
  /\bgit\s+push\s+[^|&;]*--force\b/i,      // git push --force
  /\bgit\s+push\s+[^|&;]*-f\b/i,            // git push -f shorthand
  /\bsudo\b/i,                               // sudo
  /\bsu\s+-\b/i,                             // su - root
  /\bchmod\s+[0-7]*7[0-7][0-7]\s+/i,       // chmod 777
  /\bchown\s+root\b/i,                       // chown root
  /\bgit\s+reset\s+--hard\b/i,             // git reset --hard
  /\bgit\s+clean\s+[^|&;]*-[a-z]*f/i,     // git clean -f
];

/** Medium-risk patterns — network or install; log and note. */
const MEDIUM_PATTERNS: readonly RegExp[] = [
  /\bcurl\b|\bwget\b/i,
  /\bnpm\s+publish\b|\byarn\s+publish\b|\bpnpm\s+publish\b/i,
  /\bdocker\s+(?:run|exec|push)\b/i,
  /\bpip\s+install\b|\bapt(?:-get)?\s+install\b|\bbrew\s+install\b/i,
  /\bssh\b|\bscp\b|\brsync\b/i,
];

// ─── Path extraction ──────────────────────────────────────────────────────────

/** Extract apparent absolute paths from a command string. */
function extractAbsolutePaths(command: string): string[] {
  const matches = command.match(/(?:^|\s)(\/[^\s'";&|<>]+|~\/[^\s'";&|<>]*)/g) ?? [];
  return matches
    .map((m) => m.trim())
    .filter((m) => m.startsWith("/") || m.startsWith("~/"));
}

// ─── Main analyser ────────────────────────────────────────────────────────────

/**
 * Analyse a Bash command for safety, destructiveness, and estimated risk level.
 *
 * Uses pattern-based static analysis (no tree-sitter dependency). This is the
 * same approach used by OpenCode before shell execution. Results are intended
 * to be used as a pre-flight gate — callers decide whether to block, warn, or
 * log to an audit trail.
 *
 * @param command - The raw shell command string.
 * @param projectRoot - Absolute path to the project root. Paths outside this
 *   directory are flagged as external-directory accesses.
 */
export function analyzeBashCommand(
  command: string,
  projectRoot: string,
): BashAnalysisResult {
  const resolvedRoot = isAbsolute(projectRoot) ? projectRoot : resolve(projectRoot);

  // ── Critical check ──────────────────────────────────────────────────────────
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(command)) {
      const externalPaths = extractAbsolutePaths(command).filter(
        (p) => !p.startsWith(resolvedRoot),
      );
      return {
        safe: false,
        requiresApproval: true,
        reason: `Critical-risk pattern matched: ${pattern.toString()}`,
        accessesExternalDirectory: externalPaths.length > 0,
        externalPaths,
        isDestructive: true,
        estimatedRiskLevel: "critical",
      };
    }
  }

  // ── External path detection ─────────────────────────────────────────────────
  const absolutePaths = extractAbsolutePaths(command);
  const externalPaths = absolutePaths.filter(
    (p) => !p.startsWith(resolvedRoot) && p !== resolvedRoot,
  );
  const accessesExternalDirectory = externalPaths.length > 0;

  // ── High-risk check ─────────────────────────────────────────────────────────
  for (const pattern of HIGH_PATTERNS) {
    if (pattern.test(command)) {
      return {
        safe: false,
        requiresApproval: true,
        reason: `High-risk pattern: ${pattern.toString()}`,
        accessesExternalDirectory,
        externalPaths,
        isDestructive: /reset|clean|push.*force/i.test(command),
        estimatedRiskLevel: "high",
      };
    }
  }

  // External path access requires approval regardless of other risk factors
  if (accessesExternalDirectory) {
    return {
      safe: false,
      requiresApproval: true,
      reason: `Command references path(s) outside project root: ${externalPaths.join(", ")}`,
      accessesExternalDirectory: true,
      externalPaths,
      isDestructive: false,
      estimatedRiskLevel: "high",
    };
  }

  // ── Medium-risk check ────────────────────────────────────────────────────────
  for (const pattern of MEDIUM_PATTERNS) {
    if (pattern.test(command)) {
      return {
        safe: true,
        requiresApproval: false,
        reason: `Medium-risk pattern (network/install): ${pattern.toString()}`,
        accessesExternalDirectory: false,
        externalPaths: [],
        isDestructive: false,
        estimatedRiskLevel: "medium",
      };
    }
  }

  // ── Low risk (default) ───────────────────────────────────────────────────────
  return {
    safe: true,
    requiresApproval: false,
    accessesExternalDirectory: false,
    externalPaths: [],
    isDestructive: false,
    estimatedRiskLevel: "low",
  };
}
