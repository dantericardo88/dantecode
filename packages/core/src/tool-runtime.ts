import { createHash } from "node:crypto";

export type LineEndingStyle = "lf" | "crlf" | "mixed" | "none";

export interface FileSnapshot {
  path: string;
  capturedAt: string;
  size: number;
  mtimeMs: number;
  hash: string;
  lineEnding: LineEndingStyle;
}

export interface ExactEditResult {
  matched: boolean;
  updatedContent?: string;
  occurrenceCount: number;
  replacementCount: number;
  usedNormalizedLineEndings: boolean;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }
  let index = 0;
  let count = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count++;
    index += needle.length;
  }
  return count;
}

export function detectLineEnding(content: string): LineEndingStyle {
  const hasCrLf = content.includes("\r\n");
  const normalized = content.replace(/\r\n/g, "");
  const hasLf = normalized.includes("\n");

  if (hasCrLf && hasLf) {
    return "mixed";
  }
  if (hasCrLf) {
    return "crlf";
  }
  if (hasLf) {
    return "lf";
  }
  return "none";
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizeLineEndings(content: string, target: "lf" | "crlf"): string {
  const normalized = content.replace(/\r\n/g, "\n");
  return target === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

export function preserveLineEndingsForWrite(nextContent: string, existingContent?: string): string {
  const existingStyle = detectLineEnding(existingContent ?? "");
  if (existingStyle === "crlf") {
    return normalizeLineEndings(nextContent, "crlf");
  }
  if (existingStyle === "lf") {
    return normalizeLineEndings(nextContent, "lf");
  }
  return nextContent;
}

export function createFileSnapshot(
  path: string,
  content: string,
  metadata: {
    mtimeMs?: number;
    size?: number;
    capturedAt?: string;
  } = {},
): FileSnapshot {
  return {
    path,
    capturedAt: metadata.capturedAt ?? new Date().toISOString(),
    size: metadata.size ?? Buffer.byteLength(content, "utf-8"),
    mtimeMs: metadata.mtimeMs ?? 0,
    hash: hashContent(content),
    lineEnding: detectLineEnding(content),
  };
}

export function isSnapshotStale(previous: FileSnapshot, current: FileSnapshot): boolean {
  return (
    previous.hash !== current.hash ||
    previous.size !== current.size ||
    previous.mtimeMs !== current.mtimeMs
  );
}

export function formatStaleSnapshotMessage(filePath: string): string {
  return (
    `Error: ${filePath} changed since the last full Read. ` +
    "Re-read the file before editing or overwriting it so you do not clobber newer changes."
  );
}

export function applyExactEdit(
  existingContent: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): ExactEditResult {
  const exactOccurrences = countOccurrences(existingContent, oldString);
  if (exactOccurrences > 0) {
    const updatedContent = replaceAll
      ? existingContent.split(oldString).join(newString)
      : existingContent.replace(oldString, newString);
    return {
      matched: true,
      updatedContent,
      occurrenceCount: exactOccurrences,
      replacementCount: replaceAll ? exactOccurrences : 1,
      usedNormalizedLineEndings: false,
    };
  }

  const existingNormalized = normalizeLineEndings(existingContent, "lf");
  const oldNormalized = normalizeLineEndings(oldString, "lf");
  const newNormalized = normalizeLineEndings(newString, "lf");
  const normalizedOccurrences = countOccurrences(existingNormalized, oldNormalized);

  if (normalizedOccurrences === 0) {
    return {
      matched: false,
      occurrenceCount: 0,
      replacementCount: 0,
      usedNormalizedLineEndings: false,
    };
  }

  const updatedNormalized = replaceAll
    ? existingNormalized.split(oldNormalized).join(newNormalized)
    : existingNormalized.replace(oldNormalized, newNormalized);
  const existingStyle = detectLineEnding(existingContent);
  const updatedContent =
    existingStyle === "crlf" ? normalizeLineEndings(updatedNormalized, "crlf") : updatedNormalized;

  return {
    matched: true,
    updatedContent,
    occurrenceCount: normalizedOccurrences,
    replacementCount: replaceAll ? normalizedOccurrences : 1,
    usedNormalizedLineEndings: true,
  };
}

export function truncateToolOutput(
  content: string,
  options: {
    maxChars?: number;
    headChars?: number;
    tailChars?: number;
  } = {},
): string {
  const maxChars = options.maxChars ?? 12_000;
  if (content.length <= maxChars) {
    return content;
  }

  const headChars = options.headChars ?? Math.floor(maxChars * 0.65);
  const tailChars = options.tailChars ?? Math.floor(maxChars * 0.2);
  const omittedChars = Math.max(0, content.length - headChars - tailChars);

  return [
    content.slice(0, headChars),
    `\n\n... (truncated ${omittedChars} chars) ...\n\n`,
    content.slice(-tailChars),
  ].join("");
}
