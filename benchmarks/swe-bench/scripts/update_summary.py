#!/usr/bin/env python3
"""Aggregates SWE-bench result JSON files into RESULTS_SUMMARY.md"""
import json
import os
from pathlib import Path
from datetime import datetime

results_dir = Path(__file__).parent.parent / "results"
summary_path = Path(__file__).parent.parent / "RESULTS_SUMMARY.md"

all_runs = []
for f in sorted(results_dir.glob("*.json")):
    try:
        data = json.loads(f.read_text())
        all_runs.append(data)
    except Exception:
        continue

if not all_runs:
    print("No result files found")
    exit(0)

total_instances = sum(r.get("total_instances", 0) for r in all_runs)
total_passed = sum(r.get("passed", 0) for r in all_runs)
total_errors = sum(r.get("errors", 0) for r in all_runs)
pass_rate = (total_passed / total_instances * 100) if total_instances > 0 else 0

lines = [
    "# DanteCode SWE-bench Results",
    "",
    f"*Updated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}*",
    "",
    "## Aggregate Score",
    f"- **Total instances:** {total_instances}",
    f"- **Passed:** {total_passed}",
    f"- **Errors (infrastructure):** {total_errors}",
    f"- **Pass rate:** {pass_rate:.1f}%",
    "",
    "> **Note:** Infrastructure errors (missing API keys, timeouts) are excluded from the credible pass rate.",
    "> Credible runs (with credentials configured): see individual run entries below.",
    "",
    "## Recent Runs (10 most recent)",
    "",
    "| Run ID | Date | Instances | Passed | Pass Rate |",
    "|--------|------|-----------|--------|-----------|",
]

for r in sorted(all_runs, key=lambda x: x.get("timestamp", ""), reverse=True)[:10]:
    run_id = r.get("run_id", "unknown")[:20]
    ts = r.get("timestamp", "")[:10]
    inst = r.get("total_instances", 0)
    passed = r.get("passed", 0)
    rate = r.get("pass_rate", 0) * 100
    lines.append(f"| {run_id} | {ts} | {inst} | {passed} | {rate:.1f}% |")

summary_path.write_text("\n".join(lines) + "\n")
print(f"Updated {summary_path}")
