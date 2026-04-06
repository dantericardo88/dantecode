// ============================================================================
// xml-artifact-parser.ts — XML Artifact Protocol
// Based on Bolt.DIY's <boltArtifact>/<boltAction> tag format.
// DanteCode uses <danteArtifact>/<danteAction> to avoid conflicts.
//
// Example AI response:
//   <danteArtifact id="app" title="My App" type="coding">
//     <danteAction type="file" filePath="src/index.ts">
//       console.log("hello");
//     </danteAction>
//     <danteAction type="shell">npm install</danteAction>
//   </danteArtifact>
// ============================================================================

import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArtifactActionType = "file" | "shell" | "build" | "start";

export interface ArtifactAction {
  id: string;
  type: ArtifactActionType;
  /** For type="file" */
  filePath?: string;
  /** For type="shell" | "build" | "start" */
  command?: string;
  /** File content or command string */
  content: string;
  status: "pending" | "running" | "complete" | "error";
}

export interface ParsedArtifact {
  id: string;
  title: string;
  type: "coding" | "explanation";
  actions: ArtifactAction[];
}

export interface ArtifactParseCallbacks {
  onArtifactOpen?: (artifact: ParsedArtifact) => void;
  onActionStream?: (artifactId: string, action: Partial<ArtifactAction>) => void;
  onActionComplete?: (artifactId: string, action: ArtifactAction) => void;
  onArtifactClose?: (artifact: ParsedArtifact) => void;
}

// ─── Regex helpers ────────────────────────────────────────────────────────────

// <danteArtifact id="..." title="..." type="...">
const ARTIFACT_OPEN_RE =
  /<danteArtifact\s+([^>]*)>/gi;
// </danteArtifact>
const ARTIFACT_CLOSE_RE = /<\/danteArtifact>/gi;
// <danteAction type="..." [filePath="..."]>
const ACTION_OPEN_RE = /<danteAction\s+([^>]*)>/gi;
// </danteAction>
const ACTION_CLOSE_RE = /<\/danteAction>/gi;

/**
 * Parse an XML attribute string like `type="file" filePath="src/index.ts"`.
 * Returns a Record of attribute → value.
 */
function parseAttrs(attrString: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match name="value" or name='value'
  const attrRe = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrString)) !== null) {
    const key = m[1];
    if (key) {
      result[key] = m[2] ?? m[3] ?? "";
    }
  }
  return result;
}

function sanitizeActionType(raw: string): ArtifactActionType {
  if (raw === "file" || raw === "shell" || raw === "build" || raw === "start") {
    return raw;
  }
  return "shell";
}

function sanitizeArtifactType(raw: string): "coding" | "explanation" {
  return raw === "explanation" ? "explanation" : "coding";
}

// ─── One-shot parser ──────────────────────────────────────────────────────────

/**
 * Parse a complete response text for <danteArtifact> tags.
 * Returns all artifacts found.
 */
export function parseArtifacts(responseText: string): ParsedArtifact[] {
  const parser = new XmlArtifactParser();
  return parser.parse(responseText);
}

// ─── XmlArtifactParser class ─────────────────────────────────────────────────

export class XmlArtifactParser {
  private callbacks: ArtifactParseCallbacks | undefined;

  // Streaming state
  private buffer: string = "";
  private artifacts: Map<string, ParsedArtifact> = new Map();
  private currentArtifactId: string | null = null;
  private currentActionBuffer: string = "";
  private currentActionAttrs: Record<string, string> | null = null;
  private inAction: boolean = false;

  constructor(callbacks?: ArtifactParseCallbacks) {
    this.callbacks = callbacks;
  }

  // ── One-shot parse ──────────────────────────────────────────────────────────

