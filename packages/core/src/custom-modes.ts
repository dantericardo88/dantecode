// ============================================================================
// @dantecode/core — Custom Mode System (kilocode-derived)
// User-defined execution modes with model pinning, path restrictions, and
// tool filtering. Extends approval modes with persistent mode configuration.
// ============================================================================

import { minimatch } from "minimatch";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * A custom execution mode with sticky model, path restrictions, and tool filtering.
 * Inspired by kilocode's organization modes but adapted for DanteCode architecture.
 */
export interface CustomMode {
  /** Unique mode identifier (lowercase, alphanumeric + hyphens). */
  slug: string;
  /** Display name shown in UI and status bar. */
  name: string;
  /** Optional description of mode purpose. */
  description?: string;
  /** Optional icon/emoji for visual identification. */
  icon?: string;
  /** Sticky model configuration — when set, this model is used for all turns. */
  model?: string;
  /** Glob patterns for files this mode is allowed to edit. Empty = allow all. */
  allowedPaths?: string[];
  /** Glob patterns for files this mode must not edit. Takes precedence over allowedPaths. */
  deniedPaths?: string[];
  /** List of tool names allowed in this mode. Empty = allow all (subject to approval mode). */
  allowedTools?: string[];
  /** List of tool names denied in this mode. Takes precedence over allowedTools. */
  deniedTools?: string[];
  /** Optional approval mode override for this custom mode. */
  approvalMode?: "review" | "apply" | "autoforge" | "yolo";
}

/**
 * Result of checking whether a file operation is allowed in a custom mode.
 */
export interface PathCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Result of checking whether a tool is allowed in a custom mode.
 */
export interface ToolCheckResult {
  allowed: boolean;
  reason?: string;
}

// ----------------------------------------------------------------------------
// Path matching
// ----------------------------------------------------------------------------

/**
 * Check if a file path matches any of the provided glob patterns.
 * Uses minimatch for cross-platform glob support.
 */
function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => minimatch(filePath, pattern, { dot: true, nocase: true }));
}

/**
 * Normalize a file path for comparison: convert backslashes to forward slashes,
 * remove leading "./" or "./", and trim whitespace.
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Check if a file path is allowed to be edited in the given custom mode.
 *
 * Rules:
 * 1. If deniedPaths is set and the path matches any pattern, deny.
 * 2. If allowedPaths is set and the path does NOT match any pattern, deny.
 * 3. Otherwise, allow.
 *
 * @param mode - The custom mode to check against.
 * @param filePath - The file path to check (relative or absolute).
 * @returns Result with allowed flag and optional reason.
 */
export function checkPathAllowed(mode: CustomMode, filePath: string): PathCheckResult {
  const normalized = normalizePath(filePath);

  // Check denied paths first (takes precedence)
  if (mode.deniedPaths && mode.deniedPaths.length > 0) {
    if (matchesAnyPattern(normalized, mode.deniedPaths)) {
      return {
        allowed: false,
        reason: `File "${filePath}" matches denied path pattern in mode "${mode.name}"`,
      };
    }
  }

  // Check allowed paths (if specified)
  if (mode.allowedPaths && mode.allowedPaths.length > 0) {
    if (!matchesAnyPattern(normalized, mode.allowedPaths)) {
      return {
        allowed: false,
        reason: `File "${filePath}" does not match any allowed path pattern in mode "${mode.name}"`,
      };
    }
  }

  // If we reach here, the path is allowed
  return { allowed: true };
}

/**
 * Check if a tool is allowed to be used in the given custom mode.
 *
 * Rules:
 * 1. If deniedTools is set and the tool matches, deny.
 * 2. If allowedTools is set and the tool does NOT match, deny.
 * 3. Otherwise, allow.
 *
 * @param mode - The custom mode to check against.
 * @param toolName - The tool name to check (e.g. "Write", "Bash").
 * @returns Result with allowed flag and optional reason.
 */
export function checkToolAllowed(mode: CustomMode, toolName: string): ToolCheckResult {
  // Check denied tools first (takes precedence)
  if (mode.deniedTools && mode.deniedTools.length > 0) {
    if (mode.deniedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is denied in mode "${mode.name}"`,
      };
    }
  }

  // Check allowed tools (if specified)
  if (mode.allowedTools && mode.allowedTools.length > 0) {
    if (!mode.allowedTools.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not in the allowed tools list for mode "${mode.name}"`,
      };
    }
  }

  // If we reach here, the tool is allowed
  return { allowed: true };
}

