// ============================================================================
// @dantecode/core — Context Mention Resolver
// Resolves @mention tokens (URL, git-ref, image) into ContextChunks for
// prompt injection. All I/O is injectable for deterministic testing.
// ============================================================================

import { basename, extname } from "node:path";

// ─── Types ───────────────────────────────────────────────────────────────────

export type MentionType = "file" | "symbol" | "url" | "git-ref" | "image" | "unknown";

export interface ContextChunk {
  /** The resolved mention type. */
  type: MentionType;
  /** Display label for UI pill. */
  label: string;
  /** Text content to inject into the prompt. */
  content: string;
  /** Base64-encoded image data (image type only). */
  base64?: string;
  /** MIME type string (image type only). */
  mimeType?: string;
}

// ─── MIME detection ──────────────────────────────────────────────────────────

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function mimeFromExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_MIME[ext] ?? "application/octet-stream";
}

// ─── Classification ───────────────────────────────────────────────────────────

/**
 * Classify a raw @mention string into a MentionType.
 * File and symbol resolution is handled elsewhere; this covers url / git-ref / image.
 */
export function classifyMention(raw: string): MentionType {
  if (/^https?:\/\//i.test(raw)) return "url";
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(raw)) return "image";
  if (/^[0-9a-f]{6,40}$/.test(raw) || /^[a-zA-Z0-9/_-]+$/.test(raw)) return "git-ref";
  return "unknown";
}

// ─── Default I/O helpers ─────────────────────────────────────────────────────

const defaultFetchUrl = async (url: string): Promise<string> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const html = await res.text();
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
};

const defaultExecGit = async (args: string[]): Promise<string> => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  return promisify(execFile)("git", args, { timeout: 5000 }).then((r) => r.stdout);
};

const defaultReadFile = async (path: string): Promise<Buffer> => {
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
};

// ─── Resolution ───────────────────────────────────────────────────────────────

export interface ResolveMentionOptions {
  /** Override HTTP fetch (injectable for tests). */
  fetchUrl?: (url: string) => Promise<string>;
  /** Override git execution (injectable for tests). */
  execGit?: (args: string[]) => Promise<string>;
  /** Override file reading (injectable for tests). */
  readFile?: (path: string) => Promise<Buffer>;
}

/**
 * Resolve a raw @mention string into a ContextChunk ready for prompt injection.
 * Never throws — unresolvable mentions return `{ type: "unknown", content: "" }`.
 */
export async function resolveMention(
  raw: string,
  opts: ResolveMentionOptions = {},
): Promise<ContextChunk> {
  const type = classifyMention(raw);
  const fetchUrl = opts.fetchUrl ?? defaultFetchUrl;
  const execGit = opts.execGit ?? defaultExecGit;
  const readFile = opts.readFile ?? defaultReadFile;

  if (type === "url") {
    try {
      const text = await fetchUrl(raw);
      const content = text.slice(0, 3000);
      const hostname = (() => {
        try {
          return new URL(raw).hostname;
        } catch {
          return raw;
        }
      })();
      return { type: "url", label: hostname, content };
    } catch {
      return { type: "unknown", label: raw, content: "" };
    }
  }

  if (type === "git-ref") {
    try {
      let output: string;
      try {
        output = await execGit(["show", "--stat", raw]);
      } catch {
        output = await execGit(["log", "--oneline", "-5", raw]);
      }
      return { type: "git-ref", label: raw, content: output.slice(0, 2000) };
    } catch {
      return { type: "unknown", label: raw, content: "" };
    }
  }

  if (type === "image") {
    try {
      const buf = await readFile(raw);
      const base64 = buf.toString("base64");
      const mimeType = mimeFromExt(raw);
      return {
        type: "image",
        label: basename(raw),
        content: "[image attached]",
        base64,
        mimeType,
      };
    } catch {
      return { type: "unknown", label: raw, content: "" };
    }
  }

  // unknown
  return { type: "unknown", label: raw, content: "" };
}
