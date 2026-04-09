#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function runCLICommand(args, description) {
  console.log(`Testing: ${description}`);
  try {
    const output = execSync(`node packages/cli/dist/index.js ${args}`, { cwd: rootDir, encoding: 'utf8' });
    console.log(`✅ ${description} - PASSED`);
    return { success: true, output };
  } catch (error) {
    console.log(`❌ ${description} - FAILED`);
    return { success: false, error };
  }
}

function main() {
  console.log('🚀 CLI Smoke Test\n');

  // First, build the CLI
  console.log('Building CLI...');
  try {
    execSync('pnpm build', { cwd: rootDir, stdio: 'pipe' });
    console.log('✅ CLI built successfully\n');
  } catch (error) {
    console.log('❌ CLI build failed\n');
    process.exit(1);
  }

  const results = [];

  // Test --version
  const versionResult = runCLICommand('--version', 'dantecode --version');
  results.push(versionResult.success);

  // Check version matches package.json
  if (versionResult.success) {
    const rootPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
    if (versionResult.output.trim() === rootPkg.version) {
      console.log('✅ Version matches package.json');
    } else {
      console.log('❌ Version mismatch');
      results.push(false);
    }
  }

  // Test --help
  const helpResult = runCLICommand('--help', 'dantecode --help');
  results.push(helpResult.success);

  // Check if all 17 commands are listed (approximate check)
  if (helpResult.success) {
    const output = helpResult.output;
    const expectedCommands = ['chat', 'run', 'agent', 'council', 'automate', 'research', 'review', 'triage', 'gaslight', 'vault', 'audit', 'init', 'config', 'self-update', 'skills', 'skillbook', 'serve'];
    let missing = [];
    for (const cmd of expectedCommands) {
      if (!output.includes(cmd)) {
        missing.push(cmd);
      }
    }
    if (missing.length === 0) {
      console.log('✅ All expected commands present in help');
    } else {
      console.log(`❌ Missing commands: ${missing.join(', ')}`);
      results.push(false);
    }
  }

  // Test --help for a few key commands
  const keyCommands = ['chat', 'run', 'init'];
  for (const cmd of keyCommands) {
    const cmdResult = runCLICommand(`${cmd} --help`, `dantecode ${cmd} --help`);
    results.push(cmdResult.success);
  }

  const passed = results.filter(Boolean).length;
  const total = results.length;

  console.log(`\n📊 CLI Smoke Results: ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log('🎉 CLI smoke test passed!');
    process.exit(0);
  } else {
    console.log('❌ CLI smoke test failed.');
    process.exit(1);
  }
}

main().catch(console.error);