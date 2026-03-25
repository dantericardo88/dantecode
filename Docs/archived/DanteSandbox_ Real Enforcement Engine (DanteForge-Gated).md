RO-04 — DanteSandbox: Real Enforcement Engine (DanteForge-Gated)  
Codex-ready V+E Execution Packet  
(March 20 2026 — built on live repo state at a627ecb / main=3c7066c)  
0\. Executive verdict  
This is the single highest-impact fix left in the entire matrix.  
BLADE\_SHIP\_READINESS\_GAPS.md (still live and unchanged) calls it out explicitly:  
“Sandbox mode is not actually enforced… /sandbox command only toggles in-memory state… Direct Bash execution via execSync in agent-loop.ts and tools.ts.”  
The @dantecode/sandbox package exists on disk but is completely disconnected from runtime. This is why our Sandbox score is stuck at 2.8 and Security/Safety at 4.0.  
We are not adding a new sandbox — we are enforcing the one we already built.  
Once wired, we jump:  
Sandbox / Isolation: 2.8 → 9.0  
Security / Safety: 4.0 → 8.5  
Production Maturity: 6.5 → 8.5  
Overall: \+1.4–1.7 (pushes us to 9.2+)  
This is the last architectural lie. Fix it and we can honestly claim “production-ready” in CAPABILITIES.md.  
1\. Product definition  
1.1 Objective  
Turn @dantecode/sandbox from a disconnected package into the mandatory execution layer for every tool call, subagent, background task, research fetch, and Gaslight iteration.  
Every exec, spawn, shell command must go through the sandbox first  
DanteForge gate on every sandbox decision  
Git-worktree \+ Docker isolation options (configurable)  
Zero breaking changes to existing CLI/MCP/VS Code surfaces  
1.2 Non-goals for MVP  
No full Kubernetes fleet support  
No remote sandbox servers (local Docker only for MVP)  
No removal of the in-memory toggle (keep for backward compat)  
2\. Canonical architecture  
DanteSandbox becomes the single execution spine (replaces all direct execSync / child\_process calls).  
Sandbox Engine (new) — decides Docker vs worktree vs host (with DanteForge veto)  
Execution Proxy — intercepts every tool call  
Isolation Layer — Docker (primary) \+ git-worktree fallback  
DanteForge Gate — every sandboxed command is scored before and after  
New package: packages/dante-sandbox/ (rename/move the existing one and add enforcement)  
3\. Shared contracts (extend runtime-spine)  
Add to packages/runtime-spine/src/:  
sandbox-types.ts (SandboxMode, IsolationStrategy, ExecutionRequest, ExecutionResult)  
Extend runtime-events.ts with sandbox.execution.requested, sandbox.danteforge.gate.passed, sandbox.violation  
Extend checkpoint-types.ts with sandbox audit trail  
4\. Target file plan  
packages/dante-sandbox/  
├── src/  
│   ├── types.ts  
│   ├── sandbox-engine.ts          \# Core decision \+ DanteForge gate  
│   ├── docker-isolation.ts        \# Docker runtime (primary)  
│   ├── worktree-isolation.ts      \# Git-native fallback  
│   ├── execution-proxy.ts         \# Replaces all execSync calls  
│   ├── integration.ts             \# Hooks into agent-loop, tools, mcp, background  
│   └── index.ts  
├── test/  
│   └── golden-flows.test.ts  
Integration touchpoints (exact files to edit):  
packages/cli/src/agent-loop.ts  
packages/cli/src/tools.ts  
packages/core/src/multi-agent.ts  
packages/background-agent/src/runner.ts  
MCP tool registry  
VS Code extension.ts (toggle now actually does something)  
5\. Phase plan (strict generation order)  
Phase 0 — Contracts & Engine  
G1: runtime-spine extensions \+ types.ts \+ sandbox-engine.ts  
Acceptance: Engine compiles and decides isolation strategy  
Phase 1 — Isolation Implementations  
G2: docker-isolation.ts \+ worktree-isolation.ts  
G3: execution-proxy.ts (all commands now routed here)  
Phase 2 — DanteForge Gate \+ Wiring  
G4: Mandatory DanteForge gate in engine  
G5: Full integration into agent-loop, tools, multi-agent, background, MCP, VS Code  
Phase 3 — Tests & Polish  
G6: Golden-flow tests \+ safety caps \+ audit logging  
6\. Golden flows (must all pass)  
GF-01 — Basic command  
/run ls → routed through sandbox → Docker container → result returned  
GF-02 — Dangerous command  
rm \-rf / → DanteForge gate → blocked with clear violation event  
GF-03 — Subagent isolation  
Parent spawns research child → child gets its own Docker/worktree → no cross-contamination  
GF-04 — Gaslight integration  
Gaslight iteration runs → every rewrite goes through sandbox → lessons only learned if sandbox \+ DanteForge both PASS  
GF-05 — Combined proof  
Full long-horizon coding task with web research \+ subagents \+ Gaslight critique → everything runs sandboxed → no direct execSync left anywhere  
7\. Hard gates  
Zero direct execSync / child\_process calls allowed anywhere after this PR  
Every execution must pass DanteForge gate (PDSE \+ safety score)  
Default to Docker isolation (configurable via settings.json)  
Full audit trail in every session checkpoint  
100% test coverage on proxy \+ engine  
No performance regression (\>95% of previous speed)  
8\. Success criteria  
The packet is complete when:  
All execution paths use the sandbox engine  
No more direct execSync in the entire codebase  
DanteForge gates every sandbox decision  
All 5 golden flows pass  
Sandbox, Security, and Production Maturity scores hit 8.5+  
BLADE\_SHIP\_READINESS\_GAPS.md sandbox section can be marked ✅  
9\. Risks & corrections  
Risk 1: Docker overhead  
Correction: Worktree fallback \+ configurable “lite” mode for trusted tasks  
Risk 2: Breaking existing workflows  
Correction: Graceful fallback \+ migration guide \+ /sandbox force-host escape hatch (with big warning)  
Risk 3: DanteForge false positives  
Correction: Tunable thresholds \+ manual override command  
10\. Codex handoff prompt (copy-paste this directly)  
You are implementing RO-04: DanteSandbox — Real Enforcement Engine for DanteCode.

