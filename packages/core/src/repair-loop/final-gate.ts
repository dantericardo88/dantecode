/**
 * final-gate.ts
 *
 * DanteForge final gate verification after repair loops complete.
 * Runs PDSE scoring, anti-stub detection, and optional evidence chain sealing.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventEngine } from "../event-engine.js";
import { buildRuntimeEvent } from "@dantecode/runtime-spine";
import { randomUUID } from "node:crypto";

export interface FinalGateConfig {
  enabled: boolean;
  pdseThreshold: number; // default: 70
  requireAntiStub: boolean; // default: true
  requireEvidence: boolean; // default: false (Wave 2 Evidence Chain)
}

export interface FinalGateResult {
  passed: boolean;
  pdseScore?: number;
  pdseDetails?: {
    completeness: number;
    correctness: number;
    clarity: number;
    consistency: number;
  };
  antiStubViolations: string[];
  evidenceChain?: string; // Evidence bundle ID
  timestamp: string;
  failureReasons: string[];
}

export interface RunFinalGateOptions {
  mutatedFiles: string[];
  config: FinalGateConfig;
  projectRoot: string;
  eventEngine?: EventEngine;
  taskId?: string;
  /** For testing: injectable DanteForge module */
  danteForgeModule?: any;
  /** For testing: injectable evidence sealer */
  evidenceSealer?: any;
}

/**
 * Import DanteForge dynamically (fail-closed if unavailable)
 */
async function importDanteForge(injectedModule?: any): Promise<any> {
  if (injectedModule !== undefined) {
    return injectedModule;
  }

  try {
    const danteforge = await import("@dantecode/danteforge");
    return danteforge;
  } catch (error) {
    // DanteForge not available - fail-closed
    return null;
  }
}

/**
 * Import evidence-chain dynamically
 */
async function importEvidenceChain(injectedSealer?: any): Promise<any> {
  if (injectedSealer) {
    return { EvidenceSealer: injectedSealer };
  }

  try {
    const evidenceChain = await import("@dantecode/evidence-chain");
    return evidenceChain;
  } catch (error) {
    // Evidence chain not available - optional feature
    return null;
  }
}

/**
 * Run PDSE scoring on mutated files
 */
function runPDSEScoring(
  mutatedFiles: string[],
  projectRoot: string,
  danteforge: any,
): { score: number; details: any; violations: string[] } {
  const allViolations: string[] = [];
  const scores: Array<{
    completeness: number;
    correctness: number;
    clarity: number;
    consistency: number;
    overall: number;
  }> = [];

  for (const file of mutatedFiles) {
    try {
      const absolutePath = resolve(projectRoot, file);
      const content = readFileSync(absolutePath, "utf-8");
      const pdseResult = danteforge.runLocalPDSEScorer(content, projectRoot);

      scores.push({
        completeness: pdseResult.completeness,
        correctness: pdseResult.correctness,
        clarity: pdseResult.clarity,
        consistency: pdseResult.consistency,
        overall: pdseResult.overall,
      });

      // Collect violation messages
      if (pdseResult.violations && pdseResult.violations.length > 0) {
        pdseResult.violations.forEach((v: any) => {
          allViolations.push(`${file}:${v.line || "?"} - ${v.message}`);
        });
      }
    } catch (error: any) {
      // File may not exist or be readable - skip
      allViolations.push(`${file}: Failed to read or score - ${error.message}`);
    }
  }

  if (scores.length === 0) {
    return {
      score: 0,
      details: { completeness: 0, correctness: 0, clarity: 0, consistency: 0 },
      violations: allViolations,
    };
  }

  // Average scores across all files
  const avgCompleteness = scores.reduce((sum, s) => sum + s.completeness, 0) / scores.length;
  const avgCorrectness = scores.reduce((sum, s) => sum + s.correctness, 0) / scores.length;
  const avgClarity = scores.reduce((sum, s) => sum + s.clarity, 0) / scores.length;
  const avgConsistency = scores.reduce((sum, s) => sum + s.consistency, 0) / scores.length;
  const avgOverall = scores.reduce((sum, s) => sum + s.overall, 0) / scores.length;

  return {
    score: avgOverall,
    details: {
      completeness: avgCompleteness,
      correctness: avgCorrectness,
      clarity: avgClarity,
      consistency: avgConsistency,
    },
    violations: allViolations,
  };
}

/**
 * Run anti-stub detection on mutated files
 */
function runAntiStubDetection(
  mutatedFiles: string[],
  projectRoot: string,
  danteforge: any,
): string[] {
  const violations: string[] = [];

  for (const file of mutatedFiles) {
    try {
      const absolutePath = resolve(projectRoot, file);
      const content = readFileSync(absolutePath, "utf-8");
      const antiStubResult = danteforge.runAntiStubScanner(content, projectRoot, file);

      if (!antiStubResult.passed && antiStubResult.hardViolations) {
        antiStubResult.hardViolations.forEach((v: any) => {
          violations.push(`${file}:${v.line || "?"} - ${v.message}`);
        });
      }
    } catch (error: any) {
      // File may not exist or be readable - skip
      violations.push(`${file}: Failed to scan - ${error.message}`);
    }
  }

  return violations;
}

/**
 * Create evidence chain seal
 */
