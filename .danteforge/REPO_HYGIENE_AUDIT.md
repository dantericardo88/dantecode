# Repo Hygiene Audit
_Tracked-noise inventory | Updated: 2026-04-16_

## Purpose

This audit records the local-only paths that are still tracked or still showing up
in the working tree. `.gitignore` now blocks new files in these areas, but tracked
gitlinks and existing scratch directories still need an explicit cleanup decision.

Execution status:
- The tracked gitlinks listed below were removed from the index in this branch.
- The ignore rules now prevent these paths from reappearing as ordinary source.

## Findings

### 1. Tracked agent worktrees

- Path: `.claude/worktrees/`
- Git object type: submodule/gitlink entries (`160000`)
- Count: 47 tracked entries
- Current behavior: many entries show `m` or `?` in `git status`, which means local
  agent work is still surfacing as repo noise.
- Decision: remove these gitlinks from the index and keep the path local-only going
  forward.

### 2. Tracked harvested repos

- Path: `.danteforge/oss-repos/`
- Git object type: submodule/gitlink entries (`160000`)
- Count: 9 tracked entries
- Current behavior: the repo stores harvested upstreams as tracked gitlinks even
  though the working rule for this finish cycle is that harvest repos are research
  inputs, not product source.
- Decision: preserve provenance in `oss-registry.json` or docs, then keep the
  cloned repos local-only instead of tracked.

### 3. Tracked SWE-bench workspaces

- Path: `benchmarks/swe-bench/.swe-bench-workspace/`
- Git object type: submodule/gitlink entries (`160000`)
- Count: 21 tracked entries
- Current behavior: benchmark workspaces show frequent `m` and `?` status noise.
- Decision: keep benchmark manifests and harness code in git, but keep workspace
  directories local-only and regenerate them when needed.

### 4. Tracked root research clone

- Path: `repo`
- Git object type: submodule/gitlink entry (`160000`)
- Count: 1 tracked entry
- Current behavior: it shows as modified in `git status`, but the name does not
  communicate a stable product responsibility.
- Decision: it has been removed from the index for now; if it is needed later, it
  should come back under a clearly named documented fixture area.

### 5. Untracked local research clones

- Paths: `screenshot-to-code/`, `twinny/`, `void/`
- Git object type: local directories, currently untracked
- Current behavior: they showed up as `??` before ignore coverage was tightened.
- Decision: keep them ignored and treat them as local comparison sandboxes unless
  they are intentionally promoted into `packages/` or `external/`.

## Commands Used

- `git ls-files .claude/worktrees .danteforge/oss-repos benchmarks/swe-bench/.swe-bench-workspace repo screenshot-to-code twinny void`
- `git ls-files --stage .claude/worktrees .danteforge/oss-repos benchmarks/swe-bench/.swe-bench-workspace repo`
- `git status --short -- repo screenshot-to-code twinny void .claude/worktrees .danteforge/oss-repos benchmarks/swe-bench/.swe-bench-workspace`

## Recommended Next Cleanup Commit

1. Keep the ignore rules in place so these paths stay local-only after cleanup.
2. Decide later whether any removed scratch clone deserves to come back as a
   documented fixture under a stable path.
