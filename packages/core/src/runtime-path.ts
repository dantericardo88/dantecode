import { fileURLToPath } from "node:url";
import { join } from "node:path";

type CallSiteLike = {
  getFileName?: () => string | null;
};

function normalizeStackFile(fileName: string): string {
  return fileName.startsWith("file://") ? fileURLToPath(fileName) : fileName;
}

/**
 * Determine the current module's file path via stack trace inspection.
 * Throws if the path cannot be determined — prefer `getSafeModulePath()` in
 * contexts where a fallback is acceptable (bundled extensions, Electron).
 */
export function getCurrentModulePath(): string {
  const originalPrepareStackTrace = Error.prepareStackTrace;

  try {
    Error.prepareStackTrace = (_error, structuredStackTrace) => structuredStackTrace;
    const error = new Error();
    Error.captureStackTrace(error, getCurrentModulePath);
    const stack = error.stack as unknown as CallSiteLike[] | undefined;

    for (const frame of stack ?? []) {
      const fileName = frame.getFileName?.();
      if (fileName) {
        return normalizeStackFile(fileName);
      }
    }
  } finally {
    Error.prepareStackTrace = originalPrepareStackTrace;
  }

  throw new Error("Unable to determine current module path.");
}

/**
 * Safe variant that never throws. Falls back to `__filename` (CJS) or
 * `process.cwd()` when stack trace inspection fails — e.g. inside a
 * bundled VS Code extension running in Electron.
 */
export function getSafeModulePath(): string {
  try {
    return getCurrentModulePath();
  } catch {
    // In CJS bundles (VS Code extension), __filename is available
    if (typeof __filename === "string" && __filename) {
      return __filename;
    }
    // Last resort — resolve from cwd
    return join(process.cwd(), "__virtual_module__.js");
  }
}