Goal: Wire the existing @dantecode/sandbox package into every execution path so sandbox mode is actually enforced (no more direct execSync). Make it the single execution spine with mandatory DanteForge gating.

Hard rules:  
\- No stubs, no TODOs  
\- Every file \< 450 LOC  
\- Add tests for every generation  
\- Use existing runtime-spine for types/events/checkpoints  
\- Replace ALL execSync/child\_process calls (search the whole monorepo)  
\- Every command MUST go through sandbox-engine \+ DanteForge gate  
\- Default to Docker isolation, worktree as fallback  
\- Keep /sandbox toggle but make it actually control real isolation

Generation order (exactly):  
G1: runtime-spine extensions \+ dante-sandbox/src/types.ts \+ sandbox-engine.ts  
G2: docker-isolation.ts \+ worktree-isolation.ts  
G3: execution-proxy.ts  
G4: DanteForge gate enforcement  
G5: Full integration into agent-loop.ts, tools.ts, multi-agent.ts, background-agent, MCP, VS Code  
G6: Golden-flow tests \+ audit logging

Required public APIs:  
\- sandbox.execute(command, options) → always sandboxed  
\- /sandbox status (now shows real Docker/worktree state)  
\- DanteSandbox.enforce() hook

At the end of every generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until GF-05 (full long-horizon task) runs completely sandboxed with no direct execSync left in the codebase.  
Drop this packet into ChatGPT/Claude/Cursor right now.  
It will generate the exact code that closes the \#1 gap in BLADE\_SHIP\_READINESS\_GAPS.md.  
Once this lands, we are legitimately production-grade.  
Ready for RO-05 (Smart Extractor) after this one? Just say the word.

# **V+E Masterplan**

