import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StatusTracker, type Evidence } from './status-tracker.js';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('StatusTracker', () => {
  let tracker: StatusTracker;
  const testDir = resolve(process.cwd(), '.test-status-tracker');

  beforeEach(() => {
    // Create test directory
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {
      // Directory might already exist
    }
    tracker = new StatusTracker(testDir);
  });

  afterEach(() => {
    // Cleanup test files
    try {
      const files = ['schema.ts', 'dev.db', 'test1.txt', 'test2.txt'];
      for (const file of files) {
        try {
          unlinkSync(resolve(testDir, file));
        } catch {
          // File might not exist
        }
      }
      rmdirSync(testDir);
    } catch {
      // Directory might not exist
    }
  });

  describe('markPhaseComplete', () => {
    it('should accept phase completion with valid evidence', () => {
      // Create test file
      const file = resolve(testDir, 'schema.ts');
      writeFileSync(file, 'export const schema = {}');

      const evidence: Evidence = {
        filesCreated: ['schema.ts'],
        filesVerified: ['schema.ts'],
        buildPassed: true,
        testsPassed: true,
        timestamp: Date.now(),
      };

      tracker.markPhaseComplete('setup', evidence);

      const phase = tracker.getPhaseStatus('setup');
      expect(phase?.status).toBe('complete');
      expect(phase?.evidence).toEqual(evidence);
      expect(phase?.verifiedAt).toBeDefined();
    });

    it('should reject completion when files do not exist', () => {
      const evidence: Evidence = {
        filesCreated: ['dev.db'],
        filesVerified: ['dev.db'], // Claims file exists but it doesn't
        buildPassed: true,
        testsPassed: true,
        timestamp: Date.now(),
      };

      expect(() => {
        tracker.markPhaseComplete('setup', evidence);
      }).toThrow('Cannot mark setup complete');
    });

    it('should reject completion when build did not pass', () => {
      const file = resolve(testDir, 'test.ts');
      writeFileSync(file, 'test');

      const evidence: Evidence = {
        filesCreated: ['test.ts'],
        filesVerified: ['test.ts'],
        buildPassed: false, // Build failed
        testsPassed: true,
        timestamp: Date.now(),
      };

      expect(() => {
        tracker.markPhaseComplete('build', evidence);
      }).toThrow('build did not pass');
    });

    it('should reject completion when tests did not pass', () => {
      const file = resolve(testDir, 'test.ts');
      writeFileSync(file, 'test');

      const evidence: Evidence = {
        filesCreated: ['test.ts'],
        filesVerified: ['test.ts'],
        buildPassed: true,
        testsPassed: false, // Tests failed
        timestamp: Date.now(),
      };

      expect(() => {
        tracker.markPhaseComplete('test', evidence);
      }).toThrow('tests did not pass');
    });

    it('should reject completion when file count mismatch', () => {
      const file1 = resolve(testDir, 'test1.txt');
      writeFileSync(file1, 'test');

      const evidence: Evidence = {
        filesCreated: ['test1.txt', 'test2.txt'], // Claims 2 files
        filesVerified: ['test1.txt'], // Only 1 verified
        buildPassed: true,
        testsPassed: true,
        timestamp: Date.now(),
      };

      expect(() => {
        tracker.markPhaseComplete('phase', evidence);
      }).toThrow('files not verified');
    });
  });

  describe('getActualProgress', () => {
    it('should return 0% when no phases exist', () => {
      const progress = tracker.getActualProgress();
      expect(progress.percent).toBe(0);
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
    });

    it('should return accurate percentage', () => {
      // Initialize 8 phases
      tracker.initializePhases(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);

      // Complete only phase 1 (1/8 = 12.5% ≈ 12%)
      const file = resolve(testDir, 'schema.ts');
      writeFileSync(file, 'test');

      tracker.markPhaseComplete('p1', {
        filesCreated: ['schema.ts'],
        filesVerified: ['schema.ts'],
        buildPassed: true,
        testsPassed: true,
        timestamp: Date.now(),
      });

      const progress = tracker.getActualProgress();
      expect(progress.percent).toBeGreaterThanOrEqual(10);
      expect(progress.percent).toBeLessThanOrEqual(15);
      expect(progress.completed).toBe(1);
      expect(progress.total).toBe(8);
    });

    it('should not count phases without evidence as complete', () => {
      tracker.phases.set('fake-complete', {
        name: 'fake-complete',
        status: 'complete',
        // No evidence!
      });

      const progress = tracker.getActualProgress();
      expect(progress.completed).toBe(0);
    });

    it('should not count phases with unverified evidence', () => {
      // Claim file exists but it actually doesn't
      tracker.phases.set('fake-verified', {
        name: 'fake-verified',
        status: 'complete',
        evidence: {
          filesCreated: ['missing.txt'],
          filesVerified: ['missing.txt'],
          buildPassed: true,
          testsPassed: true,
          timestamp: Date.now(),
        },
      });

      const progress = tracker.getActualProgress();
      expect(progress.completed).toBe(0); // Should not count
    });
  });

  describe('canProceedToNextPhase', () => {
    it('should return false when phase is not complete', () => {
      tracker.initializePhases(['phase1']);
      expect(tracker.canProceedToNextPhase('phase1')).toBe(false);
    });

    it('should return false when phase has no evidence', () => {
      tracker.phases.set('phase1', {
        name: 'phase1',
        status: 'complete',
        // No evidence
      });
      expect(tracker.canProceedToNextPhase('phase1')).toBe(false);
    });

    it('should return true when phase is properly verified', () => {
      const file = resolve(testDir, 'verified.ts');
      writeFileSync(file, 'test');

      tracker.markPhaseComplete('phase1', {
        filesCreated: ['verified.ts'],
        filesVerified: ['verified.ts'],
        buildPassed: true,
        testsPassed: true,
        timestamp: Date.now(),
      });

      expect(tracker.canProceedToNextPhase('phase1')).toBe(true);
    });
  });

  describe('phase status management', () => {
    it('should mark phase as active', () => {
      tracker.markPhaseActive('implementation');
      const phase = tracker.getPhaseStatus('implementation');
      expect(phase?.status).toBe('active');
    });

    it('should mark phase as failed with error', () => {
      tracker.markPhaseFailed('build', 'TypeScript errors');
      const phase = tracker.getPhaseStatus('build');
      expect(phase?.status).toBe('failed');
      expect(phase?.error).toBe('TypeScript errors');
    });

    it('should get all phases', () => {
      tracker.initializePhases(['p1', 'p2', 'p3']);
      const allPhases = tracker.getAllPhases();
      expect(allPhases).toHaveLength(3);
      expect(allPhases.map((p) => p.name)).toContain('p1');
      expect(allPhases.map((p) => p.name)).toContain('p2');
      expect(allPhases.map((p) => p.name)).toContain('p3');
    });
  });

  describe('getSummary', () => {
    it('should return accurate summary', () => {
      tracker.initializePhases(['p1', 'p2', 'p3', 'p4', 'p5']);
      tracker.markPhaseActive('p2');
      tracker.markPhaseFailed('p3', 'error');

      const file = resolve(testDir, 'test.ts');
      writeFileSync(file, 'test');
      tracker.markPhaseComplete('p4', {
        filesCreated: ['test.ts'],
        filesVerified: ['test.ts'],
        buildPassed: true,
        testsPassed: true,
        timestamp: Date.now(),
      });

      const summary = tracker.getSummary();
      expect(summary.total).toBe(5);
      expect(summary.pending).toBe(2); // p1, p5
      expect(summary.active).toBe(1); // p2
      expect(summary.failed).toBe(1); // p3
      expect(summary.complete).toBe(1); // p4
    });
  });

  describe('reset', () => {
    it('should clear all phases', () => {
      tracker.initializePhases(['p1', 'p2', 'p3']);
      tracker.reset();
      const phases = tracker.getAllPhases();
      expect(phases).toHaveLength(0);
    });
  });

  describe('initializePhases', () => {
    it('should create pending phases', () => {
      tracker.initializePhases(['setup', 'build', 'test', 'deploy']);
      const phases = tracker.getAllPhases();
      expect(phases).toHaveLength(4);
      expect(phases.every((p) => p.status === 'pending')).toBe(true);
    });

    it('should not overwrite existing phases', () => {
      tracker.markPhaseActive('setup');
      tracker.initializePhases(['setup', 'build']);

      const setup = tracker.getPhaseStatus('setup');
      expect(setup?.status).toBe('active'); // Should still be active, not pending
    });
  });
});
