// Full SWE-bench runner for DanteCode autonomy proof
// Implements 67% PR merge rate target

import { execSync } from 'child_process';

async function runMultiModel(id) {
  return execSync(`python swe-bench/run_multi_model.py ${id}`).toString();
}

async function verifyFix(fix) {
  return execSync(`python swe-bench/verify_fix.py "${fix}"`).toString().trim() === 'true';
}

async function costTracker(id) {
  return parseFloat(execSync(`python swe-bench/cost_tracker.py ${id}`).toString());
}

export async function runSweBenchFull(instances = 50) {
  const results = [];
  for (let i = 0; i < instances; i++) {
    const instance = await runInstance(i);
    results.push(instance);
  }
  const resolved = results.filter(r => r.resolved).length;
  const rate = resolved / instances;
  console.log(`Resolved: ${resolved}/${instances} (${rate * 100}%)`);
  return rate >= 0.67 ? 'PASS' : 'FAIL';
}

async function runInstance(id) {
  // Simulate agent run on SWE-bench instance
  const fix = await runMultiModel(id); // Multi-model agent execution
  const verified = await verifyFix(fix);
  const cost = await costTracker(id);
  return { resolved: verified, cost };
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const rate = await runSweBenchFull(parseInt(process.argv[2] || 50));
  process.exit(rate === 'PASS' ? 0 : 1);
}