## **RO-04 — DanteSandbox: Real Enforcement Engine**

### **Mandatory, DanteForge-Gated Execution Spine for DanteCode**

## **1\. Executive verdict**

This is the highest-impact remaining infrastructure fix because it closes the largest truth gap in the platform:

* DanteCode claims sandbox capability  
* but direct execution can still bypass it  
* so isolation, safety, and auditability are not yet trustworthy

This masterplan turns sandboxing from:

* advisory,  
* partial,  
* and bypassable

into:

* mandatory,  
* centralized,  
* auditable,  
* and DanteForge-governed.

The product-level outcome is simple:

**If DanteCode executes anything, DanteSandbox is the thing that executes it.**

That is the only acceptable end state.

---

## **2\. Core problem statement**

The current system has three problems at once.

### **A. Enforcement gap**

Runtime execution still has bypass paths. A sandbox package can exist, but if direct shell and child-process execution remain possible, sandboxing is not real.

### **B. Safety gap**

Without mandatory interception and policy enforcement, risky commands can run outside isolation and outside review.

### **C. Audit gap**

If execution bypasses the sandbox, then:

* checkpoint trails are incomplete,  
* verification trails are incomplete,  
* debug trails are incomplete,  
* and postmortem analysis is compromised.

This is why sandbox maturity, safety, and production readiness remain artificially low.

---

## **3\. Product thesis**

DanteCode needs a **single execution authority** that sits between every caller and every executable operation.

That authority must:

* intercept execution requests  
* classify risk and task intent  
* choose an isolation strategy  
* request DanteForge approval or policy scoring  
* execute in the selected isolation layer  
* log the full decision and result  
* return normalized results to the caller

The real thesis is:

**Execution is a governed service, not a helper function.**

---

## **4\. V+E purpose**

This masterplan is meant to do four things:

1. make sandboxing **real**  
2. make execution **uniform**  
3. make violations **observable**  
4. make the product **honest** when it claims production-grade isolation

---

## **5\. In-scope outcomes**

This machine must deliver all of the following.

### **Mandatory execution interception**

Every meaningful execution path routes through DanteSandbox.

### **Real isolation modes**

Support:

* Docker isolation as primary  
* worktree isolation as fallback  
* host execution only under explicit, governed escape policy

### **DanteForge gating**

Every execution request gets:

* pre-execution policy/gate decision  
* post-execution evaluation where relevant

### **Complete execution audit trail**

Every request records:

* requester  
* command  
* strategy  
* decision  
* outcome  
* violation state  
* checkpoint linkage

### **Broad platform integration**

Must integrate with:

* CLI agent loop  
* tools layer  
* multi-agent/subagents  
* background-agent  
* MCP-triggered execution  
* VS Code toggle/status UI  
* Gaslight iteration execution  
* research execution paths  
* future event automation flows

---

## **6\. Out of scope for MVP**

These do **not** belong in the first enforcement release:

* Kubernetes executor fleets  
* remote sandbox infrastructure  
* distributed remote runners  
* cloud control planes  
* browser farm orchestration  
* enterprise policy engines  
* advanced network sandboxing matrices beyond what local Docker can reasonably support

This is a **local-first real enforcement** release.

---

## **7\. Canonical architecture**

DanteSandbox should be built as a machine with seven organs.

## **7.1 Organ A — Sandbox Engine**

This is the central decision brain.

Responsibilities:

* receive normalized execution requests  
* determine requested and allowed mode  
* choose Docker vs worktree vs host  
* apply policy  
* request DanteForge gate decision  
* coordinate execution lifecycle  
* emit audit events

This is the single source of execution truth.

## **7.2 Organ B — Execution Proxy**

This is the interception layer.

Responsibilities:

* replace direct `execSync` / `spawn` / `child_process` style execution paths  
* normalize all execution requests  
* ensure all callers use the same path  
* prevent silent bypass

This is the most important enforcement component.  
 If this organ is weak, the whole machine fails.

## **7.3 Organ C — Docker Isolation Layer**

