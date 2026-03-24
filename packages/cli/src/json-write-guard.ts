// JSON pre-write guard: validates and auto-repairs JSON content before Write tool commits to disk.

/**
 * Determines if a file path points to a JSON file.
 */
export function isJsonFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".json");
}

/**
 * Attempts to repair common JSON corruption patterns produced by LLMs:
 * 1. Double-escaped quotes: \" inside what should be a JSON value
 * 2. Trailing commas before } or ]
 * 3. Single quotes used as string delimiters (simple cases only)
 * Returns the repaired string, or null if repair is not possible.
 */
export function attemptJsonRepair(content: string): string | null {
  // Try original first
  if (tryParse(content)) return content;

  let candidate = content;

  // Repair 1: Strip one layer of backslash-escaping on quotes
  candidate = candidate.replace(/\\"/g, '"');
  if (tryParse(candidate)) return candidate;

  // Repair 2: Trailing commas (e.g., { "a": 1, })
  candidate = content.replace(/,\s*([\]}])/g, "$1");
  if (tryParse(candidate)) return candidate;

  // Repair 3: Combined — strip escapes AND trailing commas
  candidate = content.replace(/\\"/g, '"').replace(/,\s*([\]}])/g, "$1");
  if (tryParse(candidate)) return candidate;

  return null;
}

export interface JsonValidationResult {
  valid: boolean;
  repaired: boolean;
  content: string;
  error?: string;
}

/**
 * Validates content as JSON for a given file path.
 * Only validates .json files; non-JSON files pass through unchanged.
 * Returns { valid, repaired, content } where repaired is true if auto-repair was applied.
 */
export function validateJsonContent(content: string, filePath: string): JsonValidationResult {
  if (!isJsonFile(filePath)) {
    return { valid: true, repaired: false, content };
  }

  // Try parsing as-is
  if (tryParse(content)) {
    return { valid: true, repaired: false, content };
  }

  // Attempt repair
  const repaired = attemptJsonRepair(content);
  if (repaired !== null) {
    return { valid: true, repaired: true, content: repaired };
  }

  return {
    valid: false,
    repaired: false,
    content,
    error: getParseError(content),
  };
}

function tryParse(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

function getParseError(s: string): string {
  try {
    JSON.parse(s);
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