async function createEvidenceSeal(
  mutatedFiles: string[],
  pdseScore: number,
  evidenceChainModule: any,
  sessionId: string,
): Promise<string | undefined> {
  try {
    const { EvidenceSealer } = evidenceChainModule;
    const sealer = new EvidenceSealer();

    // Create evidence bundle with file mutations
    const evidence: Record<string, any> = {};
    mutatedFiles.forEach((file, index) => {
      evidence[`file_${index}`] = {
        path: file,
        timestamp: new Date().toISOString(),
      };
    });

    // Create configuration snapshot
    const config = {
      pdseScore,
      timestamp: new Date().toISOString(),
    };

    // Create metrics snapshot
    const metrics = {
      filesModified: mutatedFiles.length,
      pdseScore,
    };

    const seal = sealer.seal(sessionId, evidence, config, metrics);
    return seal.sealId;
  } catch (error) {
    // Evidence sealing is optional - don't fail the gate
    return undefined;
  }
}

/**
 * Run final gate verification after repair loops complete
 */
export async function runFinalGate(options: RunFinalGateOptions): Promise<FinalGateResult> {
  const {
    mutatedFiles,
    config,
    projectRoot,
    eventEngine,
    taskId,
    danteForgeModule,
    evidenceSealer,
  } = options;
  const timestamp = new Date().toISOString();
  const failureReasons: string[] = [];
  const gateTaskId = taskId || randomUUID();

  // Emit start event
  if (eventEngine) {
    eventEngine.emit(
      buildRuntimeEvent({
        kind: "repair.final_gate.started",
        taskId: gateTaskId,
        payload: {
          filesCount: mutatedFiles.length,
          threshold: config.pdseThreshold,
        },
      }),
    );
  }

  // Import DanteForge
  const danteforge = await importDanteForge(danteForgeModule);
  if (!danteforge) {
    // DanteForge not available - fail-closed
    const result: FinalGateResult = {
      passed: false,
      antiStubViolations: [],
      timestamp,
      failureReasons: ["DanteForge not available - cannot verify"],
    };

    if (eventEngine) {
      eventEngine.emit(
        buildRuntimeEvent({
          kind: "repair.final_gate.completed",
          taskId: gateTaskId,
          payload: {
            passed: false,
            reason: "danteforge_unavailable",
          },
        }),
      );
    }

    return result;
  }

  // Run PDSE scoring
  const pdseResult = runPDSEScoring(mutatedFiles, projectRoot, danteforge);
  let passed = true;

  // Check PDSE threshold
  if (pdseResult.score < config.pdseThreshold) {
    passed = false;
    failureReasons.push(
      `PDSE score ${pdseResult.score.toFixed(1)} below threshold ${config.pdseThreshold}`,
    );
  }

  // Run anti-stub detection
  let antiStubViolations: string[] = [];
  if (config.requireAntiStub) {
    antiStubViolations = runAntiStubDetection(mutatedFiles, projectRoot, danteforge);
    if (antiStubViolations.length > 0) {
      passed = false;
      failureReasons.push(`${antiStubViolations.length} anti-stub violation(s) detected`);
    }
  }

  // Optional evidence chain sealing
  let evidenceChainId: string | undefined;
  if (config.requireEvidence && passed) {
    const evidenceChainModule = await importEvidenceChain(evidenceSealer);
    if (evidenceChainModule) {
      evidenceChainId = await createEvidenceSeal(
        mutatedFiles,
        pdseResult.score,
        evidenceChainModule,
        gateTaskId,
      );
    }
  }

  // Emit completion event
  if (eventEngine) {
    eventEngine.emit(
      buildRuntimeEvent({
        kind: "repair.final_gate.completed",
        taskId: gateTaskId,
        payload: {
          passed,
          pdseScore: pdseResult.score,
          antiStubViolations: antiStubViolations.length,
          evidenceChainId,
        },
      }),
    );
  }

  return {
    passed,
    pdseScore: pdseResult.score,
    pdseDetails: pdseResult.details,
    antiStubViolations,
    evidenceChain: evidenceChainId,
    timestamp,
    failureReasons,
  };
}

/**
 * Format final gate result for display
 */
export function formatFinalGateResult(result: FinalGateResult): string {
  const lines: string[] = [];

  if (result.passed) {
    lines.push(`✓ Final gate PASSED`);
  } else {
    lines.push(`✗ Final gate FAILED`);
  }

  if (result.pdseScore !== undefined) {
    lines.push(`  PDSE Score: ${result.pdseScore.toFixed(1)}/100`);
    if (result.pdseDetails) {
      lines.push(
        `    Completeness: ${result.pdseDetails.completeness.toFixed(1)} | ` +
          `Correctness: ${result.pdseDetails.correctness.toFixed(1)} | ` +
          `Clarity: ${result.pdseDetails.clarity.toFixed(1)} | ` +
          `Consistency: ${result.pdseDetails.consistency.toFixed(1)}`,
      );
    }
  }

  if (result.antiStubViolations.length > 0) {
    lines.push(`  Anti-stub violations: ${result.antiStubViolations.length}`);
    result.antiStubViolations.slice(0, 3).forEach((v) => {
      lines.push(`    - ${v}`);
    });
    if (result.antiStubViolations.length > 3) {
      lines.push(`    ... and ${result.antiStubViolations.length - 3} more`);
    }
  }

  if (result.evidenceChain) {
    lines.push(`  Evidence chain: ${result.evidenceChain}`);
  }

  if (result.failureReasons.length > 0) {
    lines.push(`  Failure reasons:`);
    result.failureReasons.forEach((reason) => {
      lines.push(`    - ${reason}`);
    });
  }

  return lines.join("\n");
}
