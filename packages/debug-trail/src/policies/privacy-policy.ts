// ============================================================================
// @dantecode/debug-trail — Privacy Policy
// Controls what data is captured, redacted, or excluded from the trail.
// Local-first, optional encryption support.
// ============================================================================

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { TrailEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Policy config
// ---------------------------------------------------------------------------

export interface PrivacyPolicyConfig {
  /** File path patterns to exclude from snapshotting. */
  excludePathPatterns: string[];
  /** File path patterns to redact content (still log event, not content). */
  redactContentPatterns: string[];
  /** Max snapshot size — larger files are logged but not snapshotted. Default: 50MB */
  maxSnapshotBytes: number;
  /** Redact environment variables from tool call payloads. Default: true */
  redactEnvVars: boolean;
  /** Exclude node_modules, .git, dist from snapshots. Default: true */
  excludeCommonNoise: boolean;
}

const COMMON_NOISE_PATTERNS = [
  "node_modules/",
  ".git/",
  "dist/",
  ".turbo/",
  "*.lock",
  ".env",
  ".env.*",
];

const DEFAULT_PRIVACY: PrivacyPolicyConfig = {
  excludePathPatterns: [],
  redactContentPatterns: ["*.env", "*.key", "*.pem", "*.secret", "*.credentials"],
  maxSnapshotBytes: 50 * 1024 * 1024, // 50MB
  redactEnvVars: true,
  excludeCommonNoise: true,
};

const ENV_VAR_RE = /\b([A-Z_][A-Z0-9_]{2,}=)[^\s"'&;|]+/g;
const SECRET_KEY_RE = /"(api_?key|secret|password|token|auth|credential)":\s*"[^"]+"/gi;

// ---------------------------------------------------------------------------
// Privacy Policy
// ---------------------------------------------------------------------------

export class PrivacyPolicy {
  private config: PrivacyPolicyConfig;
  private excludePatterns: RegExp[];
  private redactPatterns: RegExp[];

  constructor(config?: Partial<PrivacyPolicyConfig>) {
    this.config = { ...DEFAULT_PRIVACY, ...config };

    const allExclude = [
      ...(this.config.excludeCommonNoise ? COMMON_NOISE_PATTERNS : []),
      ...this.config.excludePathPatterns,
    ];
    this.excludePatterns = allExclude.map(globToRegex);
    this.redactPatterns = this.config.redactContentPatterns.map(globToRegex);
  }

  /** Check if a file path should be excluded from snapshotting entirely. */
  shouldExcludePath(filePath: string): boolean {
    return this.excludePatterns.some((re) => re.test(filePath));
  }

  /** Check if a file path's content should be redacted (capture event but not content). */
  shouldRedactContent(filePath: string): boolean {
    return this.redactPatterns.some((re) => re.test(filePath));
  }

  /** Check if file is too large for snapshotting. */
  tooLargeForSnapshot(sizeBytes: number): boolean {
    return sizeBytes > this.config.maxSnapshotBytes;
  }

  /**
   * Unified capture decision for FileSnapshotter.
   * Returns "exclude" if the path should not be snapshotted at all,
   * "redact" if content should be sanitized before storing,
   * "capture" if normal snapshot capture is allowed.
   */
  evaluateCapture(filePath: string, sizeBytes: number): "exclude" | "redact" | "capture" {
    if (this.shouldExcludePath(filePath)) return "exclude";
    // Exclude very large files (>10MB) to avoid storage explosion
    if (sizeBytes > 10 * 1024 * 1024) return "exclude";
    if (this.shouldRedactContent(filePath)) return "redact";
    return "capture";
  }

  /**
   * Sanitize a trail event payload by redacting sensitive fields.
   * Returns a new event with redacted payload.
   */
  sanitizeEvent(event: TrailEvent): TrailEvent {
    if (!this.config.redactEnvVars) return event;

    const payloadStr = JSON.stringify(event.payload);
    let sanitized = payloadStr.replace(ENV_VAR_RE, "$1[REDACTED]");
    sanitized = sanitized.replace(SECRET_KEY_RE, (_, key: string) => `"${key}": "[REDACTED]"`);

    let newPayload: Record<string, unknown>;
    try {
      newPayload = JSON.parse(sanitized) as Record<string, unknown>;
    } catch {
      newPayload = { ...event.payload, _redacted: true };
    }

    return { ...event, payload: newPayload };
  }

  /**
   * Filter and sanitize a batch of events for export.
   * Removes excluded path events and sanitizes payloads.
   */
  filterForExport(events: TrailEvent[]): TrailEvent[] {
    return events
      .filter((e) => {
        const fp = e.payload["filePath"];
        if (typeof fp === "string" && this.shouldExcludePath(fp)) return false;
        return true;
      })
      .map((e) => this.sanitizeEvent(e));
  }

  /** Get active exclude patterns as strings. */
  getExcludePatterns(): string[] {
    const all = [
      ...(this.config.excludeCommonNoise ? COMMON_NOISE_PATTERNS : []),
      ...this.config.excludePathPatterns,
    ];
    return all;
  }
}

// ---------------------------------------------------------------------------
// Glob-to-regex helper
// ---------------------------------------------------------------------------

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape special chars
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(escaped, "i");
}

// ---------------------------------------------------------------------------
// Storage Quota Policy
// ---------------------------------------------------------------------------

/** Enforces storage quota by measuring snapshot directory size. */
export class StorageQuotaPolicy {
  private readonly maxBytes: number;

  constructor(maxMb: number) {
    this.maxBytes = maxMb * 1024 * 1024;
  }

  async checkQuota(
    snapshotsDir: string,
  ): Promise<{ ok: boolean; usedBytes: number; limitBytes: number; usedMb: number; limitMb: number }> {
    const usedBytes = await this.measureDir(snapshotsDir);
    return {
      ok: usedBytes < this.maxBytes,
      usedBytes,
      limitBytes: this.maxBytes,
      usedMb: Math.round(usedBytes / 1024 / 1024 * 100) / 100,
      limitMb: Math.round(this.maxBytes / 1024 / 1024 * 100) / 100,
    };
  }

  private async measureDir(dir: string): Promise<number> {
    let total = 0;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          total += await this.measureDir(full);
        } else if (entry.isFile()) {
          const s = await stat(full);
          total += s.size;
        }
      }
    } catch {
      // dir doesn't exist yet — quota is 0 used
    }
    return total;
  }
}
