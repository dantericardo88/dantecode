// ============================================================================
// packages/core/src/config-validator.ts
//
// Dim 40 — Configuration ergonomics
// Typed config schema, validation with actionable errors, defaults, migration.
//
// Patterns from:
// - cline (Apache-2.0): enum provider list, shared config types, actionable errors
// - continue (Apache-2.0): versioned schema (schema: "v1"), defaultConfig pattern,
//   config.json with validation error messages surfaced to user
// - vscode extension samples: contributes.configuration with enum + descriptions
// ============================================================================

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DantecodeConfig {
  version: string;
  provider: {
    id: "anthropic" | "openai" | "ollama" | "azure";
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };
  features?: {
    fim?: boolean;
    browserPreview?: boolean;
    autonomy?: boolean;
  };
  ui?: {
    theme?: "auto" | "light" | "dark";
    statusBar?: boolean;
  };
}

export interface ConfigValidationError {
  field: string;
  message: string;
  fix: string;
}

export interface ConfigValidationWarning {
  field: string;
  message: string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: DantecodeConfig = {
  version: "1.0.0",
  provider: {
    id: "anthropic",
    model: "claude-sonnet-4-6",
    apiKey: "",
  },
  features: {
    fim: true,
    browserPreview: false,
    autonomy: false,
  },
  ui: {
    theme: "auto",
    statusBar: true,
  },
};

const VALID_PROVIDER_IDS = new Set<string>(["anthropic", "openai", "ollama", "azure"]);
const VALID_THEMES = new Set<string>(["auto", "light", "dark"]);
const SEMVER_RE = /^\d+\.\d+\.\d+/;
const URL_RE = /^https?:\/\/.+/i;

// ── validateDantecodeConfig ───────────────────────────────────────────────────

export function validateDantecodeConfig(raw: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const warnings: ConfigValidationWarning[] = [];

  if (!raw || typeof raw !== "object") {
    return {
      valid: false,
      errors: [{ field: "root", message: "Config must be a JSON object", fix: "Run: dantecode config reset" }],
      warnings: [],
    };
  }

  const cfg = raw as Record<string, unknown>;

  // version
  if (!cfg["version"] || typeof cfg["version"] !== "string") {
    errors.push({ field: "version", message: "Missing required field: version", fix: "Run: dantecode config set version 1.0.0" });
  } else if (!SEMVER_RE.test(cfg["version"] as string)) {
    errors.push({ field: "version", message: `Invalid version format: "${cfg["version"]}"`, fix: "Run: dantecode config set version 1.0.0" });
  }

  // provider
  const provider = cfg["provider"] as Record<string, unknown> | undefined;
  if (!provider || typeof provider !== "object") {
    errors.push({ field: "provider", message: "Missing required section: provider", fix: "Run: dantecode config reset" });
  } else {
    // provider.id
    if (!provider["id"] || !VALID_PROVIDER_IDS.has(provider["id"] as string)) {
      errors.push({
        field: "provider.id",
        message: `Invalid provider id: "${provider["id"]}". Must be one of: anthropic, openai, ollama, azure`,
        fix: "Run: dantecode config set provider.id anthropic",
      });
    }

    // provider.model
    if (!provider["model"] || typeof provider["model"] !== "string" || !(provider["model"] as string).trim()) {
      errors.push({
        field: "provider.model",
        message: "provider.model must be a non-empty string",
        fix: "Run: dantecode config set provider.model claude-sonnet-4-6",
      });
    }

    // apiKey required for non-ollama providers
    const providerId = provider["id"] as string;
    const apiKey = provider["apiKey"] as string | undefined;
    if (providerId !== "ollama" && (!apiKey || !apiKey.trim())) {
      errors.push({
        field: "provider.apiKey",
        message: `API key is required for provider "${providerId}"`,
        fix: "Run: dantecode config set provider.apiKey <your-api-key>",
      });
    }

    // baseUrl optional but must be valid URL if provided
    const baseUrl = provider["baseUrl"] as string | undefined;
    if (baseUrl && typeof baseUrl === "string" && baseUrl.trim() && !URL_RE.test(baseUrl)) {
      errors.push({
        field: "provider.baseUrl",
        message: `Invalid baseUrl: "${baseUrl}". Must start with http:// or https://`,
        fix: "Run: dantecode config set provider.baseUrl https://your-endpoint.com",
      });
    }
  }

  // ui.theme optional validation
  const ui = cfg["ui"] as Record<string, unknown> | undefined;
  if (ui && ui["theme"] && !VALID_THEMES.has(ui["theme"] as string)) {
    warnings.push({
      field: "ui.theme",
      message: `Unknown theme "${ui["theme"]}". Expected: auto, light, dark. Falling back to "auto".`,
    });
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── applyConfigDefaults ───────────────────────────────────────────────────────

export function applyConfigDefaults(partial: Partial<DantecodeConfig>): DantecodeConfig {
  const provider = (partial.provider ?? {}) as Partial<DantecodeConfig["provider"]>;
  const features = (partial.features ?? {}) as Partial<NonNullable<DantecodeConfig["features"]>>;
  const ui = (partial.ui ?? {}) as Partial<NonNullable<DantecodeConfig["ui"]>>;

  return {
    version: partial.version ?? DEFAULTS.version,
    provider: {
      id: (provider.id && VALID_PROVIDER_IDS.has(provider.id)) ? provider.id : DEFAULTS.provider.id,
      model: (provider.model && provider.model.trim()) ? provider.model : DEFAULTS.provider.model,
      ...(provider.apiKey !== undefined ? { apiKey: provider.apiKey } : { apiKey: DEFAULTS.provider.apiKey }),
      ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
    },
    features: {
      fim: features.fim ?? DEFAULTS.features!.fim,
      browserPreview: features.browserPreview ?? DEFAULTS.features!.browserPreview,
      autonomy: features.autonomy ?? DEFAULTS.features!.autonomy,
    },
    ui: {
      theme: (ui.theme && VALID_THEMES.has(ui.theme)) ? ui.theme : DEFAULTS.ui!.theme,
      statusBar: ui.statusBar ?? DEFAULTS.ui!.statusBar,
    },
  };
}

// ── migrateConfig ─────────────────────────────────────────────────────────────
// Handles 0.x → 1.0.0 field renames and structure normalization.

export function migrateConfig(raw: Record<string, unknown>, fromVersion: string): DantecodeConfig {
  const migrated: Partial<DantecodeConfig> = {};

  if (fromVersion.startsWith("0.")) {
    // 0.x had flat provider fields: apiProvider, apiModelId, apiKey, ollamaBaseUrl
    const provider: Partial<DantecodeConfig["provider"]> = {};

    const legacyProviderId = raw["apiProvider"] as string | undefined;
    if (legacyProviderId && VALID_PROVIDER_IDS.has(legacyProviderId)) {
      provider.id = legacyProviderId as DantecodeConfig["provider"]["id"];
    }

    const legacyModel = (raw["apiModelId"] ?? raw["model"]) as string | undefined;
    if (legacyModel) provider.model = legacyModel;

    const legacyKey = (raw["apiKey"] ?? raw["anthropicApiKey"] ?? raw["openAiApiKey"]) as string | undefined;
    if (legacyKey) provider.apiKey = legacyKey;

    const legacyBase = (raw["ollamaBaseUrl"] ?? raw["openAiBaseUrl"]) as string | undefined;
    if (legacyBase) provider.baseUrl = legacyBase;

    migrated.provider = provider as DantecodeConfig["provider"];
  } else {
    // Already at 1.x — just carry forward what's there
    if (raw["provider"]) migrated.provider = raw["provider"] as DantecodeConfig["provider"];
    if (raw["features"]) migrated.features = raw["features"] as DantecodeConfig["features"];
    if (raw["ui"]) migrated.ui = raw["ui"] as DantecodeConfig["ui"];
  }

  return applyConfigDefaults({ ...migrated, version: "1.0.0" });
}

// ── Re-export defaults for consumers ─────────────────────────────────────────

export const DEFAULT_DANTECODE_CONFIG: DantecodeConfig = { ...DEFAULTS };
