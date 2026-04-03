/**
 * acquire-url.ts — DTR Phase 3: Verified URL download tool
 *
 * Downloads a URL to a local file with:
 * - Size verification (rejects empty/stub responses)
 * - SHA-256 hash for artifact integrity
 * - ArtifactRecord registration for durable store persistence
 * - Detailed progress and error reporting for the model
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as https from "node:https";
import * as http from "node:http";

import { globalArtifactStore } from "./artifact-store.js";

export interface AcquireUrlOptions {
  /** URL to download */
  url: string;
  /** Destination path (absolute or relative to projectRoot) */
  dest: string;
  /** Project root for resolving relative paths */
  projectRoot: string;
  /** Minimum expected size in bytes (default: 64 — reject empty/error pages) */
  minSizeBytes?: number;
  /** Request timeout in ms (default: 120_000) */
  timeoutMs?: number;
  /** Maximum file size in bytes to accept (default: 500MB) */
  maxSizeBytes?: number;
  /** Whether to overwrite if dest already exists (default: false) */
  overwrite?: boolean;
}

export interface AcquireUrlResult {
  success: boolean;
  /** Absolute path of downloaded file (when success === true) */
  localPath?: string;
  /** File size in bytes */
  sizeBytes?: number;
  /** SHA-256 hash of the downloaded file */
  sha256?: string;
  /** HTTP status code */
  statusCode?: number;
  /** ArtifactRecord id in globalArtifactStore */
  artifactId?: string;
  errorMessage?: string;
  /** Human-readable result for the model */
  content: string;
  isError: boolean;
}

/**
 * Download a URL to a local file, verify it, and register an ArtifactRecord.
 */
export async function acquireUrl(options: AcquireUrlOptions): Promise<AcquireUrlResult> {
  const {
    url,
    projectRoot,
    minSizeBytes = 64,
    timeoutMs = 120_000,
    maxSizeBytes = 500 * 1024 * 1024,
    overwrite = false,
  } = options;

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return err(`Invalid URL: ${url}`);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return err(`Only HTTP/HTTPS URLs supported, got: ${parsedUrl.protocol}`);
  }

  // Resolve destination
  const dest = path.isAbsolute(options.dest) ? options.dest : path.join(projectRoot, options.dest);

  // Check overwrite policy
  if (!overwrite && fs.existsSync(dest)) {
    return err(
      `Destination already exists: ${dest}\n` +
        `Pass overwrite: true to replace it, or choose a different dest path.`,
    );
  }

  // Ensure parent directory exists
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
  } catch (e: unknown) {
    return err(`Could not create parent directory: ${String(e)}`);
  }

  // Download
  try {
    const { statusCode, sizeBytes } = await downloadToFile(url, dest, timeoutMs, maxSizeBytes);

    // Size check
    if (sizeBytes < minSizeBytes) {
      // Clean up the empty/small file
      try {
        fs.unlinkSync(dest);
      } catch {
        /* ignore */
      }
      return err(
        `Download completed but file is too small (${sizeBytes} bytes < ${minSizeBytes} minimum).\n` +
          `This usually means the URL returned an error page or redirect. Check the URL and try again.`,
      );
    }

    // Compute hash
    const sha256 = await hashFile(dest);

    // Register artifact
    const rec = globalArtifactStore.record({
      kind: "download",
      path: dest,
      toolCallId: "acquire-url",
      sourceUrl: url,
      sizeBytes,
    });
    globalArtifactStore.markVerified(rec.id);

    const sizeFmt = formatBytes(sizeBytes);
    return {
      success: true,
      localPath: dest,
      sizeBytes,
      sha256,
      statusCode,
      artifactId: rec.id,
      content:
        `[AcquireUrl] ✓ Downloaded ${url}\n` +
        `  → ${dest}\n` +
        `  Size: ${sizeFmt} | SHA-256: ${sha256.slice(0, 16)}...\n` +
        `  HTTP ${statusCode} | ArtifactID: ${rec.id}`,
      isError: false,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Clean up partial file
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    return err(`Download failed: ${msg}`);
  }
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function err(message: string): AcquireUrlResult {
  return {
    success: false,
    errorMessage: message,
    content: `[AcquireUrl] ERROR: ${message}`,
    isError: true,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function downloadToFile(
  url: string,
  dest: string,
  timeoutMs: number,
  maxSizeBytes: number,
): Promise<{ statusCode: number; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(dest);
    const client = url.startsWith("https:") ? https : http;

    const timeout = setTimeout(() => {
      fileStream.destroy();
      reject(new Error(`Download timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      const statusCode = res.statusCode ?? 0;

      // Follow redirects (up to 5)
      if (
        (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) &&
        res.headers.location
      ) {
        clearTimeout(timeout);
        fileStream.destroy();
        downloadToFile(res.headers.location, dest, timeoutMs, maxSizeBytes)
          .then(resolve)
          .catch(reject);
        return;
      }

      let sizeBytes = 0;
      res.pipe(fileStream);

      res.on("data", (chunk: Buffer) => {
        sizeBytes += chunk.length;
        if (sizeBytes > maxSizeBytes) {
          fileStream.destroy();
          res.destroy();
          reject(new Error(`File exceeds max size limit (${formatBytes(maxSizeBytes)})`));
        }
      });

      fileStream.on("finish", () => {
        clearTimeout(timeout);
        resolve({ statusCode, sizeBytes });
      });

      fileStream.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });

    req.on("error", (e) => {
      clearTimeout(timeout);
      fileStream.destroy();
      reject(e);
    });
  });
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}
