/**
 * tool-adapters.ts — DTR Phase 2: Typed tool execution wrappers
 *
 * Each adapter takes the raw `{ content: string; isError: boolean }` result
 * from executeTool() and enriches it with structured ToolExecutionEvidence.
 *
 * Design: purely additive — callers can ignore evidence without any change.
 * The adapter layer does NOT replace executeTool(); it only post-processes results.
 */

import type { ToolExecutionEvidence, ToolExecutionResult } from './tool-call-types.js';

// ─── Raw tool result (matches existing executeTool return type) ───────────────

export interface RawToolResult {
  content: string;
  isError: boolean;
}

// ─── Generic Wrapper ──────────────────────────────────────────────────────────

/**
 * Wrap any raw tool result in a ToolExecutionResult.
 * Use the specialized adapters below for richer evidence.
 */
export function wrapToolResult(
  raw: RawToolResult,
  evidence?: Partial<ToolExecutionEvidence>,
): ToolExecutionResult {
  return {
    content: raw.content,
    isError: raw.isError,
    evidence: evidence ? buildEvidence(evidence) : undefined,
  };
}

// ─── Read Adapter ─────────────────────────────────────────────────────────────

export function adaptReadResult(
  raw: RawToolResult,
  filePath: string,
  startMs: number,
): ToolExecutionResult {
  return {
    content: raw.content,
    isError: raw.isError,
    evidence: {
      filesRead: raw.isError ? [] : [filePath],
      durationMs: Date.now() - startMs,
    },
  };
}

// ─── Write / Edit Adapter ─────────────────────────────────────────────────────

export function adaptWriteResult(
  raw: RawToolResult,
  filePath: string,
  startMs: number,
): ToolExecutionResult {
  return {
    content: raw.content,
    isError: raw.isError,
    evidence: {
      filesWritten: raw.isError ? [] : [filePath],
      durationMs: Date.now() - startMs,
    },
  };
}

// ─── Bash Adapter ─────────────────────────────────────────────────────────────

/**
 * Adapt a Bash result with exit code detection and timing.
 * Exit codes are inferred from the content string since the tool returns text.
 */
export function adaptBashResult(
  raw: RawToolResult,
  command: string,
  startMs: number,
): ToolExecutionResult {
  const exitCode = inferBashExitCode(raw);
  const filesWritten = inferBashWrittenFiles(command, raw);
  const bytesTransferred = inferBashTransferBytes(raw);

  return {
    content: raw.content,
    isError: raw.isError,
    evidence: {
      exitCode,
      filesWritten,
      bytesTransferred,
      durationMs: Date.now() - startMs,
    },
  };
}

/** Heuristic: detect exit code from raw bash output */
function inferBashExitCode(raw: RawToolResult): number {
  if (raw.isError) {
    // Try to find "exit code N" pattern in content
    const match = raw.content.match(/exit(?:\s+code)?\s+(\d+)/i);
    return match ? parseInt(match[1]!, 10) : 1;
  }
  return 0;
}

/** Heuristic: detect files written by git operations */
function inferBashWrittenFiles(command: string, raw: RawToolResult): string[] {
  const written: string[] = [];

  // npm install / npm run build creates node_modules or dist
  if (/\bnpm\s+(install|ci|run\s+build)\b/i.test(command) && !raw.isError) {
    return []; // Don't enumerate — too many files
  }

  // git clone creates a directory
  const cloneMatch = command.match(/\bgit\s+clone\b[^\n]*\s+(\S+)\s*$/);
  if (cloneMatch && !raw.isError) {
    written.push(cloneMatch[1]!);
  }

  return written;
}

/** Heuristic: detect bytes transferred from curl/wget/npm output */
function inferBashTransferBytes(raw: RawToolResult): number | undefined {
  // curl: "100 12345B"
  const curlMatch = raw.content.match(/(\d+)\s*B(?:ytes)?\s+(?:transferred|downloaded)/i);
  if (curlMatch) return parseInt(curlMatch[1]!, 10);

  // wget: "12345 bytes saved"
  const wgetMatch = raw.content.match(/(\d+)\s+bytes\s+(?:saved|received)/i);
  if (wgetMatch) return parseInt(wgetMatch[1]!, 10);

  return undefined;
}

// ─── WebSearch / WebFetch Adapter ─────────────────────────────────────────────

export function adaptWebResult(
  raw: RawToolResult,
  startMs: number,
): ToolExecutionResult {
  return {
    content: raw.content,
    isError: raw.isError,
    evidence: {
      bytesTransferred: raw.isError ? 0 : raw.content.length,
      durationMs: Date.now() - startMs,
    },
  };
}

// ─── SubAgent Adapter ─────────────────────────────────────────────────────────

export function adaptSubAgentResult(
  raw: RawToolResult,
  startMs: number,
): ToolExecutionResult {
  return {
    content: raw.content,
    isError: raw.isError,
    evidence: {
      durationMs: Date.now() - startMs,
    },
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Dispatch to the right adapter based on tool name.
 * Falls back to wrapToolResult for unrecognized tools.
 */
export function adaptToolResult(
  toolName: string,
  input: Record<string, unknown>,
  raw: RawToolResult,
  startMs: number,
): ToolExecutionResult {
  switch (toolName) {
    case 'Read':
    case 'Glob':
    case 'Grep':
      return adaptReadResult(raw, String(input['file_path'] ?? input['pattern'] ?? ''), startMs);

    case 'Write':
    case 'Edit':
      return adaptWriteResult(raw, String(input['file_path'] ?? ''), startMs);

    case 'Bash':
      return adaptBashResult(raw, String(input['command'] ?? ''), startMs);

    case 'WebSearch':
    case 'WebFetch':
      return adaptWebResult(raw, startMs);

    case 'SubAgent':
      return adaptSubAgentResult(raw, startMs);

    default:
      return wrapToolResult(raw, { durationMs: Date.now() - startMs });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEvidence(
  partial: Partial<ToolExecutionEvidence>,
): ToolExecutionEvidence {
  return {
    exitCode: partial.exitCode,
    filesWritten: partial.filesWritten,
    filesRead: partial.filesRead,
    bytesTransferred: partial.bytesTransferred,
    durationMs: partial.durationMs,
  };
}

// ─── Evidence Summary ─────────────────────────────────────────────────────────

/**
 * Format a ToolExecutionEvidence as a human-readable one-liner.
 * Used for verbose logging.
 */
export function formatEvidenceSummary(result: ToolExecutionResult): string {
  const e = result.evidence;
  if (!e) return '';

  const parts: string[] = [];
  if (e.durationMs !== undefined) parts.push(`${e.durationMs}ms`);
  if (e.exitCode !== undefined) parts.push(`exit=${e.exitCode}`);
  if (e.filesWritten && e.filesWritten.length > 0)
    parts.push(`wrote=${e.filesWritten.length}`);
  if (e.filesRead && e.filesRead.length > 0)
    parts.push(`read=${e.filesRead.length}`);
  if (e.bytesTransferred !== undefined)
    parts.push(`bytes=${e.bytesTransferred}`);

  return parts.length ? `[${parts.join(' ')}]` : '';
}
