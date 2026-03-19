// ============================================================================
// @dantecode/core — Rule-Based Policy Evaluation Engine
// Evaluates agent actions against configurable rule sets.
// Supports allow / deny / warn / audit effects with priority ordering,
// condition matching (equals, contains, startsWith, endsWith, matches,
// exists), named policy sets, and a set of secure-by-default built-in rules.
// ============================================================================

import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The effect that a matched policy rule produces. */
export type PolicyEffect = "allow" | "deny" | "warn" | "audit";

/** Category of resource that a policy rule guards. */
export type PolicyResourceType =
  | "file"
  | "command"
  | "network"
  | "tool"
  | "memory"
  | "agent";

/**
 * A single predicate that must be satisfied for a rule to match.
 * The `field` is resolved from the request: "resource", "action", or any
 * key in `request.metadata`.
 */
export interface PolicyCondition {
  /** The field to inspect: "resource" | "action" | metadata key. */
  field: string;
  /** Comparison operator applied to the resolved field value. */
  operator:
    | "equals"
    | "contains"
    | "startsWith"
    | "endsWith"
    | "matches"
    | "exists";
  /** The reference value (not required for "exists"). */
  value?: string;
}

/** A named rule inside a policy engine. */
export interface PolicyRule {
  /** Unique identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Explanation of what the rule guards. */
  description: string;
  /** The resource category this rule applies to. */
  resourceType: PolicyResourceType;
  /** All conditions must be true for the rule to match (logical AND). */
  conditions: PolicyCondition[];
  /** Effect applied when the rule matches. */
  effect: PolicyEffect;
  /**
   * Higher priority rules are evaluated first.
   * When stopOnDeny is enabled the first matching deny terminates evaluation.
   */
  priority: number;
  /** Disabled rules are skipped during evaluation. */
  enabled: boolean;
}

/** Describes the action the agent wants to perform. */
export interface PolicyRequest {
  /** Category of the resource being accessed. */
  resourceType: PolicyResourceType;
  /** Resource identifier (file path, URL, command string, tool name…). */
  resource: string;
  /** Verb describing the intended operation (read, write, exec, spawn…). */
  action: string;
  /** Optional bag of additional key/value context. */
  metadata?: Record<string, string>;
}

/** Result returned by {@link PolicyEnforcer.evaluate}. */
export interface PolicyDecision {
  /** Aggregate effect across all matched rules. */
  effect: PolicyEffect;
  /** Every rule that matched the request, in priority order. */
  matchedRules: PolicyRule[];
  /** Human-readable explanation for each matched rule. */
  reasons: string[];
  /** ISO-8601 timestamp at which the decision was made. */
  timestamp: string;
}

/** A named collection of rules that can be applied as a unit. */
export interface PolicySet {
  /** Unique identifier. */
  id: string;
  /** Human-readable label. */
  name: string;
  /** Rules belonging to this set. */
  rules: PolicyRule[];
  /** Effect used when no rule in the set matches. */
  defaultEffect: PolicyEffect;
}

/** Construction options for {@link PolicyEnforcer}. */
export interface PolicyEnforcerOptions {
  /**
   * Effect returned when no rule matches.
   * @default "allow"
   */
  defaultEffect?: PolicyEffect;
  /**
   * When true, evaluation stops immediately after the first matching deny rule.
   * @default true
   */
  stopOnDeny?: boolean;
}

// ----------------------------------------------------------------------------
// Effect precedence helpers
// ----------------------------------------------------------------------------

/** Numeric precedence — higher wins. deny beats warn beats audit beats allow. */
const EFFECT_PRECEDENCE: Record<PolicyEffect, number> = {
  deny: 3,
  warn: 2,
  audit: 1,
  allow: 0,
};

/**
 * Return whichever effect has higher precedence.
 */
function dominantEffect(a: PolicyEffect, b: PolicyEffect): PolicyEffect {
  return EFFECT_PRECEDENCE[a] >= EFFECT_PRECEDENCE[b] ? a : b;
}

// ----------------------------------------------------------------------------
// Built-in rules
// ----------------------------------------------------------------------------