  /**
   * Parse a complete response text for artifact tags.
   * Returns all artifacts found.
   */
  parse(responseText: string): ParsedArtifact[] {
    const results: ParsedArtifact[] = [];

    // Split text around <danteArtifact ...> ... </danteArtifact>
    // We use a simple iterative approach to avoid complex regex.
    let remaining = responseText;

    while (remaining.length > 0) {
      const artifactOpenIdx = remaining.indexOf("<danteArtifact");
      if (artifactOpenIdx === -1) break;

      // Find the end of the opening tag
      const openTagEnd = remaining.indexOf(">", artifactOpenIdx);
      if (openTagEnd === -1) break;

      const openTag = remaining.slice(artifactOpenIdx + "<danteArtifact".length, openTagEnd);
      const artifactAttrs = parseAttrs(openTag);

      const closeTag = "</danteArtifact>";
      const closeIdx = remaining.indexOf(closeTag, openTagEnd);
      if (closeIdx === -1) break;

      const inner = remaining.slice(openTagEnd + 1, closeIdx);
      const artifact: ParsedArtifact = {
        id: artifactAttrs["id"] ?? randomUUID().slice(0, 8),
        title: artifactAttrs["title"] ?? "Untitled",
        type: sanitizeArtifactType(artifactAttrs["type"] ?? "coding"),
        actions: [],
      };

      // Parse actions within the artifact
      artifact.actions = this._parseActions(inner, artifact.id);
      results.push(artifact);

      remaining = remaining.slice(closeIdx + closeTag.length);
    }

    return results;
  }

  // ── Action parsing ──────────────────────────────────────────────────────────

  private _parseActions(text: string, artifactId: string): ArtifactAction[] {
    const actions: ArtifactAction[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      const actionOpenIdx = remaining.indexOf("<danteAction");
      if (actionOpenIdx === -1) break;

      const openTagEnd = remaining.indexOf(">", actionOpenIdx);
      if (openTagEnd === -1) break;

      const openTag = remaining.slice(actionOpenIdx + "<danteAction".length, openTagEnd);
      const actionAttrs = parseAttrs(openTag);

      const closeTag = "</danteAction>";
      const closeIdx = remaining.indexOf(closeTag, openTagEnd);
      if (closeIdx === -1) break;

      const content = remaining.slice(openTagEnd + 1, closeIdx).trim();
      const actionType = sanitizeActionType(actionAttrs["type"] ?? "shell");

      const action: ArtifactAction = {
        id: randomUUID().slice(0, 8),
        type: actionType,
        content,
        status: "pending",
      };

      if (actionType === "file" && actionAttrs["filePath"]) {
        action.filePath = actionAttrs["filePath"];
      } else if (actionType !== "file") {
        action.command = content;
      }

      actions.push(action);
      this.callbacks?.onActionComplete?.(artifactId, action);

      remaining = remaining.slice(closeIdx + closeTag.length);
    }

    return actions;
  }

  // ── Streaming parse ─────────────────────────────────────────────────────────

  /**
   * Stream-aware parsing — call with each new chunk.
   * Fires callbacks as artifacts/actions are detected.
   * Accumulates partial tags in an internal buffer.
   */
  parseChunk(chunk: string): void {
    this.buffer += chunk;

    // Process as much of the buffer as we can without blocking on incomplete tags.
    let safeEnd = this._findSafeEnd(this.buffer);

    while (safeEnd > 0) {
      const slice = this.buffer.slice(0, safeEnd);
      this.buffer = this.buffer.slice(safeEnd);
      this._processSlice(slice);
      safeEnd = this._findSafeEnd(this.buffer);
    }
  }

  /**
   * Find the safe end index — the last position that doesn't contain a partial tag.
   * A partial tag is an open `<` with no matching `>`.
   */
  private _findSafeEnd(text: string): number {
    const lastOpen = text.lastIndexOf("<");
    if (lastOpen === -1) return text.length;

    // If there's a matching `>` after the last `<`, the tag is complete.
    const lastClose = text.lastIndexOf(">");
    if (lastClose > lastOpen) return text.length;

    // There's a partial open tag — stop before it.
    return lastOpen;
  }

