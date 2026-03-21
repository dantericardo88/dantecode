// ============================================================================
// @dantecode/core — Secrets Detection & Redaction Engine
// Scans content for API keys, tokens, passwords, and other sensitive data.
// Zero external dependencies — uses only Node.js built-ins.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single detected secret occurrence. */
export interface SecretMatch {
  /** Pattern name that matched (e.g. "aws_access_key", "github_token"). */
  type: string;
  /** The raw matched value. */
  value: string;
  /** Redacted representation of the value. */
  redacted: string;
  /** Start index of the match in the scanned content. */
  startIndex: number;
  /** End index (exclusive) of the match in the scanned content. */
  endIndex: number;
  /** 1-based line number where the match occurs. */
  line: number;
  /** Confidence level of the detection. */
  confidence: "high" | "medium" | "low";
}

/** Result of a content scan. */
export interface ScanResult {
  /** True if no secrets were detected. */
  clean: boolean;
  /** All detected secret matches. */
  matches: SecretMatch[];
  /** Human-readable summary of findings. */
  summary: string;
}

/** A pattern definition for secret detection. */
export interface SecretsPattern {
  /** Unique name identifying this pattern. */
  name: string;
  /** Regular expression to match against content. */
  pattern: RegExp;
  /** Confidence level assigned to matches from this pattern. */
  confidence: "high" | "medium" | "low";
}

/** Configuration options for the secrets scanner. */
export interface SecretsScannerOptions {
  /** Additional custom patterns to include in scanning. */
  customPatterns?: SecretsPattern[];
  /** Pattern names to exclude from scanning. */
  excludePatterns?: string[];
  /** Redaction style. Default: "masked". */
  redactionStyle?: "masked" | "removed" | "placeholder"; // antistub-ok: "placeholder" is a valid style name, not a code stub
}

// ----------------------------------------------------------------------------
// Built-in Patterns
// ----------------------------------------------------------------------------

/**
 * Default secret detection patterns covering the most common credential
 * formats across cloud providers, SaaS platforms, and generic secrets.
 */