This is the primary isolation backend.

Responsibilities:

* run commands in containerized environment  
* mount only approved paths  
* shape environment variables  
* apply timeout/resource controls  
* return normalized result

Default strategy should be Docker where available.

## **7.4 Organ D — Worktree Isolation Layer**

This is the Git-native fallback.

Responsibilities:

* isolate file mutations to controlled worktrees  
* support lower-overhead execution for trusted tasks  
* preserve repo-level separation  
* reduce cross-contamination risk

This is a performance and compatibility fallback, not the default truth layer.

## **7.5 Organ E — Host Escape Layer**

This is the explicit unsafe-but-governed path.

Responsibilities:

* require explicit opt-in  
* show loud warnings  
* require stronger gate or override policy  
* emit high-severity audit records  
* remain available for emergency compatibility only

Host mode must exist, but it must feel exceptional, not normal.

## **7.6 Organ F — DanteForge Gate**

This is the safety and trust layer.

Responsibilities:

* pre-execution allow / warn / block  
* dangerous command evaluation  
* threshold-based safety scoring  
* optional post-execution scoring  
* policy alignment with the wider Verification Spine

Hard rule:

**No meaningful execution occurs without a sandbox decision and a DanteForge gate outcome.**

## **7.7 Organ G — Sandbox Audit Trail**

This is the accountability layer.

Responsibilities:

* record every execution request  
* record strategy chosen  
* record gate results  
* record violations  
* record host escapes  
* record outcome metadata  
* link into checkpoints and persistent debug memory

---

## **8\. Architectural principles**

These are non-negotiable.

### **Principle 1 — Centralization**

There must be exactly one authoritative execution path.

### **Principle 2 — Fail closed**

If strategy selection or gate decision fails, execution should block unless a governed override path exists.

### **Principle 3 — Docker first**

When capability exists and policy permits, Docker is default.

### **Principle 4 — No silent host execution**

Host execution must never happen accidentally.

### **Principle 5 — Audit everything**

Every meaningful execution decision must be durable and queryable.

### **Principle 6 — Surface truth**

`/sandbox status` must report actual enforcement state, not in-memory intent.

### **Principle 7 — Backward compatibility without dishonesty**

Older toggles may remain, but they must control real behavior.

---

## **9\. Canonical package plan**

Recommended package structure:

packages/dante-sandbox/  
 src/  
   types.ts  
   sandbox-engine.ts  
   execution-proxy.ts  
   docker-isolation.ts  
   worktree-isolation.ts  
   host-escape.ts  
   policy-engine.ts  
   audit-log.ts  
   capability-check.ts  
   integration.ts  
   index.ts  
 test/  
   golden-flows.test.ts  
   proxy.test.ts  
   policy.test.ts  
   isolation.test.ts

### **Why this is better than the minimal draft**

The original packet was slightly too thin.  
 You need explicit modules for:

* policy  
* capability detection  
* audit logging  
* host escape  
* integration

Otherwise those concerns get buried in one oversized engine file.

---

## **10\. Runtime spine extensions**

Extend `packages/runtime-spine/src/` with:

### **`sandbox-types.ts`**

Should define at least:

* `SandboxMode`  
* `IsolationStrategy`  
* `ExecutionRequest`  
* `ExecutionResult`  
* `SandboxDecision`  
* `SandboxViolation`  
* `SandboxAuditRecord`

### **`runtime-events.ts`**

Add:

* `sandbox.execution.requested`  
* `sandbox.execution.allowed`  
* `sandbox.execution.blocked`  
* `sandbox.execution.completed`  
* `sandbox.danteforge.gate.passed`  
* `sandbox.danteforge.gate.failed`  
* `sandbox.violation`

### **`checkpoint-types.ts`**

Add:

* sandbox audit trail linkage  
* last strategy used  
* active sandbox mode  
* violation history  
* host escape history

---

## **11\. Primary integration touchpoints**

These are the critical code surfaces that must be rewired.

### **CLI / direct task execution**