/**
 * Validate a custom mode slug: must be lowercase alphanumeric + hyphens, 1-32 chars.
 */
export function validateModeSlug(slug: string): { valid: boolean; reason?: string } {
  if (!slug || slug.length === 0) {
    return { valid: false, reason: "Mode slug cannot be empty" };
  }
  if (slug.length > 32) {
    return { valid: false, reason: "Mode slug must be 32 characters or less" };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      reason: "Mode slug must contain only lowercase letters, numbers, and hyphens",
    };
  }
  if (slug.startsWith("-") || slug.endsWith("-")) {
    return { valid: false, reason: "Mode slug cannot start or end with a hyphen" };
  }
  // Reserved slugs that conflict with built-in approval modes
  const reserved = ["review", "apply", "autoforge", "yolo", "plan", "default"];
  if (reserved.includes(slug)) {
    return { valid: false, reason: `Mode slug "${slug}" is reserved` };
  }
  return { valid: true };
}

/**
 * Validate a custom mode definition.
 */
export function validateCustomMode(mode: CustomMode): { valid: boolean; reason?: string } {
  // Validate slug
  const slugCheck = validateModeSlug(mode.slug);
  if (!slugCheck.valid) {
    return slugCheck;
  }

  // Validate name
  if (!mode.name || mode.name.trim().length === 0) {
    return { valid: false, reason: "Mode name cannot be empty" };
  }
  if (mode.name.length > 64) {
    return { valid: false, reason: "Mode name must be 64 characters or less" };
  }

  // Validate glob patterns (basic check for obviously invalid patterns)
  const checkPatterns = (patterns: string[] | undefined, field: string) => {
    if (!patterns) return { valid: true };
    for (const pattern of patterns) {
      if (!pattern || pattern.trim().length === 0) {
        return { valid: false, reason: `Empty pattern in ${field}` };
      }
      // Check for path traversal attempts
      if (pattern.includes("..")) {
        return { valid: false, reason: `Path traversal not allowed in ${field}: ${pattern}` };
      }
    }
    return { valid: true };
  };

  const allowedCheck = checkPatterns(mode.allowedPaths, "allowedPaths");
  if (!allowedCheck.valid) return allowedCheck;

  const deniedCheck = checkPatterns(mode.deniedPaths, "deniedPaths");
  if (!deniedCheck.valid) return deniedCheck;

  return { valid: true };
}

/**
 * Get a list of tool names that should be excluded from the tool set based on the custom mode.
 * This is used to filter tools BEFORE they are sent to the model.
 */
export function getCustomModeToolExclusions(mode: CustomMode): string[] {
  // If allowedTools is specified, exclude everything NOT in the list
  if (mode.allowedTools && mode.allowedTools.length > 0) {
    // We need a comprehensive list of all tools to compute the exclusion set.
    // For now, return deniedTools if specified, otherwise empty.
    // The caller (agent-loop) should handle allowedTools by cross-referencing
    // the full tool catalog.
    return mode.deniedTools ?? [];
  }

  // If only deniedTools is specified, return it directly
  return mode.deniedTools ?? [];
}

/**
 * Format a custom mode for display in status bar or /mode list.
 */
export function formatModeDisplay(mode: CustomMode): string {
  const icon = mode.icon ? `${mode.icon} ` : "";
  const model = mode.model ? ` [${mode.model}]` : "";
  const restrictions: string[] = [];
  if (mode.allowedPaths && mode.allowedPaths.length > 0) {
    restrictions.push(`paths: ${mode.allowedPaths.length} allowed`);
  }
  if (mode.deniedPaths && mode.deniedPaths.length > 0) {
    restrictions.push(`paths: ${mode.deniedPaths.length} denied`);
  }
  if (mode.allowedTools && mode.allowedTools.length > 0) {
    restrictions.push(`tools: ${mode.allowedTools.length} allowed`);
  }
  if (mode.deniedTools && mode.deniedTools.length > 0) {
    restrictions.push(`tools: ${mode.deniedTools.length} denied`);
  }
  const restrictionStr = restrictions.length > 0 ? ` (${restrictions.join(", ")})` : "";
  return `${icon}${mode.name}${model}${restrictionStr}`;
}
