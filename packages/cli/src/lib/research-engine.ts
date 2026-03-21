/**
 * research-engine.ts
 *
 * Shared research logic used by both the /research slash command and the
 * Research tool available to the model.
 *
 * Depth tiers:
 *   quick    — DDG only, no synthesis, 2 fetched pages. Fast.
 *   standard — Parallel: ResearchPipeline (full WebExtractor) + MultiEngineSearch synthesis. 5 pages.
 *   deep     — Same parallel approach, 8 pages fetched.
 *
 * maxSources overrides the depth-derived page count when provided.
 */
import { ResearchPipeline } from "@dantecode/web-research";
import type { ResearchResult } from "@dantecode/web-research";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { MultiEngineSearch, createSearchEngine } from "../web-search-engine.js";
import { WebExtractor } from "@dantecode/web-extractor";

export interface ResearchOptions {
  maxSources?: number;
  depth?: "quick" | "standard" | "deep";
}

type SynthesisResult = {
  results: Array<{ url: string; title?: string; snippet?: string }>;
  synthesized: string;
  confidence: number;
  providersUsed: string[];
  totalCost: number;
};

// ---------------------------------------------------------------------------
// Module-level singleton — preserves session cost tracking + orchestrator state
// ---------------------------------------------------------------------------

let _researchEngine: MultiEngineSearch | null = null;
function getResearchEngine(): MultiEngineSearch {
  if (!_researchEngine) _researchEngine = createSearchEngine();
  return _researchEngine;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadAuthorityOverrides(projectRoot: string): Record<string, number> | undefined {
  try {
    const stateYaml = readFileSync(join(projectRoot, ".dantecode", "STATE.yaml"), "utf-8");
    const state = parseYaml(stateYaml) as Record<string, unknown>;
    const research = state["research"] as Record<string, unknown> | undefined;
    const overrides = research?.["authorityOverrides"];
    if (overrides && typeof overrides === "object" && !Array.isArray(overrides)) {
      return overrides as Record<string, number>;
    }
  } catch {
    // STATE.yaml not found or missing research.authorityOverrides — use defaults
  }
  return undefined;
}

function formatEvidenceOutput(topic: string, result: ResearchResult): string {
  const bundle = result.evidenceBundle;
  const lines: string[] = [
    `## Research: ${topic}`,
    "",
    bundle.content,
    "",
    `### Sources (${bundle.citations.length} fetched from ${result.resultCount} results)`,
  ];

  bundle.citations.forEach((s, i) => {
    const title = s.title ?? s.url;
    const snippet = s.snippet ? ` — ${s.snippet.slice(0, 80)}...` : "";
    lines.push(`${i + 1}. [${title}](${s.url})${snippet}`);
  });

  if (result.cacheHit) {
    lines.push("", `_Results from cache_`);
  }

  const warnings = result.verificationWarnings ?? [];
  if (warnings.length) {
    lines.push("", "### Security Warnings");
    warnings.forEach(w => lines.push(`- ${w}`));
  }

  return lines.join("\n");
}

function buildRichOutput(
  topic: string,
  pipelineResult: PromiseSettledResult<ResearchResult>,
  synthesisResult: PromiseSettledResult<SynthesisResult>,
): string {
  const lines: string[] = [`## Research: ${topic}`, ""];

  // Synthesis section (shown first for quick scanning)
  if (synthesisResult.status === "fulfilled") {
    const { synthesized, confidence, providersUsed } = synthesisResult.value;
    const confPct = Math.round(confidence * 100);
    lines.push(
      `### Summary`,
      "",
      synthesized,
      "",
      `_Confidence: ${confPct}% · Providers: ${providersUsed.join(", ")}_`,
      "",
    );
  }

  if (pipelineResult.status === "fulfilled") {
    const result = pipelineResult.value;
    const bundle = result.evidenceBundle;

    // Show raw evidence content only when synthesis failed (avoid duplication)
    if (synthesisResult.status === "rejected" && bundle.content) {
      lines.push("### Evidence", "", bundle.content, "");
    }

    // --- Unified Sources: pipeline first (full metadata), then synthesis-only ---
    const pipelineUrls = new Set(bundle.citations.map(c => c.url));
    const synthOnly =
      synthesisResult.status === "fulfilled"
        ? synthesisResult.value.results.filter(r => !pipelineUrls.has(r.url))
        : [];
    const totalSources = bundle.citations.length + synthOnly.length;

    lines.push(`### Sources (${totalSources} sources from ${result.resultCount} results)`);

    // Pipeline citations (have full fetched metadata)
    bundle.citations.forEach((s, i) => {
      const title = s.title ?? s.url;
      const snippet = s.snippet ? ` — ${s.snippet.slice(0, 80)}...` : "";
      lines.push(`${i + 1}. [${title}](${s.url})${snippet}`);
    });

    // Synthesis-only citations (not already in pipeline, from other providers)
    synthOnly.forEach((r, i) => {
      const idx = bundle.citations.length + i + 1;
      const title = r.title ?? r.url;
      const snippet = r.snippet ? ` — ${r.snippet.slice(0, 80)}...` : "";
      lines.push(`${idx}. [${title}](${r.url})${snippet}`);
    });

    if (result.cacheHit) {
      lines.push("", `_Results from cache_`);
    }

    // Injection/content warnings
    const warnings = result.verificationWarnings ?? [];
    if (warnings.length) {
      lines.push("", "### Security Warnings");
      warnings.forEach(w => lines.push(`- ${w}`));
    }
  } else if (synthesisResult.status === "rejected") {
    // Both failed
    const reason = (pipelineResult as PromiseRejectedResult).reason;
    lines.push(`_Research failed: ${reason instanceof Error ? reason.message : String(reason)}_`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function executeResearch(
  topic: string,
  projectRoot: string,
  options: ResearchOptions = {},
): Promise<string> {
  const { depth = "standard", maxSources } = options;
  const authorityOverrides = loadAuthorityOverrides(projectRoot);

  if (depth === "quick") {
    // Fast path: DDG only, no web-extractor, no synthesis
    const fetchTopN = maxSources ?? 2;
    const pipeline = new ResearchPipeline({
      projectRoot,
      maxResults: fetchTopN * 5,
      fetchTopN,
      authorityOverrides,
    });
    const result = await pipeline.run(topic);
    return formatEvidenceOutput(topic, result);
  }

  // Standard/deep: parallel pipeline (with WebExtractor) + multi-engine synthesis
  // maxSources overrides the depth-derived default when explicitly provided
  const fetchTopN = maxSources ?? (depth === "deep" ? 8 : 5);

  const [pipelineResult, synthesisResult] = await Promise.allSettled([
    new ResearchPipeline({
      projectRoot,
      maxResults: fetchTopN * 3,
      fetchTopN,
      authorityOverrides,
      webExtractor: new WebExtractor({ projectRoot }),
    }).run(topic),
    getResearchEngine().searchWithCitations(topic, { maxResults: fetchTopN * 2 }),
  ]);

  return buildRichOutput(topic, pipelineResult, synthesisResult as PromiseSettledResult<SynthesisResult>);
}