* `packages/cli/src/agent-loop.ts`  
* `packages/cli/src/tools.ts`

### **Core orchestration**

* `packages/core/src/multi-agent.ts`

### **Background execution**

* `packages/background-agent/src/runner.ts`

### **Tooling surfaces**

* MCP tool registry  
* VS Code extension toggle/status surface

### **Strongly recommended additional integration**

* DTR / tool runtime  
* Persistent Debug Memory  
* Verification Spine  
* Gaslight refinement loop  
* Research execution surfaces

Because if those remain unsandboxed, the platform still has truth gaps.

---

## **12\. Public API surface**

### **Core runtime API**

* `sandbox.execute(command, options)`  
   Always governed, never raw.

### **Control APIs**

* `DanteSandbox.enforce()`  
* `DanteSandbox.status()`  
* `DanteSandbox.setMode(mode)`

### **User-facing control surface**

* `/sandbox status`  
* `/sandbox force-docker`  
* `/sandbox force-worktree`  
* `/sandbox force-host`

### **Important behavioral rule**

`/sandbox force-host` must:

* display a strong warning  
* create an audit record  
* require explicit confirmation or policy allowance

---

## **13\. Execution model**

Every execution follows this deterministic path:

### **Step 1 — Intercept**

Execution proxy receives request.

### **Step 2 — Normalize**

Convert raw input into canonical `ExecutionRequest`:

* command  
* args  
* cwd  
* env  
* task type  
* actor  
* requested mode

### **Step 3 — Classify**

Determine:

* risk level  
* operation class  
* sensitivity  
* whether Docker is required/preferred  
* whether worktree fallback is acceptable  
* whether host path is even eligible

### **Step 4 — Gate**

DanteForge decides:

* allow  
* warn  
* block  
* require override

### **Step 5 — Isolate**

If allowed:

* Docker first  
* worktree fallback if appropriate  
* host only under explicit governed exception

### **Step 6 — Audit**

Record:

* request  
* decision  
* strategy  
* result  
* warnings  
* violations  
* overrides

### **Step 7 — Return**

Return normalized `ExecutionResult`, not raw process state.

---

## **14\. Configuration model**

DanteSandbox should support clear runtime policy.

### **Modes**

* `off` — legacy compatibility only, strongly discouraged  
* `docker`  
* `worktree`  
* `auto`  
* `host-escape`

### **Recommended default**

* `auto` with Docker preferred, worktree fallback

### **Policy settings**

* default isolation mode  
* allow host escape yes/no  
* manual override requirement  
* dangerous command thresholds  
* trusted task classes  
* lite mode toggle for low-risk operations

---

## **15\. Migration strategy**

This is where the original packet needed more expansion.

You cannot just “replace all execSync” and hope it works.  
 You need a staged migration plan.

## **Phase A — Discovery**

* enumerate every direct execution path  
* classify each one:  
  * replace immediately  
  * wrap temporarily  
  * exempt temporarily with audit

## **Phase B — Proxy insertion**

* create proxy  
* route known paths through proxy  
* preserve behavior parity as much as possible

## **Phase C — Enforcement hardening**

* block new direct raw execution in CI/static checks  
* remove temporary wrappers  
* fail builds on unauthorized direct process calls

## **Phase D — Truth hardening**

* wire UI/status to real engine state  
* add audit/replay visibility  
* verify no remaining silent bypasses

---

## **16\. Phased roadmap**

## **Phase 1 — Contracts and engine**

Deliver:

* runtime-spine sandbox contracts  
* sandbox engine  
* capability checks  
* policy engine skeleton

Goal:

* decisions become real and typed

## **Phase 2 — Isolation implementations**

Deliver:

* Docker isolation  
* worktree isolation  
* host escape path  
* execution proxy

Goal:

* actual execution can be routed safely

## **Phase 3 — DanteForge gate \+ full enforcement weld**

Deliver:

* mandatory gate  
* full integration into agent-loop, tools, multi-agent, background-agent, MCP, VS Code  
* removal of direct raw execution paths

