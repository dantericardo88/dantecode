// ============================================================================
// @dantecode/core — Zero-Trust Multi-Layer Security Engine
// Inspired by OpenHands SecurityAnalyzer + E2B sandboxing model.
// Provides multi-layer security checks for agent actions across prompt,
// tool, execution, and output layers. Includes anomaly detection,
// quarantine management, and configurable rule sets.
// ============================================================================

import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Security layer where an action is evaluated. */
export type SecurityLayer = "prompt" | "tool" | "execution" | "output";

/** Risk level assigned to a security finding. */
export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

/** Decision made by the security engine for an action. */
export type ActionDecision = "allow" | "warn" | "block" | "quarantine";

/**
 * An action submitted for security evaluation.
 * Each action belongs to a specific security layer and carries
 * optional content, command, file path, and metadata.
 */
export interface SecurityAction {
  /** The security layer this action belongs to. */
  layer: SecurityLayer;
  /** Tool name (for tool-layer actions). */
  tool?: string;
  /** Shell command (for tool/execution-layer actions). */
  command?: string;
  /** Text content to evaluate (prompt text, output text, etc.). */
  content?: string;
  /** File path being accessed or written to. */
  filePath?: string;
  /** Arbitrary metadata for rule evaluation. */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a security check against an action.
 * Contains the decision, risk level, reasons, and timestamp.
 */
export interface SecurityCheckResult {
  /** The engine's decision for this action. */
  decision: ActionDecision;
  /** The assessed risk level. */
  riskLevel: RiskLevel;
  /** Human-readable reasons for the decision. */
  reasons: string[];
  /** The layer that was evaluated. */
  layer: SecurityLayer;
  /** ISO-8601 timestamp of the check. */
  timestamp: string;
}

/**
 * Result of anomaly detection against recent action history.
 * A score of 0 means fully normal; 1 means highly anomalous.
 */
export interface AnomalyDetectionResult {
  /** Whether the action is considered anomalous. */
  isAnomaly: boolean;
  /** Anomaly score between 0 (normal) and 1 (highly anomalous). */
  score: number;
  /** Human-readable description of the anomaly (or why it is normal). */
  description: string;
}

/**
 * A quarantined action awaiting manual resolution.
 * Quarantine entries are created for high-risk actions that require
 * human review before being allowed to proceed.
 */
export interface QuarantineEntry {
  /** Unique identifier for this quarantine entry. */
  id: string;
  /** The action that was quarantined. */
  action: SecurityAction;
  /** The security check result that triggered quarantine. */
  result: SecurityCheckResult;
  /** ISO-8601 timestamp when the entry was created. */
  timestamp: string;
  /** Whether this entry has been resolved (approved or rejected). */
  resolved: boolean;
}

/**
 * A configurable security rule that matches actions by pattern.
 * Rules are evaluated against the content, command, or file path
 * of an action within their designated layer.
 */
export interface SecurityRule {
  /** Unique identifier for the rule. */
  id: string;
  /** The layer this rule applies to. */
  layer: SecurityLayer;
  /** Regex pattern to match against action content/command/filePath. */
  pattern: RegExp;
  /** Risk level assigned when this rule matches. */
  riskLevel: RiskLevel;
  /** Human-readable description of what this rule detects. */
  description: string;
}

/**
 * Configuration options for the SecurityEngine.
 */
export interface SecurityEngineOptions {
  /** Custom rules to add on top of the built-in defaults. */
  customRules?: SecurityRule[];
  /** Enable anomaly detection based on action history. Default: true. */
  anomalyDetection?: boolean;
  /** Maximum number of quarantine entries to retain. Default: 100. */
  maxQuarantine?: number;
  /** Allowed file path patterns. Actions targeting paths outside these are higher risk. */
  allowedPaths?: RegExp[];
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DEFAULT_MAX_QUARANTINE = 100;

/** Numeric ranking for risk levels (higher = more severe). */
const RISK_RANK: Record<RiskLevel, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Maps risk levels to action decisions. */
const RISK_TO_DECISION: Record<RiskLevel, ActionDecision> = {
  safe: "allow",
  low: "allow",
  medium: "warn",
  high: "block",
  critical: "quarantine",
};

/** Anomaly threshold — bash frequency above this triggers anomaly. */
const BASH_FREQUENCY_THRESHOLD = 5;

/** Window size for anomaly frequency analysis. */
const ANOMALY_WINDOW = 10;

/** High anomaly score threshold. */
const ANOMALY_SCORE_THRESHOLD = 0.5;

// ----------------------------------------------------------------------------
// Built-in Rules
// ----------------------------------------------------------------------------

/**
 * Creates the default set of built-in security rules.
 * These cover the most common threat vectors across all security layers.
 */
function createBuiltinRules(): SecurityRule[] {
  return [
    // ── Prompt Layer: Injection Patterns ───────────────────────────────────
    {
      id: "prompt-injection-ignore",
      layer: "prompt",
      pattern: /ignore\s+(all\s+)?previous/i,
      riskLevel: "high",
      description: "Prompt injection: attempt to override previous instructions",
    },
    {
      id: "prompt-injection-system",
      layer: "prompt",
      pattern: /^system:\s/im,
      riskLevel: "high",
      description: "Prompt injection: fake system message prefix",
    },
    {
      id: "prompt-injection-script",
      layer: "prompt",
      pattern: /<script[\s>]/i,
      riskLevel: "high",
      description: "Prompt injection: embedded script tag",
    },
    {
      id: "prompt-injection-eval",
      layer: "prompt",
      pattern: /\beval\s*\(/i,
      riskLevel: "high",
      description: "Prompt injection: eval() call in prompt",
    },
    {
      id: "prompt-injection-jailbreak",
      layer: "prompt",
      pattern: /\b(DAN|jailbreak|bypass\s+safety)\b/i,
      riskLevel: "high",
      description: "Prompt injection: jailbreak attempt keywords",
    },

    // ── Tool Layer: Dangerous Bash Commands ────────────────────────────────
    {
      id: "tool-dangerous-rm-rf",
      layer: "tool",
      pattern: /\brm\s+-[^\s]*r[^\s]*f[^\s]*\s+\//,
      riskLevel: "critical",
      description: "Dangerous command: rm -rf / (recursive delete from root)",
    },
    {
      id: "tool-dangerous-chmod-777",
      layer: "tool",
      pattern: /\bchmod\s+777\b/,
      riskLevel: "critical",
      description: "Dangerous command: chmod 777 (world-writable permissions)",
    },
    {
      id: "tool-dangerous-curl-pipe-bash",
      layer: "tool",
      pattern: /\bcurl\b[^|]*\|\s*(ba)?sh\b/,
      riskLevel: "critical",
      description: "Dangerous command: curl piped to shell (remote code execution)",
    },
    {
      id: "tool-dangerous-dd",
      layer: "tool",
      pattern: /\bdd\s+if=/,
      riskLevel: "critical",
      description: "Dangerous command: dd (raw disk write)",
    },
    {
      id: "tool-dangerous-mkfs",
      layer: "tool",
      pattern: /\bmkfs\b/,
      riskLevel: "critical",
      description: "Dangerous command: mkfs (filesystem format)",
    },
    {
      id: "tool-dangerous-fork-bomb",
      layer: "tool",
      pattern: /:\(\)\{\s*:\|\s*:&\s*\}\s*;?\s*:/,
      riskLevel: "critical",
      description: "Dangerous command: fork bomb",
    },

    // ── Tool Layer: Network Commands (medium risk) ─────────────────────────
    {
      id: "tool-network-wget",
      layer: "tool",
      pattern: /\bwget\s/,
      riskLevel: "medium",
      description: "Network command: wget download",
    },
    {
      id: "tool-network-curl",
      layer: "tool",
      pattern: /\bcurl\s/,
      riskLevel: "medium",
      description: "Network command: curl request",
    },
    {
      id: "tool-network-nc",
      layer: "tool",
      pattern: /\bnc\s+-l\b/,
      riskLevel: "medium",
      description: "Network command: netcat listener",
    },
    {
      id: "tool-network-ncat",
      layer: "tool",
      pattern: /\bncat\b/,
      riskLevel: "medium",
      description: "Network command: ncat",
    },

    // ── Execution Layer: Path Traversal ────────────────────────────────────
    {
      id: "exec-path-traversal-forward",
      layer: "execution",
      pattern: /\.\.\//,
      riskLevel: "high",
      description: "Path traversal: ../ detected",
    },
    {
      id: "exec-path-traversal-backward",
      layer: "execution",
      pattern: /\.\.\\/,
      riskLevel: "high",
      description: "Path traversal: ..\\ detected",
    },

    // ── Output Layer: Secrets in Output ────────────────────────────────────
    {
      id: "output-secret-aws-key",
      layer: "output",
      pattern: /\bAKIA[0-9A-Z]{16}\b/,
      riskLevel: "high",
      description: "Secret leak: AWS access key ID detected in output",
    },
    {
      id: "output-secret-private-key",
      layer: "output",
      pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
      riskLevel: "high",
      description: "Secret leak: private key detected in output",
    },
    {
      id: "output-secret-generic-api-key",
      layer: "output",
      pattern:
        /\b(api[_-]?key|api[_-]?secret|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{20,}/i,
      riskLevel: "high",
      description: "Secret leak: generic API key/secret/token pattern in output",
    },
    {
      id: "output-secret-password",
      layer: "output",
      pattern: /\b(password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{8,}/i,
      riskLevel: "high",
      description: "Secret leak: password pattern in output",
    },
    {
      id: "output-secret-github-token",
      layer: "output",
      pattern: /\bgh[ps]_[A-Za-z0-9_]{36,}\b/,
      riskLevel: "high",
      description: "Secret leak: GitHub personal/service token in output",
    },
  ];
}

// ----------------------------------------------------------------------------
// SecurityEngine
// ----------------------------------------------------------------------------

/**
 * Zero-trust multi-layer security engine for agent actions.
 *
 * Evaluates actions across four security layers (prompt, tool, execution,
 * output) using configurable rule sets. Provides anomaly detection based
 * on action frequency patterns and a quarantine system for high-risk
 * actions that require human review.
 *
 * @example
 * ```ts
 * const engine = new SecurityEngine({
 *   allowedPaths: [/^\/workspace\//],
 * });
 *
 * const result = engine.checkAction({
 *   layer: "tool",
 *   command: "rm -rf /",
 * });
 *
 * if (result.decision === "quarantine") {
 *   engine.quarantineAction(action, result);
 * }
 * ```
 */
export class SecurityEngine {
  /** Active security rules (built-in + custom). */
  private rules: SecurityRule[];

  /** Quarantine entries for high-risk actions. */
  private quarantine: QuarantineEntry[];

  /** History of all evaluated actions (for anomaly detection). */
  private actionHistory: SecurityAction[];

  /** Engine configuration. */
  private options: Required<Pick<SecurityEngineOptions, "anomalyDetection" | "maxQuarantine">> &
    Pick<SecurityEngineOptions, "allowedPaths">;

  /**
   * Creates a new SecurityEngine with the given options.
   * Built-in rules are always loaded; custom rules are merged on top.
   *
   * @param options - Configuration options for the engine.
   */
  constructor(options: SecurityEngineOptions = {}) {
    const builtinRules = createBuiltinRules();
    this.rules = options.customRules
      ? [...builtinRules, ...options.customRules]
      : [...builtinRules];

    this.quarantine = [];
    this.actionHistory = [];
    this.options = {
      anomalyDetection: options.anomalyDetection ?? true,
      maxQuarantine: options.maxQuarantine ?? DEFAULT_MAX_QUARANTINE,
      allowedPaths: options.allowedPaths,
    };
  }

  // --------------------------------------------------------------------------
  // Core Security Checks
  // --------------------------------------------------------------------------

  /**
   * Performs a full security check on an action.
   *
   * Evaluates the action against all rules in its layer, determines the
   * worst-case risk level, and returns the corresponding decision. The
   * action is recorded in history for anomaly detection.
   *
   * @param action - The action to evaluate.
   * @returns The security check result with decision, risk level, and reasons.
   */
  checkAction(action: SecurityAction): SecurityCheckResult {
    // Record action in history for anomaly detection
    this.actionHistory.push(action);

    const matchingReasons: string[] = [];
    let worstRisk: RiskLevel = "safe";

    // Evaluate all rules for this action's layer
    const layerRules = this.rules.filter((r) => r.layer === action.layer);
    const textToCheck = this.getCheckableText(action);

    for (const rule of layerRules) {
      if (rule.pattern.test(textToCheck)) {
        matchingReasons.push(rule.description);
        if (RISK_RANK[rule.riskLevel] > RISK_RANK[worstRisk]) {
          worstRisk = rule.riskLevel;
        }
      }
    }

    // Check path allowance for execution-layer actions with file paths
    if (action.filePath && this.options.allowedPaths && !this.isPathAllowed(action.filePath)) {
      matchingReasons.push(`File path "${action.filePath}" is outside allowed path patterns`);
      if (RISK_RANK.medium > RISK_RANK[worstRisk]) {
        worstRisk = "medium";
      }
    }

    const decision: ActionDecision =
      matchingReasons.length > 0 ? RISK_TO_DECISION[worstRisk] : "allow";

    return {
      decision,
      riskLevel: worstRisk,
      reasons: matchingReasons,
      layer: action.layer,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Performs a quick risk assessment without the full check overhead.
   * Does not record the action in history.
   *
   * @param action - The action to assess.
   * @returns The risk level for the action.
   */
  assessRisk(action: SecurityAction): RiskLevel {
    let worstRisk: RiskLevel = "safe";
    const layerRules = this.rules.filter((r) => r.layer === action.layer);
    const textToCheck = this.getCheckableText(action);

    for (const rule of layerRules) {
      if (rule.pattern.test(textToCheck)) {
        if (RISK_RANK[rule.riskLevel] > RISK_RANK[worstRisk]) {
          worstRisk = rule.riskLevel;
        }
      }
    }

    return worstRisk;
  }

  // --------------------------------------------------------------------------
  // Anomaly Detection
  // --------------------------------------------------------------------------

  /**
   * Detects anomalous behavior by comparing an action against recent history.
   *
   * Uses frequency-based analysis to identify patterns such as:
   * - Excessive consecutive bash commands (>5 in a row)
   * - Writing to unusual directories (directories not seen in recent history)
   *
   * @param action - The action to evaluate for anomaly.
   * @returns Anomaly detection result with score and description.
   */
  detectAnomaly(action: SecurityAction): AnomalyDetectionResult {
    if (!this.options.anomalyDetection) {
      return {
        isAnomaly: false,
        score: 0,
        description: "Anomaly detection is disabled",
      };
    }

    const recentActions = this.actionHistory.slice(-ANOMALY_WINDOW);
    let anomalyScore = 0;
    const anomalyReasons: string[] = [];

    // Strategy 1: High frequency of same tool/command type
    if (action.tool || action.command) {
      const toolName = action.tool ?? "bash";
      const consecutiveSame = this.countConsecutiveTrailing(recentActions, toolName);
      if (consecutiveSame >= BASH_FREQUENCY_THRESHOLD) {
        const freqScore = Math.min(1, consecutiveSame / (BASH_FREQUENCY_THRESHOLD * 2));
        anomalyScore = Math.max(anomalyScore, freqScore);
        anomalyReasons.push(`High frequency: ${consecutiveSame} consecutive "${toolName}" actions`);
      }
    }

    // Strategy 2: Unusual directory pattern
    if (action.filePath && recentActions.length > 0) {
      const actionDir = this.extractDirectory(action.filePath);
      const recentDirs = new Set(
        recentActions.filter((a) => a.filePath).map((a) => this.extractDirectory(a.filePath!)),
      );
      if (recentDirs.size > 0 && !recentDirs.has(actionDir)) {
        anomalyScore = Math.max(anomalyScore, 0.4);
        anomalyReasons.push(`Unusual directory: "${actionDir}" not seen in recent actions`);
      }
    }

    const isAnomaly = anomalyScore >= ANOMALY_SCORE_THRESHOLD;
    return {
      isAnomaly,
      score: anomalyScore,
      description: anomalyReasons.length > 0 ? anomalyReasons.join("; ") : "No anomaly detected",
    };
  }

  // --------------------------------------------------------------------------
  // Quarantine Management
  // --------------------------------------------------------------------------

  /**
   * Places an action into quarantine for human review.
   * Enforces the maximum quarantine size by evicting the oldest
   * resolved entries first, then oldest unresolved if necessary.
   *
   * @param action - The action to quarantine.
   * @param result - The security check result that triggered quarantine.
   * @returns The unique ID of the quarantine entry.
   */
  quarantineAction(action: SecurityAction, result: SecurityCheckResult): string {
    const entry: QuarantineEntry = {
      id: randomUUID(),
      action,
      result,
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    this.quarantine.push(entry);

    // Enforce max quarantine size — evict oldest entries
    while (this.quarantine.length > this.options.maxQuarantine) {
      // Prefer evicting resolved entries first
      const resolvedIdx = this.quarantine.findIndex((e) => e.resolved);
      if (resolvedIdx >= 0) {
        this.quarantine.splice(resolvedIdx, 1);
      } else {
        // No resolved entries — evict the oldest unresolved
        this.quarantine.shift();
      }
    }

    return entry.id;
  }

  /**
   * Marks a quarantine entry as resolved.
   *
   * @param id - The quarantine entry ID to resolve.
   * @returns True if the entry was found and resolved, false otherwise.
   */
  resolveQuarantine(id: string): boolean {
    const entry = this.quarantine.find((e) => e.id === id);
    if (!entry) {
      return false;
    }
    entry.resolved = true;
    return true;
  }

  /**
   * Returns all quarantine entries (both resolved and unresolved).
   *
   * @returns A copy of the quarantine entry list.
   */
  getQuarantine(): QuarantineEntry[] {
    return [...this.quarantine];
  }

  // --------------------------------------------------------------------------
  // Rule Management
  // --------------------------------------------------------------------------

  /**
   * Adds a custom security rule to the engine.
   *
   * @param rule - The rule to add.
   */
  addRule(rule: SecurityRule): void {
    this.rules.push(rule);
  }

  /**
   * Removes a security rule by its ID.
   *
   * @param id - The ID of the rule to remove.
   * @returns True if the rule was found and removed, false otherwise.
   */
  removeRule(id: string): boolean {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index < 0) {
      return false;
    }
    this.rules.splice(index, 1);
    return true;
  }

  /**
   * Returns a copy of all active security rules.
   *
   * @returns Array of security rules (mutations will not affect the engine).
   */
  getRules(): SecurityRule[] {
    return [...this.rules];
  }

  // --------------------------------------------------------------------------
  // Action History
  // --------------------------------------------------------------------------

  /**
   * Returns recent action history, optionally limited to the last N entries.
   *
   * @param limit - Maximum number of entries to return. If omitted, returns all.
   * @returns Array of recent security actions.
   */
  getActionHistory(limit?: number): SecurityAction[] {
    if (limit !== undefined && limit >= 0) {
      if (limit === 0) return [];
      return this.actionHistory.slice(-limit);
    }
    return [...this.actionHistory];
  }

  /**
   * Clears all recorded action history.
   * This resets anomaly detection baselines.
   */
  clearHistory(): void {
    this.actionHistory = [];
  }

  // --------------------------------------------------------------------------
  // Path Checking
  // --------------------------------------------------------------------------

  /**
   * Checks whether a file path matches the configured allowed path patterns.
   * If no allowed paths are configured, all paths are considered allowed.
   *
   * @param filePath - The file path to check.
   * @returns True if the path is allowed (or no restrictions are configured).
   */
  isPathAllowed(filePath: string): boolean {
    if (!this.options.allowedPaths || this.options.allowedPaths.length === 0) {
      return true;
    }
    return this.options.allowedPaths.some((pattern) => pattern.test(filePath));
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Extracts all checkable text from an action for rule evaluation.
   * Concatenates content, command, and filePath with newline separators.
   */
  private getCheckableText(action: SecurityAction): string {
    const parts: string[] = [];
    if (action.content) parts.push(action.content);
    if (action.command) parts.push(action.command);
    if (action.filePath) parts.push(action.filePath);
    return parts.join("\n");
  }

  /**
   * Counts how many of the most recent consecutive actions match
   * a given tool name (by tool field or by the presence of a command
   * when toolName is "bash").
   */
  private countConsecutiveTrailing(actions: SecurityAction[], toolName: string): number {
    let count = 0;
    for (let i = actions.length - 1; i >= 0; i--) {
      const a = actions[i]!;
      const aToolName = a.tool ?? (a.command ? "bash" : undefined);
      if (aToolName === toolName) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /**
   * Extracts the directory portion of a file path.
   * Works with both forward slashes and backslashes.
   */
  private extractDirectory(filePath: string): string {
    const lastSlash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return lastSlash >= 0 ? filePath.substring(0, lastSlash) : ".";
  }
}