/** Factory so each PolicyEnforcer instance gets independent rule objects. */
function buildBuiltinRules(): PolicyRule[] {
  return [
    // ----- File: deny destructive root removal --------------------------------
    {
      id: "builtin-deny-rm-rf-root",
      name: "Deny rm -rf on filesystem root",
      description:
        "Blocks any command action that attempts to remove the filesystem root " +
        "directory with force flags (rm -rf /).",
      resourceType: "command",
      conditions: [
        { field: "resource", operator: "contains", value: "rm" },
        { field: "resource", operator: "contains", value: "-rf" },
        { field: "resource", operator: "contains", value: " /" },
      ],
      effect: "deny",
      priority: 1000,
      enabled: true,
    },

    // ----- File: deny writes to privileged system paths ----------------------
    {
      id: "builtin-deny-write-etc",
      name: "Deny file writes to /etc",
      description: "Prevents agents from writing to /etc (system configuration).",
      resourceType: "file",
      conditions: [
        { field: "action", operator: "equals", value: "write" },
        { field: "resource", operator: "startsWith", value: "/etc" },
      ],
      effect: "deny",
      priority: 900,
      enabled: true,
    },
    {
      id: "builtin-deny-write-sys",
      name: "Deny file writes to /sys",
      description: "Prevents agents from writing to /sys (kernel sysfs).",
      resourceType: "file",
      conditions: [
        { field: "action", operator: "equals", value: "write" },
        { field: "resource", operator: "startsWith", value: "/sys" },
      ],
      effect: "deny",
      priority: 900,
      enabled: true,
    },
    {
      id: "builtin-deny-write-proc",
      name: "Deny file writes to /proc",
      description: "Prevents agents from writing to /proc (process filesystem).",
      resourceType: "file",
      conditions: [
        { field: "action", operator: "equals", value: "write" },
        { field: "resource", operator: "startsWith", value: "/proc" },
      ],
      effect: "deny",
      priority: 900,
      enabled: true,
    },

    // ----- Network: deny access from restricted tools ------------------------
    {
      id: "builtin-deny-network-restricted-tool",
      name: "Deny network access from restricted tools",
      description:
        'Blocks network requests originating from tools tagged as "restricted" ' +
        "in their metadata.",
      resourceType: "network",
      conditions: [{ field: "tool_tag", operator: "equals", value: "restricted" }],
      effect: "deny",
      priority: 800,
      enabled: true,
    },

    // ----- File: warn on large-file write (path pattern heuristic) -----------
    {
      id: "builtin-warn-large-file-write",
      name: "Warn on large file write path pattern",
      description:
        "Emits a warning when a write targets a path pattern associated with " +
        "large binary or archive files (>10 MB implied by extension).",
      resourceType: "file",
      conditions: [
        { field: "action", operator: "equals", value: "write" },
        {
          field: "resource",
          operator: "matches",
          value: "\\.(iso|img|tar\\.gz|tar\\.bz2|zip|dmg|bin|vmdk|vhd)(\\..+)?$",
        },
      ],
      effect: "warn",
      priority: 500,
      enabled: true,
    },

    // ----- Agent: audit all agent spawning -----------------------------------
    {
      id: "builtin-audit-agent-spawn",
      name: "Audit all agent spawning",
      description:
        "Records an audit entry whenever any sub-agent is spawned, regardless " +
        "of the requesting tool.",
      resourceType: "agent",
      conditions: [{ field: "action", operator: "equals", value: "spawn" }],
      effect: "audit",
      priority: 400,
      enabled: true,
    },
  ];
}

// ----------------------------------------------------------------------------
// PolicyEnforcer
// ----------------------------------------------------------------------------

/**
 * Rule-based policy evaluation engine.
 *
 * Evaluates {@link PolicyRequest} objects against an ordered list of
 * {@link PolicyRule} instances and returns a {@link PolicyDecision}.
 *
 * Rules are evaluated in descending priority order. The aggregate effect is
 * the highest-precedence effect among all matched rules (deny > warn > audit >
 * allow). If `stopOnDeny` is enabled (default) evaluation halts on the first
 * matching deny rule.
 *
 * @example
 * ```ts
 * const enforcer = new PolicyEnforcer();
 * const decision = enforcer.evaluate({
 *   resourceType: "file",
 *   resource: "/etc/passwd",
 *   action: "write",
 * });
 * if (decision.effect === "deny") throw new Error(decision.reasons.join("; "));
 * ```
 */
