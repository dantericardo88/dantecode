/**
 * Three-tier verification gates to prevent false "Phase Complete" claims.
 * Pattern extracted from CrewAI task validation.
 *
 * Level 1 (FileGate): Check file existence (fast, cheap)
 * Level 2 (BuildGate): Run build/typecheck (medium cost)
 * Level 3 (TestGate): Run tests (expensive)
 */

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export interface FileGateConfig {
  requiredFiles: string[];
  basePath?: string;
}

export interface BuildGateConfig {
  command: string;
  args?: string[];
  cwd?: string;
}

export interface TestGateConfig {
  command?: string;
  args?: string[];
  testPattern?: string;
  cwd?: string;
}

export interface GateConfig {
  files?: FileGateConfig;
  build?: BuildGateConfig;
  tests?: TestGateConfig;
}

export interface GateResult {
  passed: boolean;
  level: 1 | 2 | 3;
  errors: string[];
  warnings?: string[];
}

export class VerificationGates {
  /**
   * Run verification gates in sequence (Level 1 → 2 → 3)
   * Short-circuits on first failure
   */
  async run(config: GateConfig): Promise<GateResult> {
    // Level 1: File existence (always run if configured)
    if (config.files) {
      const fileResult = this.runFileGate(config.files);
      if (!fileResult.passed) {
        return { passed: false, level: 1, errors: fileResult.errors };
      }
    }

    // Level 2: Build/typecheck (run if configured)
    if (config.build) {
      const buildResult = await this.runBuildGate(config.build);
      if (!buildResult.passed) {
        return { passed: false, level: 2, errors: buildResult.errors };
      }
    }

    // Level 3: Tests (run if configured)
    if (config.tests) {
      const testResult = await this.runTestGate(config.tests);
      if (!testResult.passed) {
        return { passed: false, level: 3, errors: testResult.errors };
      }
    }

    return { passed: true, level: 3, errors: [] };
  }

  /**
   * Level 1: File Gate - Check file existence
   */
  private runFileGate(config: FileGateConfig): { passed: boolean; errors: string[] } {
    const missing: string[] = [];
    const basePath = config.basePath || process.cwd();

    for (const file of config.requiredFiles) {
      const fullPath = resolve(basePath, file);
      if (!existsSync(fullPath)) {
        missing.push(file);
      }
    }

    if (missing.length > 0) {
      return {
        passed: false,
        errors: [`Missing required files: ${missing.join(', ')}`],
      };
    }

    return { passed: true, errors: [] };
  }

  /**
   * Level 2: Build Gate - Run build/typecheck command
   */
  private async runBuildGate(config: BuildGateConfig): Promise<{ passed: boolean; errors: string[] }> {
    try {
      const args = config.args || [];
      execFileSync(config.command, args, {
        cwd: config.cwd || process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      });

      return { passed: true, errors: [] };
    } catch (error: unknown) {
      const err = error as { stderr?: string; stdout?: string; message?: string };
      const errorOutput = err.stderr || err.stdout || err.message || 'Build failed';
      return {
        passed: false,
        errors: [`Build failed: ${errorOutput.slice(0, 500)}`], // Truncate long errors
      };
    }
  }

  /**
   * Level 3: Test Gate - Run test suite
   */
  private async runTestGate(config: TestGateConfig): Promise<{ passed: boolean; errors: string[] }> {
    try {
      const command = config.command || 'npm';
      const args = config.args || ['test'];

      execFileSync(command, args, {
        cwd: config.cwd || process.cwd(),
        encoding: 'utf8',
        stdio: 'pipe',
      });

      return { passed: true, errors: [] };
    } catch (error: unknown) {
      const err = error as { stderr?: string; stdout?: string; message?: string };
      const errorOutput = err.stderr || err.stdout || err.message || 'Tests failed';
      return {
        passed: false,
        errors: [`Tests failed: ${errorOutput.slice(0, 500)}`],
      };
    }
  }

  /**
   * Run only file gate (lightweight check)
   */
  async runFileGateOnly(config: FileGateConfig): Promise<GateResult> {
    const result = this.runFileGate(config);
    return {
      passed: result.passed,
      level: 1,
      errors: result.errors,
    };
  }

  /**
   * Run file + build gates (skip tests)
   */
  async runBuildGateOnly(config: { files?: FileGateConfig; build: BuildGateConfig }): Promise<GateResult> {
    return this.run({ files: config.files, build: config.build });
  }
}
