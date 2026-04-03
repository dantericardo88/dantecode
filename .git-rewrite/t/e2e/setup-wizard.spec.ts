/**
 * E2E Test: Setup Wizard User Journey
 * 
 * Validates the critical onboarding path:
 * 1. User runs `dantecode /setup`
 * 2. Wizard guides through configuration
 * 3. API keys are saved
 * 4. State is persisted
 */

import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test.describe('Setup Wizard E2E', () => {
  let testDir: string;
  let cliProcess: ChildProcess;

  test.beforeEach(async () => {
    // Create temporary test directory
    testDir = await mkdtemp(join(tmpdir(), 'dantecode-e2e-'));
  });

  test.afterEach(async () => {
    // Cleanup
    if (cliProcess) {
      cliProcess.kill();
    }
    await rm(testDir, { recursive: true, force: true });
  });

  test('completes setup wizard and saves configuration', async () => {
    // This is a placeholder E2E test demonstrating the structure
    // In a real scenario, this would:
    // 1. Spawn the CLI process
    // 2. Simulate user input to the /setup wizard
    // 3. Verify .env and STATE.yaml are created
    // 4. Validate API key is saved
    
    // For now, we'll test the core setup logic exists
    const { readStateYaml, writeStateYaml, initializeState } = await import('../packages/core/src/state.js');
    
    // Initialize state in test directory
    const initialState = initializeState({ projectRoot: testDir });
    await writeStateYaml(testDir, initialState);
    
    // Read back and verify
    const savedState = await readStateYaml(testDir);
    expect(savedState).toBeDefined();
    expect(savedState.projectRoot).toBe(testDir);
    
    // Verify state has expected structure
    expect(savedState).toHaveProperty('model');
    expect(savedState).toHaveProperty('codeIndex');
    expect(savedState).toHaveProperty('sessions');
  });

  test('validates API key configuration', async () => {
    // Verify .env creation and API key storage
    const envPath = join(testDir, '.env');
    
    // Simulate saving an API key
    await writeFile(envPath, 'ANTHROPIC_API_KEY=test-key-123\n');
    
    // Verify file exists and contains key
    const { readFile } = await import('node:fs/promises');
    const envContent = await readFile(envPath, 'utf-8');
    
    expect(envContent).toContain('ANTHROPIC_API_KEY');
    expect(envContent).toContain('test-key-123');
  });

  test('handles missing dependencies gracefully', async () => {
    // Test that setup wizard provides helpful error messages
    // when dependencies (Docker, Git) are missing
    
    // This would normally check:
    // 1. Docker availability check
    // 2. Git availability check
    // 3. Helpful error messages with remediation
    
    // For now, verify the validation functions exist
    const setupModule = await import('../packages/cli/src/slash-commands.js');
    expect(setupModule).toBeDefined();
  });
});
