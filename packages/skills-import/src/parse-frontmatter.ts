export type FrontmatterResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parse YAML-like frontmatter from a markdown file.
 * Handles: string values, array values (YAML list with `- item`), quoted strings.
 * Does NOT import a full YAML library.
 * Supports the Agent Skills SKILL.md frontmatter subset.
 */
export function parseFrontmatter(content: string): FrontmatterResult {
  // Must start with ---
  if (!content.startsWith("---")) {
    return { ok: false, error: "Frontmatter must start with ---" };
  }

  // Find the closing ---
  const rest = content.slice(3);
  // Handle both \r\n and \n
  const closeIdx = rest.search(/\n---(\r?\n|$)/);
  if (closeIdx === -1) {
    return { ok: false, error: "Frontmatter closing --- not found" };
  }

  const frontmatterBlock = rest.slice(0, closeIdx);
  const lines = frontmatterBlock.split(/\r?\n/);

  const data: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    // Skip empty lines and comments
    if (line.trim() === "" || line.trim().startsWith("#")) {
      i++;
      continue;
    }

    // Check for key: value or key: (array follows)
    const keyValueMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)?$/);
    if (!keyValueMatch) {
      i++;
      continue;
    }

    const key = keyValueMatch[1] ?? "";
    const rawValue = (keyValueMatch[2] ?? "").trim();

    if (rawValue === "" || rawValue === null) {
      // Check if next lines are list items
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j] ?? "";
        const listMatch = nextLine.match(/^\s+-\s+(.*)$/);
        if (listMatch) {
          items.push(stripQuotes((listMatch[1] ?? "").trim()));
          j++;
        } else if (nextLine.trim() === "") {
          j++;
          break;
        } else {
          break;
        }
      }
      data[key] = items.length > 0 ? items : "";
      i = j;
    } else {
      // Scalar value
      data[key] = stripQuotes(rawValue);
      i++;
    }
  }

  return { ok: true, data };
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Extract the body (after the frontmatter block) from a markdown file.
 * Returns empty string if no frontmatter or nothing after it.
 */
export function extractBody(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const rest = content.slice(3);
  const closeMatch = rest.search(/\n---(\r?\n|$)/);
  if (closeMatch === -1) {
    return "";
  }
  // Find where the closing --- ends
  const afterClose = rest.slice(closeMatch);
  const newlineAfterClose = afterClose.indexOf("\n");
  if (newlineAfterClose === -1) {
    return "";
  }
  // Second newline after the closing ---
  const bodyStart = closeMatch + newlineAfterClose + 1;
  return rest.slice(bodyStart);
}
