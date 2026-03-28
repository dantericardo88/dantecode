#!/usr/bin/env node
/**
 * Speed Benchmarks
 *
 * Measures DanteCode's performance metrics:
 * - Time to first suggestion
 * - Task completion time
 * - Deploy time (code generation → tests pass)
 *
 * Outputs p50, p95, p99 latencies for comparison with competitors.
 *
 * Usage:
 *   node speed-benchmark.mjs --iterations 10
 *   node speed-benchmark.mjs --task simple-function
 */

import { writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { performance } from "node:perf_hooks";

const execAsync = promisify(exec);

const BENCHMARK_TASKS = [
  {
    id: "simple-function",
    name: "Simple Function",
    prompt: "Write a function to calculate fibonacci numbers",
    category: "generation",
  },
  {
    id: "bug-fix",
    name: "Bug Fix",
    prompt:
      "Fix this bug: function divide(a, b) { return a / b } // should handle division by zero",
    category: "fix",
  },
  {
    id: "test-gen",
    name: "Test Generation",
    prompt: "Write tests for a string reverse function",
    category: "generation",
  },
  {
    id: "refactor",
    name: "Refactoring",
    prompt: "Refactor this to use async/await: getData((data) => { processData(data, (result) => { console.log(result) }) })",
    category: "refactor",
  },
  {
    id: "explain",
    name: "Code Explanation",
    prompt: "Explain what this regex does: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/",
    category: "explain",
  },
];

class SpeedBenchmark {
  constructor(iterations = 5) {
    this.iterations = iterations;
    this.measurements = [];
  }

  async measureTask(task) {
    console.log(`\nBenchmarking: ${task.name} (${this.iterations} iterations)`);
    const taskMeasurements = [];

    for (let i = 0; i < this.iterations; i++) {
      console.log(`  Iteration ${i + 1}/${this.iterations}...`);

      const measurement = await this.runSingleMeasurement(task);
      taskMeasurements.push(measurement);

      console.log(
        `    Time to first token: ${measurement.timeToFirstTokenMs}ms`
      );
      console.log(`    Total time: ${measurement.totalTimeMs}ms`);
    }

    // Calculate statistics
    const stats = this.calculateStats(taskMeasurements, task);
    this.measurements.push(stats);

    console.log(`\n  Statistics:`);
    console.log(`    p50: ${stats.p50TotalMs}ms`);
    console.log(`    p95: ${stats.p95TotalMs}ms`);
    console.log(`    p99: ${stats.p99TotalMs}ms`);

    return stats;
  }

  async runSingleMeasurement(task) {
    const startTime = performance.now();
    let firstTokenTime = null;
    let endTime = null;

    try {
      // Run dantecode with streaming to capture first token time
      const cmd = `dantecode agent "${task.prompt}" --timeout 60`;

      const childProcess = exec(cmd, {
        timeout: 65000,
      });

      let output = "";
      let gotFirstToken = false;

      // Capture first output chunk (first token approximation)
      childProcess.stdout?.on("data", (chunk) => {
        if (!gotFirstToken) {
          firstTokenTime = performance.now() - startTime;
          gotFirstToken = true;
        }
        output += chunk;
      });

      // Wait for completion
      await new Promise((resolve, reject) => {
        childProcess.on("close", (code) => {
          endTime = performance.now() - startTime;
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Process exited with code ${code}`));
          }
        });

        childProcess.on("error", reject);
      });

      return {
        taskId: task.id,
        success: true,
        timeToFirstTokenMs: firstTokenTime || endTime,
        totalTimeMs: endTime,
        outputLength: output.length,
        error: null,
      };
    } catch (error) {
      endTime = performance.now() - startTime;
      return {
        taskId: task.id,
        success: false,
        timeToFirstTokenMs: endTime,
        totalTimeMs: endTime,
        outputLength: 0,
        error: error.message,
      };
    }
  }

  calculateStats(measurements, task) {
    const successful = measurements.filter((m) => m.success);
    const totalTimes = successful
      .map((m) => m.totalTimeMs)
      .sort((a, b) => a - b);
    const firstTokenTimes = successful
      .map((m) => m.timeToFirstTokenMs)
      .sort((a, b) => a - b);

    const percentile = (arr, p) => {
      if (arr.length === 0) return 0;
      const index = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, index)];
    };

    return {
      taskId: task.id,
      taskName: task.name,
      category: task.category,
      iterations: this.iterations,
      successfulRuns: successful.length,
      failedRuns: measurements.length - successful.length,

      // Total time percentiles
      p50TotalMs: percentile(totalTimes, 50),
      p95TotalMs: percentile(totalTimes, 95),
      p99TotalMs: percentile(totalTimes, 99),
      minTotalMs: totalTimes[0] || 0,
      maxTotalMs: totalTimes[totalTimes.length - 1] || 0,
      avgTotalMs:
        totalTimes.reduce((a, b) => a + b, 0) / totalTimes.length || 0,

      // Time to first token percentiles
      p50FirstTokenMs: percentile(firstTokenTimes, 50),
      p95FirstTokenMs: percentile(firstTokenTimes, 95),
      p99FirstTokenMs: percentile(firstTokenTimes, 99),
      minFirstTokenMs: firstTokenTimes[0] || 0,
      maxFirstTokenMs: firstTokenTimes[firstTokenTimes.length - 1] || 0,
      avgFirstTokenMs:
        firstTokenTimes.reduce((a, b) => a + b, 0) / firstTokenTimes.length ||
        0,

      rawMeasurements: measurements,
    };
  }

  async runAll() {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`DanteCode Speed Benchmarks`);
    console.log(`${"=".repeat(80)}\n`);
    console.log(`Iterations per task: ${this.iterations}`);
    console.log(`Total tasks: ${BENCHMARK_TASKS.length}`);

    for (const task of BENCHMARK_TASKS) {
      await this.measureTask(task);
    }

    // Generate summary
    const summary = {
      timestamp: new Date().toISOString(),
      iterations: this.iterations,
      totalTasks: BENCHMARK_TASKS.length,
      measurements: this.measurements,

      // Overall averages
      overallAvgP50Ms:
        this.measurements.reduce((sum, m) => sum + m.p50TotalMs, 0) /
        this.measurements.length,
      overallAvgP95Ms:
        this.measurements.reduce((sum, m) => sum + m.p95TotalMs, 0) /
        this.measurements.length,
      overallAvgFirstTokenMs:
        this.measurements.reduce((sum, m) => sum + m.avgFirstTokenMs, 0) /
        this.measurements.length,
    };

    // Save results
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `../results/speed-metrics-${timestamp}.json`;
    await writeFile(filename, JSON.stringify(summary, null, 2));

    console.log(`\n${"=".repeat(80)}`);
    console.log(`OVERALL SUMMARY`);
    console.log(`${"=".repeat(80)}`);
    console.log(`Avg p50 total time: ${summary.overallAvgP50Ms.toFixed(0)}ms`);
    console.log(`Avg p95 total time: ${summary.overallAvgP95Ms.toFixed(0)}ms`);
    console.log(
      `Avg time to first token: ${summary.overallAvgFirstTokenMs.toFixed(0)}ms`
    );
    console.log(`\nResults saved to: ${filename}`);
    console.log(`${"=".repeat(80)}\n`);

    return summary;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const iterArg = args.find((arg) => arg.startsWith("--iterations="));
  const iterations = iterArg ? parseInt(iterArg.split("=")[1]) : 5;

  const taskArg = args.find((arg) => arg.startsWith("--task="));
  const taskId = taskArg ? taskArg.split("=")[1] : null;

  const benchmark = new SpeedBenchmark(iterations);

  if (taskId) {
    const task = BENCHMARK_TASKS.find((t) => t.id === taskId);
    if (!task) {
      console.error(`Invalid task: ${taskId}`);
      console.error(
        `Valid tasks: ${BENCHMARK_TASKS.map((t) => t.id).join(", ")}`
      );
      process.exit(1);
    }
    await benchmark.measureTask(task);
  } else {
    await benchmark.runAll();
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