  private _processSlice(slice: string): void {
    if (!this.currentArtifactId) {
      // Look for artifact open tag
      const match = ARTIFACT_OPEN_RE.exec(slice);
      ARTIFACT_OPEN_RE.lastIndex = 0;

      if (match) {
        const attrs = parseAttrs(match[1] ?? "");
        const artifact: ParsedArtifact = {
          id: attrs["id"] ?? randomUUID().slice(0, 8),
          title: attrs["title"] ?? "Untitled",
          type: sanitizeArtifactType(attrs["type"] ?? "coding"),
          actions: [],
        };
        this.artifacts.set(artifact.id, artifact);
        this.currentArtifactId = artifact.id;
        this.callbacks?.onArtifactOpen?.(artifact);
      }
    } else {
      // We're inside an artifact — currentArtifactId is non-null in this branch.
      const artifactId = this.currentArtifactId as string;

      // Look for action tags or artifact close
      if (ARTIFACT_CLOSE_RE.test(slice)) {
        ARTIFACT_CLOSE_RE.lastIndex = 0;
        const artifact = this.artifacts.get(artifactId);
        if (artifact) {
          this.callbacks?.onArtifactClose?.(artifact);
        }
        this.currentArtifactId = null;
        this.inAction = false;
        this.currentActionBuffer = "";
        this.currentActionAttrs = null;
        return;
      }
      ARTIFACT_CLOSE_RE.lastIndex = 0;

      if (!this.inAction) {
        const match = ACTION_OPEN_RE.exec(slice);
        ACTION_OPEN_RE.lastIndex = 0;

        if (match) {
          this.currentActionAttrs = parseAttrs(match[1] ?? "");
          this.inAction = true;
          this.currentActionBuffer = "";

          // Stream partial action open event
          const partialAction: Partial<ArtifactAction> = {
            type: sanitizeActionType(this.currentActionAttrs["type"] ?? "shell"),
            filePath: this.currentActionAttrs["filePath"],
            status: "running",
          };
          this.callbacks?.onActionStream?.(artifactId, partialAction);
        }
      } else {
        // Inside an action — accumulate content
        if (ACTION_CLOSE_RE.test(slice)) {
          ACTION_CLOSE_RE.lastIndex = 0;
          const closeIdx = slice.indexOf("</danteAction>");
          this.currentActionBuffer += slice.slice(0, closeIdx);

          const attrs = this.currentActionAttrs ?? {};
          const actionType = sanitizeActionType(attrs["type"] ?? "shell");
          const content = this.currentActionBuffer.trim();

          const action: ArtifactAction = {
            id: randomUUID().slice(0, 8),
            type: actionType,
            content,
            status: "complete",
          };

          if (actionType === "file" && attrs["filePath"]) {
            action.filePath = attrs["filePath"];
          } else if (actionType !== "file") {
            action.command = content;
          }

          const artifact = this.artifacts.get(artifactId);
          if (artifact) {
            artifact.actions.push(action);
          }

          this.callbacks?.onActionComplete?.(artifactId, action);
          this.inAction = false;
          this.currentActionBuffer = "";
          this.currentActionAttrs = null;
        } else {
          ACTION_CLOSE_RE.lastIndex = 0;
          // Accumulate content and stream
          this.currentActionBuffer += slice;
          this.callbacks?.onActionStream?.(artifactId, {
            content: this.currentActionBuffer,
            status: "running",
          });
        }
      }
    }
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  /**
   * Reset parser state for a new response.
   */
  reset(): void {
    this.buffer = "";
    this.artifacts = new Map();
    this.currentArtifactId = null;
    this.currentActionBuffer = "";
    this.currentActionAttrs = null;
    this.inAction = false;
  }

  // ── Tool call conversion ────────────────────────────────────────────────────

  /**
   * Convert artifacts to tool calls that DanteCode can execute.
   * file actions → Write tool calls
   * shell/build/start actions → Bash tool calls
   */
  static toToolCalls(
    artifacts: ParsedArtifact[],
  ): Array<{ name: "Write" | "Bash"; input: Record<string, unknown> }> {
    const toolCalls: Array<{ name: "Write" | "Bash"; input: Record<string, unknown> }> = [];

    for (const artifact of artifacts) {
      for (const action of artifact.actions) {
        if (action.type === "file" && action.filePath) {
          toolCalls.push({
            name: "Write",
            input: {
              file_path: action.filePath,
              content: action.content,
            },
          });
        } else if (
          action.type === "shell" ||
          action.type === "build" ||
          action.type === "start"
        ) {
          toolCalls.push({
            name: "Bash",
            input: {
              command: action.content,
              description: `${action.type}: ${action.content.slice(0, 60)}`,
            },
          });
        }
      }
    }

    return toolCalls;
  }
}
