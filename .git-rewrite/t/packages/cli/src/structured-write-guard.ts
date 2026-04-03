// Structured file pre-write guard: validates JSON, YAML, and TOML content before Write.
// JSON validation delegates to json-write-guard.ts.
// YAML and TOML use regex-based structural checks (no external deps).

import { validateJsonContent } from "./json-write-guard.js";

export interface StructuredValidationResult {
  valid: boolean;
  repaired: boolean;
  content: string;
  error?: string;
  format?: "json" | "yaml" | "toml";
}

/**
 * Validates structured content (JSON, YAML, TOML) before writing.
 * Non-structured file types pass through unchanged.
 */
export function validateStructuredContent(
  content: string,
  filePath: string,
): StructuredValidationResult {
  const lower = filePath.toLowerCase();

  if (lower.endsWith(".json")) {
    const r = validateJsonContent(content, filePath);
    return { ...r, format: "json" };
  }

  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return validateYamlContent(content);
  }

  if (lower.endsWith(".toml")) {
    return validateTomlContent(content);
  }

  // Non-structured files pass through
  return { valid: true, repaired: false, content };
}

// ---------------------------------------------------------------------------
// YAML structural validation (regex-based, no external deps)
// ---------------------------------------------------------------------------

function validateYamlContent(content: string): StructuredValidationResult {
  const errors: string[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // Skip comments and blank lines
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

    // Check for tab indentation (YAML only allows spaces)
    if (/^\t/.test(line)) {
      errors.push(`Line ${lineNum}: Tab indentation not allowed in YAML (use spaces)`);
    }

    // Check for unmatched braces/brackets in inline flow syntax
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    const openBrackets = (line.match(/\[/g) || []).length;
    const closeBrackets = (line.match(/]/g) || []).length;

    // Flag unbalanced braces/brackets (flow syntax should balance on one line)
    if (openBraces !== closeBraces) {
      errors.push(`Line ${lineNum}: Unmatched braces in flow mapping`);
    }
    if (openBrackets !== closeBrackets) {
      errors.push(`Line ${lineNum}: Unmatched brackets in flow sequence`);
    }

    // Check for duplicate colon on key lines (e.g., "key:: value")
    if (/^[^#]*[^:]::\s/.test(line)) {
      errors.push(`Line ${lineNum}: Double colon detected (possible typo)`);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      repaired: false,
      content,
      error: `YAML structural issues:\n${errors.slice(0, 5).join("\n")}`,
      format: "yaml",
    };
  }

  return { valid: true, repaired: false, content, format: "yaml" };
}

// ---------------------------------------------------------------------------
// TOML structural validation (regex-based, no external deps)
// ---------------------------------------------------------------------------

function validateTomlContent(content: string): StructuredValidationResult {
  const errors: string[] = [];
  const lines = content.split("\n");
  const seenSections = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;
    const trimmed = line.trim();

    // Skip comments and blank lines
    if (trimmed.startsWith("#") || trimmed === "") continue;

    // Check for section headers [section] or [[array]]
    const sectionMatch = trimmed.match(/^\[(\[?[^\]]*\]?)\]$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1]!;

      // Check for unclosed brackets
      const opens = (trimmed.match(/\[/g) || []).length;
      const closes = (trimmed.match(/]/g) || []).length;
      if (opens !== closes) {
        errors.push(`Line ${lineNum}: Unmatched brackets in section header`);
      }

      // Track duplicate sections (not array tables [[...]])
      if (!trimmed.startsWith("[[")) {
        if (seenSections.has(sectionName)) {
          errors.push(`Line ${lineNum}: Duplicate section [${sectionName}]`);
        }
        seenSections.add(sectionName);
      }
      continue;
    }

    // Key-value lines must have '='
    if (!trimmed.startsWith("[") && !trimmed.includes("=")) {
      errors.push(`Line ${lineNum}: Missing '=' in key-value pair`);
    }

    // Check for bare '=' without a key
    if (/^\s*=/.test(line)) {
      errors.push(`Line ${lineNum}: Missing key before '='`);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      repaired: false,
      content,
      error: `TOML structural issues:\n${errors.slice(0, 5).join("\n")}`,
      format: "toml",
    };
  }

  return { valid: true, repaired: false, content, format: "toml" };
}
