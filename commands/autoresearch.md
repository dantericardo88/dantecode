---
name: autoresearch
description: "Focused self-improvement research loop for one scoring dimension"
contract_version: "danteforge.workflow/v1"
stages: [matrix-read, oss, harvest, party, verify, frontier-gap]
execution_mode: staged
failure_policy: stop_on_blocker
rollback_policy: preserve_untracked
worktree_policy: preferred
verification_required: true
---

# /autoresearch - Focused Dimension Self-Improvement

When the user invokes `/autoresearch`, execute the focused self-improvement workflow natively in Codex.
Do not default to the `danteforge` CLI unless the user explicitly asks for terminal execution or native execution is blocked.

Default shape:

1. Read `.danteforge/compete/matrix.json` and identify the requested dimension.
2. Run focused `/oss` discovery for that dimension.
3. Run one or more `/oss-harvest` passes for concrete pattern families.
4. Use `/party --autoforge` style lanes when the work can be split safely.
5. Add tests before production code for every implemented gap.
6. Write deterministic evidence under `.danteforge/evidence/`.
7. Run the relevant package gates plus `danteforge frontier-gap`.
8. Stop only when the target score is evidence-backed or with a blocker report.

For Dimension 48 Accessibility / Inclusive UX, the canonical invocation is:

```text
/autoresearch dim48 accessibility_inclusive_ux --target 9 --max-cycles 20
```

Dimension 48 must require proof for keyboard reachability, focus order, screen-reader semantics, live regions, contrast, high-contrast readiness, reduced motion, CLI/report output, VS Code webview enhancement, and release-gate behavior.
