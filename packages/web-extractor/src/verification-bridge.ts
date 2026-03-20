import { randomUUID } from "node:crypto";
import type { RuntimeVerificationReport, VerificationGate } from "@dantecode/runtime-spine";
import type { WebFetchResult } from "./types.js";

/**
 * DanteForge Verification Bridge
 *
 * Runs structural + content PDSE gates on every WebFetch output:
 *   P — Provenance: at least one traceable source URL
 *   D — Depth: content is non-trivial (>200 chars)
 *   S — Specificity: title is present, no stub markers
 *   E — Evidence: structured data is valid JSON when present
 *
 * Returns a RuntimeVerificationReport compatible with @dantecode/runtime-spine.
 */
export class VerificationBridge {
  private static readonly STUB_MARKERS = [
    "TODO", "FIXME", "placeholder", "lorem ipsum",
    "coming soon", "under construction",
  ];

  async verify(result: WebFetchResult): Promise<RuntimeVerificationReport> {
    const taskId = randomUUID();
    const gates: VerificationGate[] = [];

    // Gate P — Provenance
    const hasSource = (result.sources?.length ?? 0) > 0 &&
      result.sources.some(s => s.url?.startsWith("http"));
    gates.push({
      name: "provenance",
      status: hasSource ? "pass" : "fail",
      score: hasSource ? 1 : 0,
      message: hasSource ? "Source URL present" : "No traceable source URL",
      findings: [],
    });

    // Gate D — Depth
    const contentLen = result.markdown?.length ?? 0;
    const depthScore = Math.min(contentLen / 1000, 1);
    gates.push({
      name: "depth",
      status: contentLen >= 200 ? "pass" : "warn",
      score: depthScore,
      message: `Content length: ${contentLen} chars`,
      findings: [],
    });

    // Gate S — Specificity (no stub markers, title present)
    const titleOk = Boolean(result.metadata?.title && result.metadata.title.length > 2);
    const lowerContent = (result.markdown ?? "").toLowerCase();
    const stubFound = VerificationBridge.STUB_MARKERS.find(
      m => lowerContent.includes(m.toLowerCase())
    );
    const specificityOk = titleOk && !stubFound;
    gates.push({
      name: "specificity",
      status: specificityOk ? "pass" : "warn",
      score: specificityOk ? 1 : 0.3,
      message: stubFound
        ? `Stub marker detected: "${stubFound}"`
        : titleOk ? "Title present, no stubs" : "Missing title",
      findings: stubFound ? [`Stub: ${stubFound}`] : [],
    });

    // Gate E — Evidence integrity
    let evidenceOk = true;
    let evidenceMsg = "No structured data to validate";
    if (result.structuredData !== undefined) {
      try {
        JSON.stringify(result.structuredData);
        evidenceOk = true;
        evidenceMsg = "Structured data is valid JSON";
      } catch {
        evidenceOk = false;
        evidenceMsg = "Structured data failed JSON serialization";
      }
    }
    gates.push({
      name: "evidence",
      status: evidenceOk ? "pass" : "fail",
      score: evidenceOk ? 1 : 0,
      message: evidenceMsg,
      findings: [],
    });

    const passed = gates.every(g => g.status !== "fail");
    const overallScore = gates.reduce((s, g) => s + (g.score ?? 0), 0) / gates.length;

    const pdseOverall = overallScore;
    const pdsePassGate = pdseOverall >= 0.6;

    const evidenceSources = result.sources.map(s => ({
      url: s.url,
      title: s.title,
      snippet: s.snippet,
    }));

    return {
      taskId,
      passed,
      overallScore,
      gates,
      evidenceCount: result.sources.length,
      sources: evidenceSources,
      pdse: {
        overall: pdseOverall,
        passedGate: pdsePassGate,
        metrics: {
          provenance: gates[0]?.score ?? 0,
          depth: gates[1]?.score ?? 0,
          specificity: gates[2]?.score ?? 0,
          evidence: gates[3]?.score ?? 0,
        },
      },
    };
  }
}
