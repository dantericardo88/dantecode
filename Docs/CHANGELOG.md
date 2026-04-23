# Changelog

All notable changes to DanteCode are documented here.

## [Unreleased]

### Added

- **Documentation quality checker** (`checkDocsQuality`, `generateDocsReport`) — static analysis of required docs, word count thresholds, and JSDoc coverage with a 0–100 score and JSONL persistence.
- **Config reference auto-generator** (`generateConfigReference`, `renderConfigReferenceMarkdown`) — generates structured field docs and a markdown table from the DantecodeConfig schema.
- **Diataxis-structured docs** — eight new reference documents covering getting started, tutorials, how-to guides, reference, and architecture explanation.

## [Sprint Dim40] — Configuration ergonomics

### Added

- **Typed config schema** (`DantecodeConfig`) with `version`, `provider`, `features`, and `ui` sections.
- **`validateDantecodeConfig()`** — validates raw JSON against the schema with field-level errors and actionable fix strings (`Run: dantecode config set ...`).
- **`applyConfigDefaults()`** — merges partial user config with sensible defaults.
- **`migrateConfig()`** — migrates 0.x flat config format (`apiProvider`, `apiModelId`, `apiKey`) to 1.0.0 nested structure.
- **`cmdConfig()` CLI surface** — `get`, `set`, `list`, `validate`, `reset` subcommands for managing `.dantecode/config.json`.
- API key masking in `dantecode config list` output.
- Config validation on `dantecode config validate` with fix hints per error.

## [Sprint Dim38] — Latency and responsiveness

### Added

- **`LatencyTracker`** — rolling 200-sample p50/p95/p99 tracker per category (`api-ttfb`, `tool-exec`, `dev-server`, `fim`, `stream-chunk`). `globalLatencyTracker` singleton wired into tool execution.
- **`StreamThinkingIndicator`** — arms a threshold timer on first stream wait; surfaces a "thinking..." signal when TTFB exceeds 800ms, dismissed on first token.
- **Dev server retry logic** — `startDevServer()` now retries up to `maxAttempts` times on failure. Default timeout reduced from 30s → 10s. Startup time is logged per attempt.
- Tool execution latency tracking: every `executeTool()` call records wall-clock time via `globalLatencyTracker.startTimer("tool-exec", name)`.
- Latency snapshot JSONL persistence: `recordLatencySnapshot()` → `.danteforge/latency-log.jsonl`.

## [Sprint Dim9 refine] — Screenshot-to-code iteration

### Added

- **`refineCodeFromScreenshot()`** — takes existing generated code and a new screenshot and produces an improved version. Uses "HISTORY:" block to pass prior code as grounding context.
- **`decomposeIntoComponents()`** — extracts named sub-components from generated HTML/React code (`NavBar`, `Footer`, `Card` for React; `Section`, `Article` for HTML).
- **`scoreVisualFidelity()`** — computes a weighted fidelity score (layout 40%, color 30%, component coverage 30%) from a structured LLM assessment.
- `iterationCount` and `fidelityScore` fields on `ScreenshotCodeOutcome` for trend tracking.

## [Sprint Dim48] — Accessibility

### Added

- **Accessibility auditor** (`auditAccessibility()`) — WCAG 2.1 Level AA checks: missing alt text, form label associations, ARIA usage, color contrast heuristics, keyboard navigation.
- **VSCode accessibility lens provider** — inline diagnostic markers for accessibility violations with CodeLens quick-fix hints.
- Accessibility audit JSONL persistence → `.danteforge/a11y-log.jsonl`.

## [Sprint Dim35] — Onboarding and time-to-value

### Added

- **`recordOnboardingStep()` / `getOnboardingStats()`** — funnel tracking from `init-started` through `onboarding-complete`. Computes completion rate and drop-off step.
- **`checkRepoReadiness()`** in `dantecode init` — checks for `package.json`, dev script, `.git` presence, and existing `.danteforge/` directory. Prints readiness summary before creating config.
- Onboarding step recording wired into `init` and `onboarding-provider` VSCode flow.

## [Sprint Dim28] — Enterprise foundation

### Added

- SSO/OIDC/SAML integration scaffolding with provider-agnostic token validation.
- RBAC engine (`evaluatePolicy()`) with role hierarchy and resource-action matching.
- Audit log with structured entries and JSONL persistence.
- Admin policy enforcement gate.

## [Sprint Dim18] — PR review sharpness

### Added

- Diff risk clustering — groups PR changes into risk buckets (critical/high/medium/low) based on file type, change volume, and semantic signals.
- Severity-ranked review comments with confidence scores.
- False-positive suppression — suppresses style-only warnings when substantive issues are present.
- Review-defect correlation: tracks whether flagged issues led to actual bugs (outcome tracking).

## [Sprint Dim20] — Debug context

### Added

- Debug context assembler — combines stack traces, recent tool outputs, and error history into a structured debug snapshot.
- Outcome delta tracking — measures repair success rate per error type over time.
- Debug snapshot injection into agent system prompt when an error pattern is detected.

## [Sprint Dim1] — FIM latency

### Added

- FIM latency histogram with 20-bucket distribution.
- Stale completion suppressor — cancels in-flight FIM requests when cursor moves.
- Cancellation rate metric.
- P50 latency reporting in `dantecode bench --fim`.

---

*This changelog covers production code changes. Internal sprint metadata and benchmark results are in `.danteforge/`.*