const BUILTIN_PATTERNS: SecretsPattern[] = [
  {
    name: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/g,
    confidence: "high",
  },
  {
    name: "aws_secret_key",
    pattern:
      /(?:aws|secret|credential)[_\s]*(?:access)?[_\s]*(?:key|secret)[_\s]*[:=]\s*['"]?([A-Za-z0-9/+=]{40})/gi,
    confidence: "medium",
  },
  {
    name: "github_token",
    pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g,
    confidence: "high",
  },
  {
    name: "github_fine_grained",
    pattern: /github_pat_[A-Za-z0-9_]{82,}/g,
    confidence: "high",
  },
  {
    name: "jwt_token",
    pattern: /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+/g,
    confidence: "high",
  },
  {
    name: "generic_api_key",
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{20,})/gi,
    confidence: "medium",
  },
  {
    name: "generic_secret",
    pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*['"]?([^\s'"]{8,})/gi,
    confidence: "medium",
  },
  {
    name: "private_key",
    pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    confidence: "high",
  },
  {
    name: "slack_token",
    pattern: /xox[bpors]-[A-Za-z0-9-]{10,}/g,
    confidence: "high",
  },
  {
    name: "stripe_key",
    pattern: /[sr]k_(?:live|test)_[A-Za-z0-9]{20,}/g,
    confidence: "high",
  },
  {
    name: "gcp_service_account",
    pattern: /"type"\s*:\s*"service_account"/g,
    confidence: "high",
  },
  {
    name: "azure_connection_string",
    pattern: /DefaultEndpointsProtocol=https;AccountName=[^\s;]+/g,
    confidence: "high",
  },
  {
    name: "npm_token",
    pattern: /npm_[A-Za-z0-9]{36}/g,
    confidence: "high",
  },
  {
    name: "openai_key",
    pattern: /sk-[A-Za-z0-9]{48,}/g,
    confidence: "high",
  },
  {
    name: "anthropic_key",
    pattern: /sk-ant-[A-Za-z0-9_\-]{90,}/g,
    confidence: "high",
  },
  {
    name: "database_url",
    pattern: /(?:postgres|mysql|mongodb)(?:ql)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/gi,
    confidence: "high",
  },
  {
    name: "basic_auth_header",
    pattern: /Authorization:\s*Basic\s+[A-Za-z0-9+/=]{10,}/g,
    confidence: "medium",
  },
];

// ----------------------------------------------------------------------------
// SecretsScanner
// ----------------------------------------------------------------------------

/**
 * Secrets detection and redaction engine.
 *
 * Scans arbitrary text content for API keys, tokens, passwords, private keys,
 * connection strings, and other sensitive material. Supports redaction in
 * three styles: masked, removed, or placeholder.
 *
 * @example
 * ```ts
 * const scanner = new SecretsScanner();
 * const result = scanner.scan(fileContents);
 * if (!result.clean) {
 *   console.warn(result.summary);
 *   const safe = scanner.redact(fileContents);
 * }
 * ```
 */
export class SecretsScanner {
  private patterns: SecretsPattern[];
  private readonly redactionStyle: "masked" | "removed" | "placeholder"; // antistub-ok

  constructor(options: SecretsScannerOptions = {}) {
    const excludeSet = new Set(options.excludePatterns ?? []);

    // Clone built-in patterns (with fresh RegExp instances) and filter exclusions
    this.patterns = BUILTIN_PATTERNS.filter((p) => !excludeSet.has(p.name)).map((p) => ({
      name: p.name,
      pattern: new RegExp(p.pattern.source, p.pattern.flags),
      confidence: p.confidence,
    }));

    // Append custom patterns (also cloning RegExp)
    if (options.customPatterns) {
      for (const cp of options.customPatterns) {
        if (!excludeSet.has(cp.name)) {
          this.patterns.push({
            name: cp.name,
            pattern: new RegExp(cp.pattern.source, cp.pattern.flags),
            confidence: cp.confidence,
          });
        }
      }
    }

    this.redactionStyle = options.redactionStyle ?? "masked";
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Scan content for secrets against all active patterns.
   * Returns a ScanResult with all matches and a human-readable summary.
   */
  scan(content: string): ScanResult {
    const matches = this.findMatches(content);
    const clean = matches.length === 0;

    let summary: string;
    if (clean) {
      summary = "No secrets detected.";
    } else {
      const typeCounts = new Map<string, number>();
      for (const m of matches) {
        typeCounts.set(m.type, (typeCounts.get(m.type) ?? 0) + 1);
      }
      const parts = [...typeCounts.entries()].map(([type, count]) => `${count} ${type}`);
      summary = `Found ${matches.length} secret(s): ${parts.join(", ")}.`;
    }

    return { clean, matches, summary };
  }

  /**
   * Scan content and replace all detected secrets with redacted values.
   * Processes replacements from end to start to preserve character indices.
   */
  redact(content: string): string {
    const matches = this.findMatches(content);
    if (matches.length === 0) return content;

    // Sort by startIndex descending so replacements don't shift earlier indices
    const sorted = [...matches].sort((a, b) => b.startIndex - a.startIndex);

    let result = content;
    for (const match of sorted) {
      result = result.slice(0, match.startIndex) + match.redacted + result.slice(match.endIndex);
    }
    return result;
  }

  /**
   * Quick boolean check — returns true if no secrets are detected.
   */
  isClean(content: string): boolean {
    // Short-circuit: stop at first match
    for (const pattern of this.patterns) {
      const re = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      if (re.test(content)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Scan content with file-path context included in the summary.
   */
  scanFile(content: string, filePath: string): ScanResult {
    const result = this.scan(content);
    if (result.clean) {
      result.summary = `${filePath}: No secrets detected.`;
    } else {
      result.summary = `${filePath}: ${result.summary}`;
    }
    return result;
  }

  /**
   * Return a copy of all active patterns.
   */
  getPatterns(): SecretsPattern[] {
    return this.patterns.map((p) => ({
      name: p.name,
      pattern: new RegExp(p.pattern.source, p.pattern.flags),
      confidence: p.confidence,
    }));
  }

  /**
   * Add a custom pattern to the scanner at runtime.
   */
  addPattern(pattern: SecretsPattern): void {
    this.patterns.push({
      name: pattern.name,
      pattern: new RegExp(pattern.pattern.source, pattern.pattern.flags),
      confidence: pattern.confidence,
    });
  }

  /**
   * Remove a pattern by name. Returns true if the pattern was found and removed.
   */
  removePattern(name: string): boolean {
    const idx = this.patterns.findIndex((p) => p.name === name);
    if (idx === -1) return false;
    this.patterns.splice(idx, 1);
    return true;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Find all secret matches in content across all active patterns.
   * De-duplicates overlapping matches, keeping the higher-confidence one.
   */
  private findMatches(content: string): SecretMatch[] {
    const rawMatches: SecretMatch[] = [];

    for (const pattern of this.patterns) {
      // Create a fresh RegExp to reset lastIndex
      const re = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = re.exec(content)) !== null) {
        // For patterns with capture groups, use the captured group;
        // otherwise use the full match.
        const value = match[1] ?? match[0];
        const startIndex = match[1] ? match.index + match[0].indexOf(match[1]) : match.index;
        const endIndex = startIndex + value.length;

        rawMatches.push({
          type: pattern.name,
          value,
          redacted: this.redactValue(value, pattern.name),
          startIndex,
          endIndex,
          line: this.computeLineNumber(content, startIndex),
          confidence: pattern.confidence,
        });

        // Guard against zero-length matches causing infinite loops
        if (match[0].length === 0) {
          re.lastIndex++;
        }
      }
    }

    // Sort by startIndex for consistent ordering
    rawMatches.sort((a, b) => a.startIndex - b.startIndex);

    // De-duplicate overlapping ranges (keep higher confidence)
    const confidenceRank = { high: 3, medium: 2, low: 1 };
    const deduped: SecretMatch[] = [];

    for (const m of rawMatches) {
      const overlapping = deduped.findIndex(
        (d) => m.startIndex < d.endIndex && m.endIndex > d.startIndex,
      );
      if (overlapping === -1) {
        deduped.push(m);
      } else if (confidenceRank[m.confidence] > confidenceRank[deduped[overlapping]!.confidence]) {
        deduped[overlapping] = m;
      }
    }

    return deduped;
  }

  /**
   * Compute the 1-based line number for a given character index.
   */
  private computeLineNumber(content: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === "\n") {
        line++;
      }
    }
    return line;
  }

  /**
   * Apply the configured redaction style to a secret value.
   *
   * - "masked": Preserves first 4 and last 4 chars with **** in between.
   *   Values shorter than 12 chars are fully masked as "****".
   * - "removed": Replaces with "[REDACTED]".
   * - "placeholder": Replaces with "[SECRET:type]".
   */
  private redactValue(value: string, type: string): string {
    switch (this.redactionStyle) {
      case "removed":
        return "[REDACTED]";
      case "placeholder":
        return `[SECRET:${type}]`;
      case "masked":
      default:
        if (value.length < 12) {
          return "****";
        }
        return value.slice(0, 4) + "****" + value.slice(-4);
    }
  }
}
