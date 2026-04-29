# Benchmark Transparency Gate

- Dimension: benchmark_transparency
- Suite: builtin
- Run ID: 7589d0ea-2819-489f-8b6c-36c9a3187058
- Pass: yes
- Score: 100/90
- Generated: 2026-04-29T18:15:29.086Z
- Command: `dantecode bench transparency --suite builtin --seed 45 --output-dir benchmarks/transparency --evidence --format json`
- Seed: 45
- Dataset hash: ead0c81b8888d12b6c6501180707a69ccf67b8bab04c91131130d459c95ce209
- Pass rate: 100.0% (25/25)

## Artifacts

| Kind | Path | SHA-256 |
|---|---|---|
| raw_report | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/raw-report.json | 2aaaddc555a99a3ff38985c77adf9bb3428ddaa5dfec153e68c04bf186af630c |
| markdown_report | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/report.md | ef176d4be4ab3becd7d3548c620143d702872dc90f59d92897a5f622ea675e7b |
| command | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/command.txt | ba0aac044f055e8aba9df9e1f74d2caa0a1786f3ea147e8e1d0d798278f1eb05 |
| selected_instances | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/selected-instances.json | 6e13dc8939ab7c1d18443dd19e17905881f29c2a6578de2a19c9ff059002a344 |
| per_instance_logs | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/per-instance-logs.jsonl | edec941c02270c05fe4ab7ec8ac0d81794e43eda7e222082d9889a895087f317 |
| trace_refs | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/trace-refs.json | 7de9ac04af509f66221048f1cdfa22e9b0bd7f6b6678fe8e6be28f6e475ecb31 |
| limitations | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/limitations.md | c6e11391ab5801cf7545935096f02f243e49a5d14c7654231498c9df7284f48b |
| manifest | benchmarks/transparency/7589d0ea-2819-489f-8b6c-36c9a3187058/manifest.json | f852138d1b3eddcea1e6b73688b70fc51c0dc726648ce6bfc9686b1bae9aa2a1 |

## Limitations

- Built-in canary proves benchmark artifact transparency, not SWE-bench correctness.
- External publication and repeated CI runs are still required before claiming 9.5+.

## Rerun

`dantecode bench transparency --suite builtin --seed 45 --output-dir benchmarks/transparency --evidence --format json`

## Blockers

- none
