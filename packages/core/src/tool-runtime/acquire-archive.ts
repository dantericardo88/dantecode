/**
 * acquire-archive.ts — DTR Phase 3: Download + extract archive with verification
 *
 * Downloads a .tar.gz, .tgz, .zip, or .tar.bz2 archive, extracts it to a
 * target directory, verifies the extraction produced files, and registers
 * ArtifactRecords for both the archive and the extracted directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import { acquireUrl } from './acquire-url.js';
import { globalArtifactStore } from './artifact-store.js';

export interface AcquireArchiveOptions {
  /** URL of the archive to download */
  url: string;
  /** Directory to extract into (absolute or relative to projectRoot) */
  extractTo: string;
  /** Project root for path resolution */
  projectRoot: string;
  /** Whether to strip the top-level directory from the archive (default: false) */
  stripComponents?: number;
  /** Whether to overwrite extractTo if it already exists (default: false) */
  overwrite?: boolean;
  /** Download timeout in ms (default: 120_000) */
  timeoutMs?: number;
}

export interface AcquireArchiveResult {
  success: boolean;
  /** Absolute path of extracted directory */
  extractedPath?: string;
  /** Absolute path of downloaded archive file */
  archivePath?: string;
  /** Number of files extracted */
  fileCount?: number;
  /** ArtifactRecord id for the extracted directory */
  artifactId?: string;
  errorMessage?: string;
  /** Human-readable result for the model */
  content: string;
  isError: boolean;
}

/**
 * Download an archive from URL, extract it, verify contents, and register artifacts.
 */
export async function acquireArchive(options: AcquireArchiveOptions): Promise<AcquireArchiveResult> {
  const {
    url,
    projectRoot,
    stripComponents = 0,
    overwrite = false,
    timeoutMs = 120_000,
  } = options;

  const extractTo = path.isAbsolute(options.extractTo)
    ? options.extractTo
    : path.join(projectRoot, options.extractTo);

  // Check overwrite policy on extract directory
  if (!overwrite && fs.existsSync(extractTo)) {
    return err(
      `Extraction target already exists: ${extractTo}\n` +
      `Pass overwrite: true or choose a different extractTo path.`,
    );
  }

  // Determine archive filename from URL
  const archiveFilename = detectArchiveFilename(url);
  if (!archiveFilename) {
    return err(
      `Could not determine archive type from URL: ${url}\n` +
      `Supported: .tar.gz, .tgz, .tar.bz2, .tar.xz, .zip`,
    );
  }

  const archivePath = path.join(projectRoot, '.dantecode', 'downloads', archiveFilename);

  // Download the archive
  const dlResult = await acquireUrl({
    url,
    dest: archivePath,
    projectRoot,
    minSizeBytes: 256, // archives are always > 256 bytes
    timeoutMs,
    overwrite: true, // always re-download archive to downloads cache
  });

  if (!dlResult.success) {
    return err(`Download failed: ${dlResult.errorMessage}`);
  }

  // Create extraction directory
  try {
    fs.mkdirSync(extractTo, { recursive: true });
  } catch (e: unknown) {
    return err(`Could not create extraction directory: ${String(e)}`);
  }

  // Extract based on archive type
  try {
    extractArchive(archivePath, extractTo, archiveFilename, stripComponents);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`Extraction failed: ${msg}`);
  }

  // Verify extraction produced files
  let fileCount = 0;
  try {
    fileCount = countFiles(extractTo);
  } catch {
    fileCount = 0;
  }

  if (fileCount === 0) {
    return err(
      `Archive was downloaded but extraction produced no files in: ${extractTo}\n` +
      `The archive may be corrupt, empty, or require a different strip-components value.`,
    );
  }

  // Register extracted directory as artifact
  const rec = globalArtifactStore.record({
    kind: 'archive_extract',
    path: extractTo,
    toolCallId: 'acquire-archive',
    sourceUrl: url,
  });
  globalArtifactStore.markVerified(rec.id);

  return {
    success: true,
    extractedPath: extractTo,
    archivePath,
    fileCount,
    artifactId: rec.id,
    content:
      `[AcquireArchive] ✓ Downloaded and extracted ${url}\n` +
      `  Archive: ${archivePath}\n` +
      `  Extracted to: ${extractTo}\n` +
      `  Files extracted: ${fileCount}\n` +
      `  ArtifactID: ${rec.id}\n` +
      `\nYou can now use Read/Glob/Grep to explore the extracted contents.`,
    isError: false,
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function err(message: string): AcquireArchiveResult {
  return { success: false, errorMessage: message, content: `[AcquireArchive] ERROR: ${message}`, isError: true };
}

function detectArchiveFilename(url: string): string | null {
  const urlPath = new URL(url).pathname;
  const basename = path.basename(urlPath);

  const supported = ['.tar.gz', '.tgz', '.tar.bz2', '.tar.xz', '.zip', '.tar'];
  for (const ext of supported) {
    if (basename.endsWith(ext)) return basename;
  }
  return null;
}

function extractArchive(
  archivePath: string,
  extractTo: string,
  filename: string,
  stripComponents: number,
): void {
  if (filename.endsWith('.zip')) {
    // Try unzip first, fall back to python — both use array args (no shell injection)
    try {
      execFileSync("unzip", ["-q", archivePath, "-d", extractTo], { timeout: 120_000 });
      return;
    } catch {
      // python3 -c receives archivePath + extractTo as sys.argv, not shell-expanded
      execFileSync("python3", [
        "-c",
        "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
        archivePath,
        extractTo,
      ], { timeout: 120_000 });
      return;
    }
  }

  // tar-based: .tar.gz, .tgz, .tar.bz2, .tar.xz, .tar
  let flag = '';
  if (filename.endsWith('.tar.gz') || filename.endsWith('.tgz')) flag = 'z';
  else if (filename.endsWith('.tar.bz2')) flag = 'j';
  else if (filename.endsWith('.tar.xz')) flag = 'J';

  const tarArgs = [flag ? `-x${flag}f` : "-xf", archivePath, "-C", extractTo];
  if (stripComponents > 0) tarArgs.push(`--strip-components=${stripComponents}`);
  execFileSync("tar", tarArgs, { timeout: 120_000 });
}

function countFiles(dir: string): number {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    count++;
    if (entry.isDirectory()) {
      try {
        count += countFiles(path.join(dir, entry.name));
      } catch { /* ignore */ }
    }
  }
  return count;
}