export class PolicyEnforcer {
  private readonly rules: PolicyRule[];
  private readonly policySets: Map<string, PolicySet>;
  private readonly options: Required<PolicyEnforcerOptions>;

  constructor(options: PolicyEnforcerOptions = {}) {
    this.options = {
      defaultEffect: options.defaultEffect ?? "allow",
      stopOnDeny: options.stopOnDeny ?? true,
    };
    this.rules = buildBuiltinRules();
    this.policySets = new Map();
  }

  // --------------------------------------------------------------------------
  // Core evaluation
  // --------------------------------------------------------------------------

  /**
   * Evaluate a {@link PolicyRequest} against the active rule set.
   *
   * Steps:
   * 1. Filter rules to those matching `resourceType` and `enabled === true`.
   * 2. Sort descending by `priority`.
   * 3. Evaluate each rule's conditions (all must match — logical AND).
   * 4. Collect matched rules; apply `stopOnDeny` logic.
   * 5. Compute aggregate effect (deny > warn > audit > allow).
   *
   * @param request - The action the agent wants to perform.
   * @returns A {@link PolicyDecision} with the final effect and audit trail.
   */
  evaluate(request: PolicyRequest): PolicyDecision {
    const timestamp = new Date().toISOString();

    const candidates = this.rules
      .filter(
        (r) => r.resourceType === request.resourceType && r.enabled,
      )
      .sort((a, b) => b.priority - a.priority);

    const matchedRules: PolicyRule[] = [];
    const reasons: string[] = [];

    for (const rule of candidates) {
      const allMatch = rule.conditions.every((c) =>
        this.evaluateCondition(c, request),
      );
      if (!allMatch) continue;

      matchedRules.push(rule);
      reasons.push(
        `Rule "${rule.name}" (${rule.id}) matched with effect "${rule.effect}": ${rule.description}`,
      );

      if (rule.effect === "deny" && this.options.stopOnDeny) break;
    }

    let effect: PolicyEffect = this.options.defaultEffect;
    for (const rule of matchedRules) {
      effect = dominantEffect(effect, rule.effect);
    }

    return { effect, matchedRules, reasons, timestamp };
  }

  // --------------------------------------------------------------------------
  // Rule management
  // --------------------------------------------------------------------------

  /**
   * Add a rule to the engine.
   *
   * @param rule - The rule to register.
   * @throws {Error} If a rule with the same `id` already exists.
   */
  addRule(rule: PolicyRule): void {
    if (this.rules.some((r) => r.id === rule.id)) {
      throw new Error(
        `PolicyEnforcer: duplicate rule id "${rule.id}". ` +
          "Use removeRule() first or choose a different id.",
      );
    }
    this.rules.push(rule);
  }

  /**
   * Remove a rule by id.
   *
   * @param id - The rule's unique identifier.
   * @returns `true` if the rule was found and removed; `false` otherwise.
   */
  removeRule(id: string): boolean {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rules.splice(idx, 1);
    return true;
  }

  /**
   * Retrieve a rule by id.
   *
   * @param id - The rule's unique identifier.
   * @returns The matching rule or `undefined`.
   */
  getRule(id: string): PolicyRule | undefined {
    return this.rules.find((r) => r.id === id);
  }

  /**
   * Enable a previously disabled rule.
   *
   * @param id - The rule's unique identifier.
   * @returns `true` if the rule was found; `false` otherwise.
   */
  enableRule(id: string): boolean {
    const rule = this.getRule(id);
    if (!rule) return false;
    rule.enabled = true;
    return true;
  }

  /**
   * Disable a rule so it is skipped during evaluation.
   *
   * @param id - The rule's unique identifier.
   * @returns `true` if the rule was found; `false` otherwise.
   */
  disableRule(id: string): boolean {
    const rule = this.getRule(id);
    if (!rule) return false;
    rule.enabled = false;
    return true;
  }

