// ============================================================================
// packages/core/src/config-doc-generator.ts
//
// Dim 43 — Documentation quality
// Auto-generates config reference docs from DantecodeConfig shape.
// ============================================================================

import { DEFAULT_DANTECODE_CONFIG, type DantecodeConfig } from "./config-validator.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConfigFieldDoc {
  field: string;
  type: string;
  default: string;
  description: string;
  example: string;
  required: boolean;
}

// ── Static field definitions ──────────────────────────────────────────────────

const FIELD_DOCS: ConfigFieldDoc[] = [
  {
    field: "version",
    type: "string",
    default: '"1.0.0"',
    description: "Config schema version. Must be semver-formatted (e.g. 1.0.0).",
    example: '"1.0.0"',
    required: true,
  },
  {
    field: "provider.id",
    type: '"anthropic" | "openai" | "ollama" | "azure"',
    default: '"anthropic"',
    description: "AI provider to use for completions and chat.",
    example: '"anthropic"',
    required: true,
  },
  {
    field: "provider.model",
    type: "string",
    default: '"claude-sonnet-4-6"',
    description: "Model identifier for the selected provider.",
    example: '"claude-sonnet-4-6"',
    required: true,
  },
  {
    field: "provider.apiKey",
    type: "string",
    default: '""',
    description: "API key for the selected provider. Not required for ollama.",
    example: '"sk-ant-api03-..."',
    required: false,
  },
  {
    field: "provider.baseUrl",
    type: "string",
    default: "(none)",
    description: "Custom base URL for API requests. Useful for Azure or self-hosted endpoints.",
    example: '"https://my-endpoint.openai.azure.com"',
    required: false,
  },
  {
    field: "features.fim",
    type: "boolean",
    default: "true",
    description: "Enable fill-in-the-middle (FIM) completions for inline code suggestions.",
    example: "true",
    required: false,
  },
  {
    field: "features.browserPreview",
    type: "boolean",
    default: "false",
    description: "Enable the browser live-preview panel when a dev server is running.",
    example: "false",
    required: false,
  },
  {
    field: "features.autonomy",
    type: "boolean",
    default: "false",
    description: "Enable autonomous task completion mode (agent loop without step-by-step approval).",
    example: "false",
    required: false,
  },
  {
    field: "ui.theme",
    type: '"auto" | "light" | "dark"',
    default: '"auto"',
    description: "Color theme for the VSCode panel and CLI output.",
    example: '"dark"',
    required: false,
  },
  {
    field: "ui.statusBar",
    type: "boolean",
    default: "true",
    description: "Show DanteCode status in the VSCode status bar.",
    example: "true",
    required: false,
  },
];

// ── generateConfigReference ───────────────────────────────────────────────────

export function generateConfigReference(
  _config?: DantecodeConfig,
): ConfigFieldDoc[] {
  // Returns the canonical field docs. The config param is accepted for
  // future use (e.g. annotating which fields differ from defaults).
  return FIELD_DOCS.slice();
}

// ── renderConfigReferenceMarkdown ─────────────────────────────────────────────

export function renderConfigReferenceMarkdown(fields: ConfigFieldDoc[]): string {
  const lines: string[] = [
    "# Configuration Reference",
    "",
    "All settings live in `.dantecode/config.json` in your project root.",
    "Use `dantecode config set <key> <value>` to change values, or edit the file directly.",
    "",
    "## Fields",
    "",
    "| Field | Type | Default | Required | Description |",
    "| ----- | ---- | ------- | -------- | ----------- |",
  ];

  for (const f of fields) {
    const req = f.required ? "✓" : "";
    const type = f.type.length > 30 ? f.type.slice(0, 28) + "…" : f.type;
    lines.push(`| \`${f.field}\` | \`${type}\` | \`${f.default}\` | ${req} | ${f.description} |`);
  }

  lines.push(
    "",
    "## Example config.json",
    "",
    "```json",
    JSON.stringify(DEFAULT_DANTECODE_CONFIG, null, 2),
    "```",
    "",
    "## CLI reference",
    "",
    "```bash",
    "# View current config",
    "dantecode config list",
    "",
    "# Set a value",
    "dantecode config set provider.model claude-opus-4-7",
    "dantecode config set features.fim true",
    "",
    "# Validate config",
    "dantecode config validate",
    "",
    "# Reset to defaults",
    "dantecode config reset",
    "```",
  );

  return lines.join("\n");
}
