import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VerificationGates } from './verification-gates.js';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('VerificationGates', () => {
  let gates: VerificationGates;
  const testDir = resolve(process.cwd(), '.test-verification-gates');

  beforeEach(() => {
    gates = new VerificationGates();
    // Create test directory
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {
      // Directory might already exist
    }
  });

  afterEach(() => {
    // Cleanup test files
    try {
      const files = ['test-file.txt', 'dev.db', 'schema.ts'];
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

  describe('Level 1: File Gate', () => {
    it('should pass when all required files exist', async () => {
      // Create test file
      const testFile = resolve(testDir, 'test-file.txt');
      writeFileSync(testFile, 'test content');

      const result = await gates.run({
        files: {
          requiredFiles: ['test-file.txt'],
          basePath: testDir,
        },
      });

      expect(result.passed).toBe(true);
      expect(result.level).toBe(3); // Passed all levels (only L1 configured)
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when required file is missing', async () => {
      const result = await gates.run({
        files: {
          requiredFiles: ['dev.db'],
          basePath: testDir,
        },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('dev.db');
    });

    it('should detect multiple missing files', async () => {
      const result = await gates.run({
        files: {
          requiredFiles: ['dev.db', 'schema.ts', 'migrations/'],
          basePath: testDir,
        },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe(1);
      expect(result.errors[0]).toContain('dev.db');
      expect(result.errors[0]).toContain('schema.ts');
      expect(result.errors[0]).toContain('migrations/');
    });

    it('should handle absolute paths', async () => {
      const testFile = resolve(testDir, 'absolute-test.txt');
      writeFileSync(testFile, 'content');

      const result = await gates.run({
        files: {
          requiredFiles: [testFile],
        },
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('Level 2: Build Gate', () => {
    it('should pass when build succeeds', async () => {
      const result = await gates.run({
        build: {
          command: 'node',
          args: ['--version'], // Simple command that always succeeds
        },
      });

      expect(result.passed).toBe(true);
      expect(result.level).toBe(3);
    });

    it('should fail when build command fails', async () => {
      const result = await gates.run({
        build: {
          command: 'node',
          args: ['--invalid-flag-that-does-not-exist'],
        },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Build failed');
    });

    it('should fail when build command does not exist', async () => {
      const result = await gates.run({
        build: {
          command: 'this-command-definitely-does-not-exist-12345',
          args: [],
        },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe(2);
    });
  });

  describe('Level 3: Test Gate', () => {
    it('should pass when tests succeed', async () => {
      const result = await gates.run({
        tests: {
          command: 'node',
          args: ['--version'], // Simple command that succeeds
        },
      });

      expect(result.passed).toBe(true);
      expect(result.level).toBe(3);
    });

    it('should fail when tests fail', async () => {
      const result = await gates.run({
        tests: {
          command: 'node',
          args: ['--this-will-fail'],
        },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe(3);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Tests failed');
    });
  });

  describe('Multi-level validation', () => {
    it('should short-circuit on file gate failure', async () => {
      // File gate fails, so build gate should not run
      const result = await gates.run({
        files: {
          requiredFiles: ['missing-file.txt'],
          basePath: testDir,
        },
        build: {
          command: 'node',
          args: ['--version'],
        },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe(1); // Failed at level 1
    });

    it('should short-circuit on build gate failure', async () => {
      const testFile = resolve(testDir, 'exists.txt');
      writeFileSync(testFile, 'content');

      // Files pass, build fails, tests should not run
      const result = await gates.run({
        files: {
          requiredFiles: ['exists.txt'],
          basePath: testDir,
        },
        build: {
          command: 'node',
          args: ['--this-fails'],
        },
        tests: {
          command: 'node',
          args: ['--version'],
        },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe(2); // Failed at level 2
    });

    it('should pass all three levels when everything succeeds', async () => {
      const testFile = resolve(testDir, 'all-pass.txt');
      writeFileSync(testFile, 'content');

      const result = await gates.run({
        files: {
          requiredFiles: ['all-pass.txt'],
          basePath: testDir,
        },
        build: {
          command: 'node',
          args: ['--version'],
        },
        tests: {
          command: 'node',
          args: ['-e', 'process.exit(0)'],
        },
      });

      expect(result.passed).toBe(true);
      expect(result.level).toBe(3);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Helper methods', () => {
    it('should run file gate only', async () => {
      const testFile = resolve(testDir, 'helper-test.txt');
      writeFileSync(testFile, 'content');

      const result = await gates.runFileGateOnly({
        requiredFiles: ['helper-test.txt'],
        basePath: testDir,
      });

      expect(result.passed).toBe(true);
      expect(result.level).toBe(1);
    });

    it('should run build gate only (with file check)', async () => {
      const testFile = resolve(testDir, 'build-only.txt');
      writeFileSync(testFile, 'content');

      const result = await gates.runBuildGateOnly({
        files: {
          requiredFiles: ['build-only.txt'],
          basePath: testDir,
        },
        build: {
          command: 'node',
          args: ['--version'],
        },
      });

      expect(result.passed).toBe(true);
      // When all configured gates pass, level is 3 (highest configured level passed)
      expect(result.level).toBeGreaterThanOrEqual(2);
    });
  });
});
