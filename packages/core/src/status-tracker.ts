/**
 * Evidence-based status tracking for honest progress reporting.
 * Prevents claiming "Phase Complete" without proof.
 *
 * Pattern extracted from CrewAI task validation.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Evidence {
  filesCreated: string[];
  filesVerified: string[]; // Actually exist on disk
  buildPassed: boolean;
  testsPassed: boolean;
  timestamp: number;
}

export interface PhaseStatus {
  name: string;
  status: 'pending' | 'active' | 'complete' | 'failed';
  evidence?: Evidence;
  verifiedAt?: number;
  error?: string;
}

export class StatusTracker {
  public phases = new Map<string, PhaseStatus>();
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || process.cwd();
  }

  /**
   * Mark a phase as complete with evidence
   * Throws if evidence is insufficient
   */
  markPhaseComplete(phaseName: string, evidence: Evidence): void {
    if (!this.verifyEvidence(evidence)) {
      const missing: string[] = [];

      if (evidence.filesCreated.length !== evidence.filesVerified.length) {
        missing.push(
          `${evidence.filesCreated.length - evidence.filesVerified.length} files not verified`
        );
      }

      if (!evidence.buildPassed) {
        missing.push('build did not pass');
      }

      if (!evidence.testsPassed) {
        missing.push('tests did not pass');
      }

      throw new Error(
        `Cannot mark ${phaseName} complete - missing evidence:\n` +
          `  Files created: ${evidence.filesCreated.length}, verified: ${evidence.filesVerified.length}\n` +
          `  Build passed: ${evidence.buildPassed}\n` +
          `  Tests passed: ${evidence.testsPassed}\n` +
          `  Missing: ${missing.join(', ')}`
      );
    }

    this.phases.set(phaseName, {
      name: phaseName,
      status: 'complete',
      evidence,
      verifiedAt: Date.now(),
    });
  }

  /**
   * Mark a phase as failed with error message
   */
  markPhaseFailed(phaseName: string, error: string): void {
    this.phases.set(phaseName, {
      name: phaseName,
      status: 'failed',
      error,
    });
  }

  /**
   * Mark a phase as active (in progress)
   */
  markPhaseActive(phaseName: string): void {
    const existing = this.phases.get(phaseName);
    this.phases.set(phaseName, {
      name: phaseName,
      status: 'active',
      evidence: existing?.evidence,
    });
  }

  /**
   * Verify that evidence is sufficient
   */
  private verifyEvidence(evidence: Evidence): boolean {
    // All created files must actually exist
    if (evidence.filesCreated.length !== evidence.filesVerified.length) {
      return false;
    }

    // Re-verify files still exist on disk
    for (const file of evidence.filesVerified) {
      const fullPath = resolve(this.basePath, file);
      if (!existsSync(fullPath)) {
        return false;
      }
    }

    // Build must pass
    if (!evidence.buildPassed) {
      return false;
    }

    // Tests must pass (if any were run)
    if (!evidence.testsPassed) {
      return false;
    }

    return true;
  }

  /**
   * Get actual progress (only counts phases with verified evidence)
   */
  getActualProgress(): { percent: number; completed: number; total: number } {
    const allPhases = Array.from(this.phases.values());
    const completed = allPhases.filter(
      (p) => p.status === 'complete' && p.evidence && this.verifyEvidence(p.evidence)
    );

    const total = this.phases.size;
    const percent = total > 0 ? Math.round((completed.length / total) * 100) : 0;

    return {
      percent,
      completed: completed.length,
      total,
    };
  }

  /**
   * Check if we can proceed to next phase
   * Requires current phase to be complete with verified evidence
   */
  canProceedToNextPhase(currentPhase: string): boolean {
    const phase = this.phases.get(currentPhase);

    if (!phase || phase.status !== 'complete') {
      return false;
    }

    // Must have evidence
    if (!phase.evidence) {
      return false;
    }

    // Evidence must verify
    return this.verifyEvidence(phase.evidence);
  }

  /**
   * Get status of a specific phase
   */
  getPhaseStatus(phaseName: string): PhaseStatus | undefined {
    return this.phases.get(phaseName);
  }

  /**
   * Get all phases
   */
  getAllPhases(): PhaseStatus[] {
    return Array.from(this.phases.values());
  }

  /**
   * Get summary of current status
   */
  getSummary(): {
    total: number;
    pending: number;
    active: number;
    complete: number;
    failed: number;
  } {
    const phases = this.getAllPhases();
    return {
      total: phases.length,
      pending: phases.filter((p) => p.status === 'pending').length,
      active: phases.filter((p) => p.status === 'active').length,
      complete: phases.filter((p) => p.status === 'complete').length,
      failed: phases.filter((p) => p.status === 'failed').length,
    };
  }

  /**
   * Reset all phases
   */
  reset(): void {
    this.phases.clear();
  }

  /**
   * Initialize phases from a list of phase names
   */
  initializePhases(phaseNames: string[]): void {
    for (const name of phaseNames) {
      if (!this.phases.has(name)) {
        this.phases.set(name, {
          name,
          status: 'pending',
        });
      }
    }
  }
}