Goal:

* no meaningful bypass remains

## **Phase 4 — Audit, tests, and production hardening**

Deliver:

* audit logging  
* checkpoint linkage  
* golden-flow tests  
* performance tuning  
* migration guide  
* CI enforcement against new direct exec paths

Goal:

* sandbox becomes enforceable and claimable

---

## **17\. Golden flows**

### **GF-01 — Basic command**

A safe command executes through Docker and returns normalized results.

### **GF-02 — Dangerous command**

A dangerous command is blocked by DanteForge with a clear violation record.

### **GF-03 — Subagent isolation**

Child execution uses isolated Docker/worktree context and does not contaminate parent state.

### **GF-04 — Gaslight integration**

Every critique/refinement execution step goes through sandbox and only proceeds when both sandbox policy and DanteForge allow it.

### **GF-05 — Combined proof**

A long-horizon task with research, subagents, critique, and code changes completes with all execution routed through sandbox and no direct raw exec path remaining anywhere relevant.

---

## **18\. Hard gates**

### **Codebase gate**

Zero unauthorized direct `execSync` / raw `child_process` usage after rollout.

### **Runtime gate**

Every execution must have:

* sandbox decision  
* strategy chosen  
* gate result  
* audit record

### **Default isolation gate**

Docker default when available.

### **Audit gate**

Every session checkpoint includes sandbox audit linkage.

### **Test gate**

Proxy and engine behavior must be comprehensively covered.

### **Performance gate**

No unacceptable regression in common workflows.

### **Truth gate**

`/sandbox status` must reflect actual runtime enforcement state.

---

## **19\. Success criteria**

This machine is complete when all are true:

1. All execution paths use DanteSandbox.  
2. No direct raw execution remains except explicitly governed and audited escape cases.  
3. DanteForge gates every meaningful execution decision.  
4. Docker/worktree isolation is real and configurable.  
5. `/sandbox` status reflects actual enforcement.  
6. Audit trail is checkpoint-linked and durable.  
7. All golden flows pass.  
8. Sandbox, safety, and production maturity scores materially improve.  
9. The sandbox section in readiness documentation can be marked complete honestly.

---

## **20\. Risks and corrections**

### **Risk 1 — Docker overhead**

Correction:

* worktree fallback  
* lite mode for trusted low-risk tasks  
* capability detection  
* configurable strategy selection

### **Risk 2 — breaking workflows**

Correction:

* staged migration  
* compatibility wrapper period  
* host escape hatch  
* explicit migration guide

### **Risk 3 — DanteForge false positives**

Correction:

* tunable thresholds  
* warn/review-required modes  
* manual override with audit

### **Risk 4 — hidden bypasses remain**

Correction:

* full repository search  
* CI/static check  
* wrapper-only policy  
* explicit exemptions list

### **Risk 5 — toggle remains misleading**

Correction:

* tie UI directly to actual engine state  
* no fake in-memory-only “sandbox enabled” state

---

## **21\. Runbook**

### **Step 1**

Build runtime-spine sandbox contracts and the sandbox engine.

### **Step 2**

Implement Docker and worktree isolation layers.

### **Step 3**

Implement execution proxy and normalize all execution through it.

### **Step 4**

Add DanteForge mandatory gate.

### **Step 5**

Weld into agent-loop, tools, multi-agent, background-agent, MCP, and VS Code.

### **Step 6**

Add audit logging, benchmark harness, CI enforcement, and hardening.

---

## **22\. Done definition**

This machine is done only when:

* sandboxing is mandatory  
* enforcement is centralized  
* bypass is blocked by default  
* host escape is explicit and audited  
* UI/status reflects truth  
* evidence of isolation exists  
* readiness claims become honest

---

## **23\. Final judgment**

This is one of the most important V+E plans in the whole DanteCode stack.

The biggest correction to the original packet is:

**Do not think of this as “wire the sandbox package in.” Think of it as “replace the execution spine with a governed sandbox spine.”**

That is the version that actually fixes the architectural lie.

