/**
 * rich-renderer.ts — @dantecode/ux-polish
 *
 * Core rich rendering engine. Converts structured RenderPayload objects
 * to themed, formatted strings for terminal or VS Code output.
 * Supports compact/normal/verbose density modes and all semantic kinds.
 */

import type {
  UXSurface,
  RenderPayload,
  RenderOptions,
  RichRenderResult,
  RenderDensity,
} from "./types.js";
import { ThemeEngine } from "./theme-engine.js";
import { COLUMN_WIDTH, indent, padOrTruncate, hRule } from "./tokens/spacing-tokens.js";

// ---------------------------------------------------------------------------
// RichRenderer
// ---------------------------------------------------------------------------

export interface RichRendererOptions {
  theme?: ThemeEngine;
  defaultDensity?: RenderDensity;
}

export class RichRenderer {
  private readonly engine: ThemeEngine;
  private readonly defaultDensity: RenderDensity;

  constructor(options: RichRendererOptions = {}) {
    this.engine = options.theme ?? new ThemeEngine();
    this.defaultDensity = options.defaultDensity ?? "normal";
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Main render entry point. */
  render(
    surface: UXSurface,
    payload: RenderPayload,
    options: RenderOptions = {},
  ): RichRenderResult {
    // Apply one-off option overrides
    if (typeof options.colors === "boolean") {
      this.engine.setColors(options.colors);
    }
    const density = options.density ?? this.defaultDensity;

    let output: string;
    try {
      output = this._dispatch(surface, payload, density);
    } catch {
      return {
        surface,
        rendered: false,
        theme: this.engine.name,
        output: "",
      };
    }

    return {
      surface,
      rendered: true,
      theme: this.engine.name,
      output,
    };
  }

  // -------------------------------------------------------------------------
  // Kind dispatchers
  // -------------------------------------------------------------------------

  private _dispatch(surface: UXSurface, payload: RenderPayload, density: RenderDensity): string {
    switch (payload.kind) {
      case "text":
        return this._text(payload.content, density);
      case "markdown":
        return this._markdown(payload.content, density);
      case "table":
        return this._table(payload);
      case "diff":
        return this._diff(payload);
      case "status":
        return this._status(payload.content, density);
      case "progress":
        return this._progressLine(payload.content, density);
      case "error":
        return this._errorBlock(payload.content, density);
      case "success":
        return this._successLine(payload.content);
      case "warning":
        return this._warningLine(payload.content);
      case "info":
        return this._infoLine(payload.content, surface);
      default:
        return payload.content;
    }
  }

  // -------------------------------------------------------------------------
  // Individual kind renderers
  // -------------------------------------------------------------------------

  private _text(content: string, density: RenderDensity): string {
    if (density === "compact") return content.split("\n")[0] ?? content;
    return content;
  }

  private _markdown(content: string, density: RenderDensity): string {
    if (density === "compact") {
      // Strip markdown in compact mode — plain text only
      return (
        content
          .replace(/^#{1,3}\s+/gm, "")
          .replace(/\*\*(.+?)\*\*/g, "$1")
          .replace(/`([^`]+)`/g, "$1")
          .split("\n")[0] ?? content
      );
    }

    const BOLD = this.engine.bold;
    const DIM = this.engine.dim;
    const RESET = this.engine.reset;
    const CYAN = this.engine.info("");
    const YELLOW = this.engine.warning("");

    return content
      .split("\n")
      .map((line) => {
        if (/^# /.test(line)) return `${BOLD}${CYAN.replace(RESET, "")}${line.slice(2)}${RESET}`;
        if (/^## /.test(line)) return `${BOLD}${line.slice(3)}${RESET}`;
        if (/^### /.test(line)) return `${YELLOW.replace(RESET, "")}${line.slice(4)}${RESET}`;
        if (/^---+$/.test(line.trim())) return `${DIM}${hRule(COLUMN_WIDTH.terminal)}${RESET}`;
        if (/^- /.test(line)) line = `  • ${line.slice(2)}`;
        else if (/^\d+\. /.test(line)) line = `  ${line}`;
        line = line.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);
        line = line.replace(/`([^`]+)`/g, `${DIM}$1${RESET}`);
        return line;
      })
      .join("\n");
  }

  private _table(payload: RenderPayload): string {
    const data = payload.data;
    if (!data) return payload.content;

    const headers = (data["headers"] as string[]) ?? [];
    const rows = (data["rows"] as string[][]) ?? [];

    if (!headers.length) return payload.content;

    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length), 1),
    );

    const divider = "+-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-+";

    const renderRow = (cells: string[], isHeader = false): string => {
      const b = isHeader ? this.engine.bold : "";
      const r = isHeader ? this.engine.reset : "";
      return (
        "| " +
        cells
          .map((cell, i) => `${b}${padOrTruncate(cell ?? "", colWidths[i] ?? 1, "…")}${r}`)
          .join(" | ") +
        " |"
      );
    };

    const lines = [divider, renderRow(headers, true), divider];
    for (const row of rows) lines.push(renderRow(row));
    lines.push(divider);
    return lines.join("\n");
  }

  private _diff(payload: RenderPayload): string {
    const data = payload.data;
    const added = (data?.["added"] as string[]) ?? [];
    const removed = (data?.["removed"] as string[]) ?? [];
    const ctx = data?.["context"] as string | undefined;

    const GREEN = this.engine.success("");
    const RED = this.engine.error("");
    const DIM = this.engine.dim;
    const RESET = this.engine.reset;

    const lines: string[] = [];
    if (ctx) lines.push(`${DIM}--- ${ctx}${RESET}`);
    for (const line of removed) lines.push(`${RED}- ${line}${RESET}`);
    for (const line of added) lines.push(`${GREEN}+ ${line}${RESET}`);
    return lines.join("\n");
  }

  private _status(content: string, density: RenderDensity): string {
    const DIM = this.engine.dim;
    const RESET = this.engine.reset;
    const BOLD = this.engine.bold;
    if (density === "compact") return `${DIM}[status] ${content}${RESET}`;
    return `${BOLD}Status:${RESET} ${content}`;
  }

  private _progressLine(content: string, density: RenderDensity): string {
    if (density === "compact") return content;
    const icons = this.engine.icons();
    const color = this.engine.progressColor(icons.progress);
    return `${color} ${content}`;
  }

  private _errorBlock(content: string, density: RenderDensity): string {
    const icons = this.engine.icons();
    const RED = this.engine.error(icons.error);
    const RESET = this.engine.reset;
    const BOLD = this.engine.bold;
    if (density === "compact") return `${RED} ${content}${RESET}`;
    const pad = indent(2);
    return [`${BOLD}${RED} Error${RESET}`, `${pad}${content}`].join("\n");
  }

  private _successLine(content: string): string {
    const icons = this.engine.icons();
    return this.engine.success(`${icons.success} ${content}`);
  }

  private _warningLine(content: string): string {
    const icons = this.engine.icons();
    return this.engine.warning(`${icons.warning} ${content}`);
  }

  private _infoLine(content: string, surface: UXSurface): string {
    const icons = this.engine.icons();
    if (surface === "vscode") return content; // VS Code handles its own icons
    return this.engine.info(`${icons.info} ${content}`);
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience function (PRD public API)
// ---------------------------------------------------------------------------

const _renderer = new RichRenderer();

/**
 * Render a payload to a rich string for the given surface.
 * Uses the shared default renderer instance.
 */
export function renderRichOutput(
  surface: UXSurface,
  payload: RenderPayload,
  options?: RenderOptions,
): RichRenderResult {
  return _renderer.render(surface, payload, options);
}