  /**
   * List all active rules, optionally filtered by resource type.
   *
   * @param resourceType - When supplied only rules of this type are returned.
   * @returns Array of matching rules (unordered).
   */
  getRules(resourceType?: PolicyResourceType): PolicyRule[] {
    if (resourceType === undefined) return [...this.rules];
    return this.rules.filter((r) => r.resourceType === resourceType);
  }

  // --------------------------------------------------------------------------
  // Policy sets
  // --------------------------------------------------------------------------

  /**
   * Create a named {@link PolicySet} and register it internally.
   *
   * The set is not applied automatically — call {@link applyPolicySet} to
   * merge its rules into the active engine.
   *
   * @param name - Human-readable label.
   * @param rules - Rules belonging to this set.
   * @returns The newly created {@link PolicySet}.
   */
  createPolicySet(name: string, rules: PolicyRule[]): PolicySet {
    const id = randomUUID();
    const set: PolicySet = { id, name, rules, defaultEffect: "allow" };
    this.policySets.set(id, set);
    return set;
  }

  /**
   * Merge all rules from a named policy set into the active rule list.
   * Rules whose id already exists in the engine are skipped (no duplicates).
   *
   * @param setId - The {@link PolicySet} id returned by {@link createPolicySet}.
   * @throws {Error} If `setId` does not correspond to a known policy set.
   */
  applyPolicySet(setId: string): void {
    const set = this.policySets.get(setId);
    if (!set) {
      throw new Error(
        `PolicyEnforcer: unknown policy set id "${setId}". ` +
          "Create it with createPolicySet() first.",
      );
    }
    for (const rule of set.rules) {
      if (!this.rules.some((r) => r.id === rule.id)) {
        this.rules.push(rule);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Condition evaluation
  // --------------------------------------------------------------------------

  /**
   * Evaluate a single {@link PolicyCondition} against a {@link PolicyRequest}.
   *
   * Field resolution order:
   * 1. `"resource"` → `request.resource`
   * 2. `"action"` → `request.action`
   * 3. Any other string → `request.metadata?.[field]`
   *
   * Operators:
   * - `equals` — strict equality
   * - `contains` — substring check
   * - `startsWith` / `endsWith` — prefix / suffix check
   * - `matches` — full RegExp test (condition.value treated as pattern)
   * - `exists` — field is defined and non-empty (value not required)
   *
   * @param condition - The condition to test.
   * @param request - The request to test against.
   * @returns `true` when the condition is satisfied.
   */
  evaluateCondition(condition: PolicyCondition, request: PolicyRequest): boolean {
    const { field, operator, value } = condition;

    // Resolve the field value from the request.
    let fieldValue: string | undefined;
    if (field === "resource") {
      fieldValue = request.resource;
    } else if (field === "action") {
      fieldValue = request.action;
    } else {
      fieldValue = request.metadata?.[field];
    }

    switch (operator) {
      case "exists":
        return fieldValue !== undefined && fieldValue.length > 0;

      case "equals":
        return fieldValue !== undefined && fieldValue === value;

      case "contains":
        return (
          fieldValue !== undefined &&
          value !== undefined &&
          fieldValue.includes(value)
        );

      case "startsWith":
        return (
          fieldValue !== undefined &&
          value !== undefined &&
          fieldValue.startsWith(value)
        );

      case "endsWith":
        return (
          fieldValue !== undefined &&
          value !== undefined &&
          fieldValue.endsWith(value)
        );

      case "matches": {
        if (fieldValue === undefined || value === undefined) return false;
        try {
          return new RegExp(value).test(fieldValue);
        } catch {
          // Invalid regex — condition does not match.
          return false;
        }
      }

      default:
        return false;
    }
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Return a fresh copy of the built-in rules without mutating the engine.
   * Useful for inspection or seeding a new engine.
   *
   * @returns Array of built-in {@link PolicyRule} objects.
   */
  getBuiltinRules(): PolicyRule[] {
    return buildBuiltinRules();
  }

  /**
   * Reset the engine to its initial state: only built-in rules, no policy sets.
   * Any custom rules added via {@link addRule} or {@link applyPolicySet} are
   * discarded.
   */
  reset(): void {
    this.rules.length = 0;
    this.rules.push(...buildBuiltinRules());
    this.policySets.clear();
  }
}
