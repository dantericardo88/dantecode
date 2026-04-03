## [Workflow] Build success is prep, not proof
_Added: 2026-04-02T12:56:00Z_
_Source: verify failure_

**Mistake:** Treating successful workspace builds and broad status docs as evidence that execution quality was fixed, even when the live hot path still relied on duplicated heuristics or focused typecheck/tests were red.
**Rule:** For execution-control changes, proof must be a green execution-quality gate that runs focused hot-path typecheck and regression suites for core, CLI, and VS Code. Builds may be run as prep for package-export resolution, but build success alone never counts as verification.
