#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

function runCommand(command, description) {
  console.log(`Checking: ${description}`);
  try {
    execSync(command, { cwd: rootDir, stdio: 'inherit' });
    console.log(`✅ ${description} - PASSED\n`);
    return true;
  } catch (error) {
    console.log(`❌ ${description} - FAILED\n`);
    return false;
  }
}

function checkVersionAlignment() {
  console.log('Checking: Version alignment across packages');
  const rootPkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
  const rootVersion = rootPkg.version;

  const packagesDir = join(rootDir, 'packages');
  const packages = readdirSync(packagesDir).filter(dir => statSync(join(packagesDir, dir)).isDirectory());

  let allMatch = true;
  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg, 'package.json');
    try {
      const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkgJson.version !== rootVersion) {
        console.log(`❌ Version mismatch in ${pkg}: ${pkgJson.version} vs ${rootVersion}`);
        allMatch = false;
      }
    } catch (e) {
      // Skip if no package.json
    }
  }

  if (allMatch) {
    console.log('✅ Version alignment - PASSED\n');
  } else {
    console.log('❌ Version alignment - FAILED\n');
  }
  return allMatch;
}

function checkCLISmoke() {
  console.log('Checking: CLI smoke test');
  try {
    // First build CLI
    execSync('pnpm build', { cwd: rootDir, stdio: 'pipe' });
    
    // Run --help
    execSync('node packages/cli/dist/index.js --help', { cwd: rootDir, stdio: 'pipe' });
    console.log('✅ CLI smoke test - PASSED\n');
    return true;
  } catch (error) {
    console.log('❌ CLI smoke test - FAILED\n');
    return false;
  }
}

function checkCLICommands() {
  console.log('Checking: CLI commands registered');
  try {
    const output = execSync('node packages/cli/dist/index.js --help', { cwd: rootDir, encoding: 'utf8' });
    // Assuming 17 commands, but let's check if common commands are there
    const commands = ['chat', 'run', 'agent', 'council', 'automate', 'research', 'review', 'triage', 'gaslight', 'vault', 'audit', 'init', 'config', 'self-update', 'skills', 'skillbook', 'serve'];
    let missing = [];
    for (const cmd of commands) {
      if (!output.includes(cmd)) {
        missing.push(cmd);
      }
    }
    if (missing.length === 0) {
      console.log('✅ CLI commands registered - PASSED\n');
      return true;
    } else {
      console.log(`❌ CLI commands registered - FAILED (missing: ${missing.join(', ')})\n`);
      return false;
    }
  } catch (error) {
    console.log('❌ CLI commands registered - FAILED\n');
    return false;
  }
}

function checkCircularDeps() {
  console.log('Checking: No circular dependencies');
  try {
    execSync('npx madge --circular packages/*/src/index.ts', { cwd: rootDir, stdio: 'pipe' });
    console.log('✅ No circular dependencies - PASSED\n');
    return true;
  } catch (error) {
    console.log('❌ No circular dependencies - FAILED\n');
    return false;
  }
}

function checkExports() {
  console.log('Checking: Export verification');
  const packagesDir = join(rootDir, 'packages');
  const packages = readdirSync(packagesDir).filter(dir => statSync(join(packagesDir, dir)).isDirectory());

  let allHaveExports = true;
  for (const pkg of packages) {
    const indexPath = join(packagesDir, pkg, 'src', 'index.ts');
    try {
      const content = readFileSync(indexPath, 'utf8');
      if (!content.includes('export ') || content.includes('export {};')) {
        console.log(`❌ No named exports in ${pkg}`);
        allHaveExports = false;
      }
    } catch (e) {
      // Skip if no index.ts
    }
  }

  if (allHaveExports) {
    console.log('✅ Export verification - PASSED\n');
  } else {
    console.log('❌ Export verification - FAILED\n');
  }
  return allHaveExports;
}

function checkLicenseAndReadme() {
  console.log('Checking: License + README present');
  const packagesDir = join(rootDir, 'packages');
  const packages = readdirSync(packagesDir).filter(dir => statSync(join(packagesDir, dir)).isDirectory());

  let allHave = true;
  for (const pkg of packages) {
    const pkgDir = join(packagesDir, pkg);
    const hasLicense = statSync(join(pkgDir, 'LICENSE'), { throwIfNoEntry: false })?.isFile();
    const hasReadme = statSync(join(pkgDir, 'README.md'), { throwIfNoEntry: false })?.isFile();
    if (!hasLicense || !hasReadme) {
      console.log(`❌ Missing LICENSE or README in ${pkg}`);
      allHave = false;
    }
  }

  if (allHave) {
    console.log('✅ License + README present - PASSED\n');
  } else {
    console.log('❌ License + README present - FAILED\n');
  }
  return allHave;
}

async function main() {
  console.log('🚀 DanteCode Release Check\n');

  const results = [];

  // 1. pnpm build succeeds
  results.push(runCommand('pnpm build', 'pnpm build succeeds'));

  // 2. pnpm test succeeds
  results.push(runCommand('pnpm test', 'pnpm test succeeds'));

  // 3. pnpm typecheck succeeds
  results.push(runCommand('pnpm typecheck', 'pnpm typecheck succeeds'));

  // 4. Anti-stub scan (will be separate script)
  results.push(runCommand('node scripts/anti-stub-scan.mjs', 'Anti-stub scan'));

  // 5. Version alignment
  results.push(checkVersionAlignment());

  // 6. CLI smoke
  results.push(checkCLISmoke());

  // 7. CLI commands registered
  results.push(checkCLICommands());

  // 8. No circular dependencies
  results.push(checkCircularDeps());

  // 9. Export verification
  results.push(checkExports());

  // 10. License + README present
  results.push(checkLicenseAndReadme());

  const passed = results.filter(Boolean).length;
  console.log(`\n📊 Results: ${passed}/10 checks passed`);

  if (passed === 10) {
    console.log('🎉 All checks passed! Ready for release.');
    process.exit(0);
  } else {
    console.log('❌ Some checks failed. Fix issues before release.');
    process.exit(1);
  }
}

main().catch(console.error);