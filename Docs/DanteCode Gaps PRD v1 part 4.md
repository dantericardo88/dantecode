**DanteCode Event Automation / Git Enhancement PRD v1.0**

**Objective:** Close the critical gaps identified in the live repo analysis (git-engine is strong on local worktrees/diffs/commits and basic end-to-end flows, but lacks proven live scaling, reactive event listeners, webhook handling, automated workflow pipelines, scheduled/multi-repo orchestration, and deep integration with background agents / reasoning chains / DanteForge).  
**Target scores:** Event Automation / Git **9.0+** (from my current 7.5) with major uplift to Production Maturity, Agent Reasoning / Autonomy, GitHub CLI usage, and overall reliability.

**Scope:** Transform git-engine into a reactive, durable, production-grade event automation layer that supports Git hooks, local GitHub Actions, webhooks, auto-PR/versioning workflows, and concurrent multi-agent scaling — fully MCP-compatible, DanteForge-verifiable, and Git-native.

### **Top 4-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

Selected after direct 2026 ecosystem review (MIT/Apache-friendly, agent-proven, strong Git focus).

1. **Aider (aider-chat/aider)**  
   * Why harvest: The most battle-tested autonomous Git commit → test → branch → PR loops in real coding agents.  
   * Harvest targets: End-to-end Git workflow orchestration, safe auto-commit logic, branch/PR management patterns, integration with long-running agent reasoning.  
   * GitHub: [https://github.com/aider-chat/aider](https://github.com/aider-chat/aider)  
   * Direct win: Immediate live scaling proof for autonomous Git cycles.  
2. **nektos/act (nektos/act)**  
   * Why harvest: The leading local GitHub Actions runner — perfect for simulating, testing, and scaling event-driven workflows without ever pushing.  
   * Harvest targets: Local workflow execution engine, event trigger simulation, Docker-based parallel runners, matrix/strategy handling.  
   * GitHub: [https://github.com/nektos/act](https://github.com/nektos/act)  
   * Direct win: Turns “no live scaling proof” into production-grade concurrent automation.  
3. **changesets (changesets/changesets)**  
   * Why harvest: Industry-standard monorepo automation for versioning, changelogs, and PR creation — used in thousands of TS repos.  
   * Harvest targets: Automated PR generation, version bumping, changeset tracking, Git integration pipelines.  
   * GitHub: [https://github.com/changesets/changesets](https://github.com/changesets/changesets)  
   * Direct win: Professional automated PR/versioning workflows that feel native.  
4. **octokit/webhooks.js (octokit/webhooks.js)**  
   * Why harvest: Official TypeScript-first library for secure, scalable GitHub (and GitLab) webhook event handling.  
   * Harvest targets: Event listener setup, signature verification, payload parsing, scalable server patterns, error/retry handling.  
   * GitHub: [https://github.com/octokit/webhooks.js](https://github.com/octokit/webhooks.js)  
   * Direct win: Real webhook support and event-driven GitHub automation.  
5. **OpenHands (All-Hands-AI/OpenHands)**  
   * Why harvest: Proven long-horizon Git event monitoring and reactive repository automation in production agents.  
   * Harvest targets: File-watch \+ Git change triggers, background sync patterns, persistent event state management.  
   * GitHub: [https://github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)  
   * Direct win: Ties events directly into our multi-agent and recovery systems.

### **Functional Requirements (MVP \+ Phased)**

**Core MCP Tools / Slash Commands:**

* git\_watch(eventType, path?, options?) → reactive listener  
* run\_github\_workflow(workflowPath, eventPayload?) → local act-style execution  
* auto\_pr\_create(title, body?, changesets?)  
* webhook\_listen(provider, secret?) → secure event handler  
* schedule\_git\_task(cron, task)

**Must-Have Features**

* Git hooks \+ file-system watchers (post-commit, pre-push, file changes)  
* Local GitHub Actions execution (harvested from act) for full workflow simulation  
* Automated PR/versioning/changelog pipelines (changesets patterns)  
* Secure webhook listener with payload routing  
* Multi-repo and multi-worktree concurrent scaling  
* Background persistent execution (extend background-agent.ts)  
* DanteForge verification gates \+ PDSE scoring on every automated Git write  
* Full checkpoint/recovery integration for long-running workflows

**Advanced (Phase 2+)**

* Full GitHub App-style event handling  
* Agentic cross-repo dependency automation  
* Event dashboard in VS Code preview  
* Rollback \+ audit trails for automated actions

### **Non-Functional Requirements**

* Scalability: 10+ concurrent Git workflows without degradation  
* Latency: Near real-time triggering (\<500ms for local events)  
* Reliability: 100% recovery on crash/interrupt via checkpointer  
* Safety: Strict read/write separation \+ DanteForge gates \+ user confirmation option  
* Model-agnostic: Full use of model-router for any decision logic  
* Privacy: Local-first, no external services required

### **Implementation Recommendations (DanteCode-Specific)**

* Extend existing packages/git-engine with new event-orchestrator submodule  
* Core new files: git-event-watcher.ts, local-workflow-runner.ts (act patterns), webhook-handler.ts, auto-pr-engine.ts, changeset-manager.ts  
* Heavy reuse: git-engine (worktrees/branches), danteforge (gates \+ PDSE), checkpointer.ts \+ recovery-engine.ts (persistence), background-agent.ts, model-router.ts, subagent spawning  
* MCP \+ slash-command support out of the box  
* Make act and changesets optional (lightweight defaults)

### **Phased Roadmap**

**Phase 1 (1 week):** Aider-style autonomous Git flows \+ basic watchers \+ local act runner (quick jump to 8.0–8.5)  
**Phase 2 (1–2 weeks):** changesets-style auto-PR/versioning \+ octokit webhook support  
**Phase 3 (1–2 weeks):** Multi-agent scaling \+ OpenHands long-horizon patterns \+ full DanteForge integration

**Phase 4 (1 week):** Polish, live scaling benchmarks, VS Code event monitor, production hardening

### **Success Metrics & Verification**

* Live scaling proof: Successfully run 8+ concurrent automated Git workflows without failure  
* DanteForge pass rate on all Git write operations \>96%  
* Local workflow execution parity with real GitHub Actions  
* Measurable reduction in manual Git/PR operations during agent sessions  
* SWE-bench or custom multi-repo automation suite uplift

### **Risks & Mitigations**

* Event overload → Built-in queuing \+ rate limiting \+ checkpointer pruning  
* Git conflicts → Worktree isolation \+ smart merge strategies (reuse git-engine)  
* Security → Signature verification (octokit patterns) \+ DanteForge gates  
* Complexity → Start with Aider \+ act lightweight patterns, then layer webhooks

This PRD is ready to copy-paste directly into DanteCode’s planner/orchestrator/wave mode. It gives concrete GitHub targets, exact harvest points, and seamless integration with every previous enhancement (git-engine, GitHub CLI, subagents, reasoning chains, autonomy engine, DanteForge, checkpointer, background agents).

Once shipped, Event Automation / Git becomes a true production superpower — reactive, scalable, and unbreakable. Let me know if you want API type signatures, a starter TS stub for git-event-watcher.ts, or the next PRD (e.g., Production Maturity, Developer UX / Polish, or Session / Memory)\!

# **V+E Masterplan**

## **DanteCode Event Automation / Git Enhancement**

### **Reactive, Durable, Git-Native Workflow Automation Spine**

## **1\. Executive judgment**

This should be built as a **first-class event automation machine**, not as a few extra helpers inside `git-engine`.

The PRD’s core diagnosis is right: DanteCode already has strong local Git primitives—worktrees, diffs, commits, and basic flows—but it still lacks:

* reactive listeners,  
* webhook handling,  
* local workflow execution,  
* automated PR/version pipelines,  
* scheduled tasks,  
* multi-repo scaling,  
* and deep integration with background agents, reasoning chains, and DanteForge verification.

The correct V+E framing is:

**Git should stop being just a storage layer and become DanteCode’s reactive execution bus.**

That means this machine must sit between:

* filesystem events,  
* git hooks,  
* local CI/workflow execution,  
* agent routing,  
* verification,  
* and final push/PR actions.

## **2\. Product thesis**

DanteCode needs a **production-grade event automation layer** that can:

* watch local repo events in near real time,  
* react to file changes, commits, pushes, and workflow triggers,  
* run GitHub Actions locally,  
* generate version/changeset/PR flows,  
* listen securely to webhooks,  
* queue and scale multiple workflows across worktrees/repos,  
* persist long-running runs,  
* and gate all automated writes through DanteForge verification.

The product thesis is:

**Every important Git or repo event should be able to trigger a durable, verified, automatable workflow inside DanteCode.**

## **3\. Purpose and problem statement**

Today, DanteCode can do Git operations well enough for interactive work, but it does not yet fully support:

* reactive automation,  
* local CI simulation,  
* webhook-driven flows,  
* autonomous Git/PR loops,  
* or resilient multi-worktree scaling.

That creates four practical gaps:

### **A. Reactivity gap**

No strong event listener spine for Git hooks, file changes, and scheduled workflows.

### **B. Workflow gap**

No strong local equivalent of GitHub Actions-driven automation at scale.

### **C. Promotion gap**

Versioning, PR creation, changelog, and release-oriented flows are not yet first-class.

### **D. Durability gap**

Long-running Git automations are not yet deeply welded into background execution, checkpoints, recovery, and verification.

## **4\. Scope**

## **In scope**

This machine must deliver the PRD’s core tools and surfaces:

* `gitWatch(eventType, path?, options?)`  
* `runGithubWorkflow(workflowPath, eventPayload?)`  
* `autoPrCreate(title, body?, changesets?)`  
* `webhookListen(provider, secret?)`  
* `scheduleGitTask(cron, task)`

It also must deliver:

* Git hooks \+ file watchers  
* local workflow execution  
* auto PR/version/changelog pipelines  
* secure webhook handling  
* multi-repo / multi-worktree scaling  
* background persistence  
* DanteForge verification \+ PDSE on automated writes  
* checkpoint \+ recovery integration.

## **Advanced scope**

Later phases can add:

* GitHub App-style event handling  
* cross-repo dependency automation  
* event dashboard / preview  
* rollback \+ deeper audit trails.

## **Out of scope for MVP**

Do not start with:

* full GitHub App infrastructure,  
* enterprise webhook fleets,  
* cross-org automation,  
* or broad UI/dashboard work before the core event engine is stable.

## **5\. Architecture**

This should be built as a **reactive Git Event Automation Spine** with six organs.

## **5.1 Organ A — Event Watcher Layer**

Owns:

* Git hook triggers  
* filesystem watchers  
* local repo event classification  
* event normalization

This is the local reactivity layer.

## **5.2 Organ B — Workflow Runner**

Owns:

* local workflow execution  
* event payload simulation  
* job orchestration  
* concurrency  
* container-backed or local runner delegation

`act` is the right reference here because it reads `.github/workflows/`, resolves jobs, and runs them locally with Docker-backed runners.

## **5.3 Organ C — Promotion Engine**

Owns:

* changeset tracking  
* version bumping  
* changelog generation  
* PR generation  
* auto-commit / branch promotion logic

Changesets is a strong fit here because it is built around versioning and changelogs for multi-package repositories. Aider is also relevant because it already treats Git as part of the coding loop and can auto-commit edits with descriptive messages.

## **5.4 Organ D — Webhook Engine**

Owns:

* webhook listener setup  
* signature verification  
* payload parsing  
* provider routing  
* retry/error handling

`@octokit/webhooks` is the right reference because it is the official TypeScript-oriented library for handling GitHub webhook events, and GitHub’s own docs emphasize subscribing only to the specific events you intend to handle.

## **5.5 Organ E — Event Queue \+ Background Persistence**

Owns:

* event queuing  
* rate limiting  
* backpressure  
* crash recovery  
* scheduled tasks  
* resumable long-running runs

This should weld directly into:

* `background-agent.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`

## **5.6 Organ F — Verification \+ Safety Gate**

Owns:

* DanteForge gates on every automated Git write  
* PDSE scoring  
* confirmation rules  
* write protection / review-required state  
* audit traces

This is what prevents automation from becoming destructive.

## **6\. Canonical package plan**

The PRD suggests extending `packages/git-engine` with an event-orchestrator submodule. That is the right direction.

Recommended structure:

packages/git-engine/  
 src/  
   event-orchestrator/  
     types.ts  
     git-event-watcher.ts  
     event-queue.ts  
     local-workflow-runner.ts  
     webhook-handler.ts  
     auto-pr-engine.ts  
     changeset-manager.ts  
     scheduler.ts  
     workflow-state-store.ts  
     audit-log.ts  
     rate-limiter.ts  
     multi-repo-coordinator.ts  
     index.ts

Then integrate with:

* `background-agent.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* subagent spawning  
* DanteForge verification bridge  
* MCP tool registration  
* slash-command registration

## **7\. Organ-to-OSS harvest map**

The PRD’s harvest list is strong. It should be preserved, but used as **pattern harvest**, not dependency sprawl.

### **Aider**

Harvest:

* autonomous Git loop patterns  
* safe auto-commit behavior  
* branch/commit lifecycle habits  
* long-running agent \+ Git interaction models

Aider explicitly documents that it uses Git as a core part of its workflow and auto-commits edits with descriptive messages.

### **nektos/act**

Harvest:

* local workflow execution  
* event simulation  
* Docker-based runner model  
* parallel workflow handling

`act` is explicitly built to run GitHub Actions locally from `.github/workflows/` using Docker-backed runners.

### **changesets**

Harvest:

* version bumping  
* changelog generation  
* release/PR pipeline ideas  
* monorepo-friendly promotion flows

Changesets is explicitly positioned around versioning and changelogs, especially for multi-package repos.

### **@octokit/webhooks**

Harvest:

* secure webhook verification  
* payload typing  
* event routing  
* retry/error surface patterns

The package is designed specifically to handle GitHub webhook events, and GitHub’s docs reinforce the importance of subscribing only to the events you will actually process.

### **OpenHands**

Harvest:

* long-horizon repository automation patterns  
* background repo-event handling  
* GitHub-oriented issue/resolver workflow patterns  
* persistence and event continuity

OpenHands is an open platform for coding agents and also has GitHub-resolver-style automation patterns that are relevant to long-running repo workflows.

## **8\. Public API surface**

Keep the PRD’s core commands, but make the TypeScript contracts explicit.

export interface GitWatchOptions {  
 recursive?: boolean;  
 debounceMs?: number;  
 includeHooks?: boolean;  
 includeFsEvents?: boolean;  
}

export interface WorkflowRunResult {  
 workflowPath: string;  
 eventType: string;  
 passed: boolean;  
 jobs: Array\<Record\<string, unknown\>\>;  
 logsPath?: string;  
}

export interface AutoPrResult {  
 branchName: string;  
 title: string;  
 created: boolean;  
 changesetsApplied?: string\[\];  
 changelogUpdated?: boolean;  
}

export interface WebhookListenResult {  
 provider: "github" | "gitlab";  
 listening: boolean;  
 endpoint?: string;  
 secretConfigured: boolean;  
}

export interface ScheduledGitTaskResult {  
 taskId: string;  
 cron: string;  
 enabled: boolean;  
}

Core surface:

* `gitWatch(eventType, path?, options?)`  
* `runGithubWorkflow(workflowPath, eventPayload?)`  
* `autoPrCreate(title, body?, changesets?)`  
* `webhookListen(provider, secret?)`  
* `scheduleGitTask(cron, task)`

## **9\. Execution model**

The runtime should follow a deterministic event pipeline:

### **Step 1 — Event capture**

Capture from:

* Git hooks  
* fs watchers  
* scheduled trigger  
* webhook payload

### **Step 2 — Event normalization**

Convert event into canonical event packet:

* repo  
* branch/worktree  
* event type  
* payload  
* priority  
* automation policy

### **Step 3 — Queue \+ route**

Queue event and decide:

* immediate  
* background  
* scheduled  
* throttled  
* dropped as duplicate/noise

### **Step 4 — Workflow execution**

Run:

* local workflow  
* promotion flow  
* PR/version flow  
* verification flow  
* delegated subagent flow if needed

### **Step 5 — Verification gate**

Before any Git write promotion:

* DanteForge gate  
* PDSE  
* optional user confirmation  
* audit record

### **Step 6 — Outcome handling**

* commit  
* branch  
* PR  
* changelog/version bump  
* retry  
* rollback  
* review-required  
* block

## **10\. Phased roadmap**

The PRD’s roadmap is good. Keep it, but sharpen the phase intent.

## **Phase 1 — Reactive local automation**

Deliver:

* basic watchers  
* hook support  
* Aider-style autonomous Git loops  
* local workflow runner MVP

Goal:

* move quickly from static Git operations toward reactive automation

## **Phase 2 — Promotion and webhooks**

Deliver:

* changeset-style versioning/changelog  
* auto PR engine  
* secure webhook support

Goal:

* professional promotion flows and external event handling

## **Phase 3 — Scaling \+ persistence**

Deliver:

* multi-worktree / multi-repo scaling  
* background persistence  
* OpenHands-style long-horizon patterns  
* full DanteForge integration

Goal:

* durable automation under load

## **Phase 4 — Polish and proof**

Deliver:

* live scaling benchmarks  
* event monitor / preview  
* production hardening  
* rollback/audit improvements

Goal:

* prove this works beyond toy flows

## **11\. Non-functional requirements / SLOs**

The PRD’s NFRs should become hard gates.

### **Hard SLOs**

* near-real-time local event trigger under 500ms  
* 10+ concurrent Git workflows without material degradation  
* 100% resumability after crash/interrupt for queued/running workflows  
* local-first operation  
* strict read/write separation  
* model-agnostic decision layer through `model-router.ts`

### **Additional V+E gates**

* no automated Git write without verification record  
* no webhook accepted without signature verification when secret is configured  
* no queue starvation under repeated event bursts  
* no silent event drops without audit record

## **12\. Verification and benchmark model**

The PRD’s success metrics are strong and should become the benchmark charter.

### **A. Live scaling proof**

Run 8+ concurrent automated Git workflows and prove:

* no deadlocks  
* no dropped state  
* no corrupted worktree coordination

### **B. Workflow parity**

Measure local workflow runner behavior against real GitHub Actions expectations for representative workflows.

### **C. Promotion efficiency**

Track reduction in manual:

* PR creation  
* version bumping  
* changelog generation  
* workflow testing

### **D. Git write safety**

Track DanteForge pass rate on all automated Git writes.

## **13\. Test charter**

## **Unit tests**

* event normalization  
* queue ordering  
* debounce/rate limiting  
* workflow packet construction  
* changeset state handling  
* PR engine dry-run behavior  
* webhook signature verification  
* cron/scheduler parsing

## **Integration tests**

* local file change → event → workflow run  
* post-commit hook → verification → follow-up task  
* local workflow runner on representative workflow files  
* webhook payload → routing → task execution  
* auto PR/version/changelog flow  
* recovery after interrupted workflow run  
* multi-worktree concurrent execution

## **Golden flows**

### **GF-01**

A file change triggers a local watcher, queues a task, and runs the intended local workflow.

### **GF-02**

A commit or pre-push hook triggers a verification-first automation pass before allowing promotion.

### **GF-03**

A local GitHub Actions workflow runs through the local runner and returns structured job results.

### **GF-04**

A changeset/version/changelog flow generates a promotion-ready PR payload.

### **GF-05**

A webhook event is received, signature-verified, routed, and executed safely.

### **GF-06**

Eight concurrent automated Git workflows run without failure, with resumable state after interruption.

## **14\. Risks and corrections**

The PRD’s risks are correct; these are the V+E corrections.

### **Risk 1 — event overload**

Correction:

* central queue  
* per-repo throttling  
* dedupe  
* checkpoint pruning  
* explicit backpressure

### **Risk 2 — Git conflicts from automation**

Correction:

* worktree isolation first  
* branch-per-workflow where appropriate  
* merge strategy hooks  
* verification before promotion

### **Risk 3 — security**

Correction:

* signed webhook verification  
* strict write gates  
* allow/warn/block policies  
* audited override paths

### **Risk 4 — complexity**

Correction:

* build watchers \+ local runner first  
* then PR/version/webhooks  
* then scaling and dashboards

## **15\. Runbook**

### **Step 1**

Build event watcher, event queue, and workflow state store first.

### **Step 2**

Add local workflow runner and hook integration.

### **Step 3**

Add verification-gated auto-commit / promotion logic.

### **Step 4**

Add changeset manager and auto PR engine.

### **Step 5**

Add webhook handler and scheduled tasks.

### **Step 6**

Add multi-repo scaling, benchmark harness, and polish.

## **16\. Done definition**

This machine is complete only when all are true:

1. DanteCode can react to Git hooks and file events.  
2. Local workflow execution works reliably.  
3. Auto PR/version/changelog flows work.  
4. Webhooks can be received and securely handled.  
5. Background persistence and recovery are real, not aspirational.  
6. Multi-worktree and multi-repo scaling work under benchmark load.  
7. Every automated Git write is verified through DanteForge gates.  
8. Event automation becomes a reusable backbone for Council, subagents, and broader autonomy.

## **17\. Final judgment**

This is a strong PRD.

The most important V+E correction is:

**Build Event Automation / Git as DanteCode’s reactive Git-native workflow spine, not as a handful of Git helpers.**

That is what makes the repo actually “live” for autonomous workflows instead of just scriptable.

The strongest next move is to turn this directly into a **Codex-ready V+E Execution Packet**.

Please create the Codex-ready V+E Execution Packet.

I’m turning the Git/event PRD into the same execution-packet format as the others and checking the current external Git/workflow tools it depends on so the packet is grounded to the actual 2026 surfaces.

Thought for 1m 7s

Below is the **Codex-ready V+E Execution Packet** for **DanteCode Event Automation / Git Enhancement**.

The build should be anchored to the same core external patterns the PRD was aiming at:

* **`act`** reads workflows from `.github/workflows/` and runs them locally via Docker, which makes it the right reference for local workflow execution.  
* **Changesets** is built for versioning and changelogs with a focus on multi-package repositories, which makes it the right reference for release/promotion flows.  
* **`@octokit/webhooks`** is designed to handle GitHub webhook events, which makes it the right reference for secure webhook ingestion and routing.  
* **Aider** treats Git as part of the coding loop and supports auto-commits/commit flows, which makes it the right reference for autonomous Git-cycle behavior.

# **Codex-ready V+E Execution Packet**

## **EA-01 — DanteCode Event Automation / Git Enhancement**

## **0\. Executive call**

Build this as a **reactive Git-native automation spine**, not as a few more helpers inside `git-engine`.

The target product is:

* watchers for repo and filesystem events,  
* local workflow execution,  
* queued background automation,  
* verified Git writes,  
* version/changelog/PR automation,  
* webhook-driven flows,  
* scheduled Git tasks,  
* and multi-worktree/multi-repo durability.

This machine should become the event bus for:

* Council Orchestrator,  
* Verification Spine,  
* DTR,  
* SkillBridge promotion flows,  
* and future repo automation.

---

# **1\. Objective**

Implement the PRD’s intended uplift by shipping:

* `gitWatch(eventType, path?, options?)`  
* `runGithubWorkflow(workflowPath, eventPayload?)`  
* `autoPrCreate(title, body?, changesets?)`  
* `webhookListen(provider, secret?)`  
* `scheduleGitTask(cron, task)`

with:

* Git hooks \+ fs watcher support  
* local workflow execution  
* auto-PR/version/changelog flows  
* secure webhook routing  
* multi-worktree and multi-repo coordination  
* background persistence  
* DanteForge verification \+ PDSE on every automated write  
* checkpoint \+ recovery support

## **1.1 Non-goals for MVP**

Do not start with:

* full GitHub App infrastructure  
* large UI/dashboard work  
* cross-org automation  
* enterprise webhook fleets  
* rollback orchestration before the basic event spine is stable

---

# **2\. Repo boundary and ownership**

## **2.1 Primary package**

Extend:

packages/git-engine/src/event-orchestrator/  
 types.ts  
 git-event-watcher.ts  
 event-normalizer.ts  
 event-queue.ts  
 local-workflow-runner.ts  
 webhook-handler.ts  
 auto-pr-engine.ts  
 changeset-manager.ts  
 scheduler.ts  
 workflow-state-store.ts  
 audit-log.ts  
 rate-limiter.ts  
 multi-repo-coordinator.ts  
 index.ts

## **2.2 Existing files to integrate with**

* `background-agent.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`  
* `model-router.ts`  
* subagent spawning/orchestrator surfaces  
* DanteForge verification bridge  
* MCP tool registration  
* slash-command registration  
* existing `packages/git-engine/src/worktree.ts`

## **2.3 Hard rule**

`event-orchestrator/` becomes the source of truth for event-driven Git automation.

Do not distribute event logic across random Git helpers and call it architecture.

---

# **3\. Canonical architecture**

## **3.1 Event Watcher Layer**

Owns:

* fs watchers  
* Git hook events  
* local repo event capture  
* debounce and dedupe

## **3.2 Event Normalizer**

Converts raw signals into canonical packets:

* repo root  
* branch/worktree  
* event type  
* path set  
* payload  
* priority  
* automation policy

## **3.3 Event Queue**

Owns:

* ordering  
* background execution  
* retries  
* dedupe  
* backpressure  
* rate limiting

## **3.4 Workflow Runner**

Owns:

* local workflow execution  
* event payload simulation  
* structured job results  
* workflow logs  
* Docker/local runner abstraction

`act` is the direct reference pattern here because it reads workflows locally and executes them with Docker-backed runners.

## **3.5 Promotion Engine**

Owns:

* changeset tracking  
* version bumping  
* changelog generation  
* branch \+ PR creation  
* promotion-ready state

Changesets is the direct reference for version/changelog promotion flow.

## **3.6 Webhook Engine**

Owns:

* listener setup  
* signature verification  
* provider routing  
* payload parsing  
* secure event handling

`@octokit/webhooks` is the direct reference for this surface.

## **3.7 Verification Gate**

Every automated Git write must flow through:

* DanteForge verification  
* PDSE  
* allow / warn / block policy  
* audited override

## **3.8 Durability Spine**

Everything long-running must be checkpointed and resumable through:

* `background-agent.ts`  
* `checkpointer.ts`  
* `recovery-engine.ts`

---

# **4\. Public API contracts**

Create `packages/git-engine/src/event-orchestrator/types.ts` with at least:

export interface GitWatchOptions {  
 recursive?: boolean;  
 debounceMs?: number;  
 includeHooks?: boolean;  
 includeFsEvents?: boolean;  
}

export interface WorkflowRunResult {  
 workflowPath: string;  
 eventType: string;  
 passed: boolean;  
 jobs: Array\<Record\<string, unknown\>\>;  
 logsPath?: string;  
}

export interface AutoPrResult {  
 branchName: string;  
 title: string;  
 created: boolean;  
 changesetsApplied?: string\[\];  
 changelogUpdated?: boolean;  
}

export interface WebhookListenResult {  
 provider: "github" | "gitlab";  
 listening: boolean;  
 endpoint?: string;  
 secretConfigured: boolean;  
}

export interface ScheduledGitTaskResult {  
 taskId: string;  
 cron: string;  
 enabled: boolean;  
}

Required exported functions:

* `gitWatch(eventType, path?, options?)`  
* `runGithubWorkflow(workflowPath, eventPayload?)`  
* `autoPrCreate(title, body?, changesets?)`  
* `webhookListen(provider, secret?)`  
* `scheduleGitTask(cron, task)`

---

# **5\. State and event model**

## **5.1 Canonical event packet**

Create a normalized internal packet:

export interface GitAutomationEvent {  
 id: string;  
 repoRoot: string;  
 worktreeId?: string;  
 branch?: string;  
 eventType:  
   | "fs-change"  
   | "post-commit"  
   | "pre-push"  
   | "workflow-run"  
   | "webhook"  
   | "scheduled-task";  
 paths?: string\[\];  
 payload?: Record\<string, unknown\>;  
 priority: "low" | "normal" | "high";  
 createdAt: string;  
}

## **5.2 Workflow run state**

Every automation run must persist:

* run id  
* triggering event  
* workflow/action type  
* phase  
* verification status  
* write status  
* logs path  
* retry count  
* resumable checkpoint pointer

## **5.3 Audit log**

Every automation action must emit audit records:

* event received  
* normalized  
* queued  
* started  
* verification passed/failed  
* write allowed/blocked  
* PR created / changelog updated / workflow completed

---

# **6\. Generation plan**

## **EA-G1 — Contracts spine**

Files:

* `packages/git-engine/src/event-orchestrator/types.ts`  
* `packages/git-engine/src/event-orchestrator/index.ts`  
* tests

Acceptance:

* all public types compile  
* event packet and run-state shape stable  
* no runtime behavior yet

---

## **EA-G2 — Workflow state store \+ audit log**

Files:

* `packages/git-engine/src/event-orchestrator/workflow-state-store.ts`  
* `packages/git-engine/src/event-orchestrator/audit-log.ts`  
* tests

Acceptance:

* state can be persisted and reloaded  
* audit events serialized consistently  
* no in-memory-only critical state

---

## **EA-G3 — Event normalizer**

Files:

* `packages/git-engine/src/event-orchestrator/event-normalizer.ts`  
* tests

Acceptance:

* raw fs/hook/webhook/scheduler signals normalize into one packet shape  
* duplicate/noise events can be recognized  
* priorities assigned deterministically

---

## **EA-G4 — Event queue**

Files:

* `packages/git-engine/src/event-orchestrator/event-queue.ts`  
* `packages/git-engine/src/event-orchestrator/rate-limiter.ts`  
* tests

Acceptance:

* queue ordering works  
* per-repo throttling works  
* duplicates can be collapsed  
* burst conditions do not silently drop state

---

## **EA-G5 — Git event watcher**

Files:

* `packages/git-engine/src/event-orchestrator/git-event-watcher.ts`  
* tests

Acceptance:

* file watcher support works  
* Git hook events can be captured  
* debounce behavior works  
* watcher emits normalized packets to queue

---

## **EA-G6 — Local workflow runner MVP**

Files:

* `packages/git-engine/src/event-orchestrator/local-workflow-runner.ts`  
* tests

Acceptance:

* representative local workflow files can be executed  
* event payload can be simulated  
* structured job result returned  
* logs persisted

This should borrow the local execution idea from `act`, but DanteCode should still expose its own result contract.

---

## **EA-G7 — Scheduler**

Files:

* `packages/git-engine/src/event-orchestrator/scheduler.ts`  
* tests

Acceptance:

* cron-style tasks can be scheduled  
* scheduled tasks enqueue canonical events  
* enabled/disabled state persists  
* restart-safe behavior exists

---

## **EA-G8 — Changeset manager**

Files:

* `packages/git-engine/src/event-orchestrator/changeset-manager.ts`  
* tests

Acceptance:

* changeset detection/handling works  
* version bump intent can be computed  
* changelog inputs structured  
* no write yet required

Use Changesets as the pattern reference here.

---

## **EA-G9 — Auto PR engine**

Files:

* `packages/git-engine/src/event-orchestrator/auto-pr-engine.ts`  
* tests

Acceptance:

* branch naming stable  
* PR payload generation works  
* changeset/changelog info can be included  
* dry-run mode supported  
* no silent write/promotion without gate pass

---

## **EA-G10 — Webhook handler**

Files:

* `packages/git-engine/src/event-orchestrator/webhook-handler.ts`  
* tests

Acceptance:

* provider-specific listener config works  
* signature verification supported  
* payloads normalized into event packets  
* invalid signature fails closed

This should follow the handling pattern of `@octokit/webhooks`, but DanteCode should keep provider-agnostic internal event packets.

---

## **EA-G11 — Multi-repo / multi-worktree coordinator**

Files:

* `packages/git-engine/src/event-orchestrator/multi-repo-coordinator.ts`  
* tests

Acceptance:

* events can be partitioned by repo/worktree  
* parallel workflows can run across worktrees safely  
* no cross-repo state corruption  
* coordinator reports load/backpressure

---

## **EA-G12 — Background/checkpoint/recovery weld**

Files:

* integrate with `background-agent.ts`  
* integrate with `checkpointer.ts`  
* integrate with `recovery-engine.ts`  
* tests

Acceptance:

* running workflows survive interruption  
* queued events survive restart  
* resumable workflow state works  
* audit trace remains intact after recovery

---

## **EA-G13 — Verification gate weld**

Files:

* DanteForge verification bridge files  
* tests

Acceptance:

* every automated Git write goes through verification  
* pass / warn / block semantics enforced  
* audited override supported  
* no promotion without explicit verification outcome

---

## **EA-G14 — Model-router \+ subagent weld**

Files:

* integrate with `model-router.ts`  
* integrate with subagent spawning/orchestrator  
* tests

Acceptance:

* decision-heavy automation can consult model-router  
* event workflows can delegate to subagents where needed  
* delegated flows remain checkpointed and auditable

---

## **EA-G15 — MCP / slash-command / streaming weld**

Files:

* MCP registration  
* slash-command registration  
* streaming progress hooks  
* tests

Acceptance:

* all public tools callable  
* long workflow progress visible  
* errors surfaced in structured form

---

## **EA-G16 — Benchmark harness**

Files:

* benchmark fixtures/reports  
* tests

Acceptance:

* at least 8 concurrent workflows exercised  
* local workflow parity scenarios included  
* recovery benchmark included  
* event storm test included

---

# **7\. Golden flows**

## **GF-01 — File change to workflow**

Input:

* file change in watched repo

Pass:

* watcher captures event  
* event normalized and queued  
* intended workflow/action runs  
* structured result recorded

## **GF-02 — Hook-triggered verification**

Input:

* post-commit or pre-push hook

Pass:

* event triggers verification-first automation  
* write/promotion blocked if verification fails  
* audit record preserved

## **GF-03 — Local workflow execution**

Input:

* representative `.github/workflows/*.yml`

Pass:

* local runner executes workflow  
* job results returned  
* logs captured  
* failures reported clearly

## **GF-04 — Promotion flow**

Input:

* changeset-worthy repo state

Pass:

* version/changelog intent computed  
* PR payload generated  
* branch/promotion flow prepared  
* verification gate enforced before final write/promotion

## **GF-05 — Secure webhook**

Input:

* webhook payload with secret configured

Pass:

* signature verified  
* payload normalized  
* task routed  
* invalid signature blocked

## **GF-06 — Concurrency and recovery**

Input:

* 8 concurrent Git workflows \+ interruption

Pass:

* no lost events  
* no corrupted state  
* queued/running flows resume  
* audit continuity preserved

---

# **8\. Hard gates**

## **Build gates**

* `git-engine` builds cleanly  
* no circular dependency between event-orchestrator, worktree logic, verification bridge, and recovery/checkpoint modules

## **Type gates**

* strict TS compile passes  
* normalized event contracts stable

## **Test gates**

* unit tests for every new module  
* integration tests for all golden flows  
* concurrent workflow benchmark passes

## **Safety gates**

* no automated Git write without verification result  
* no webhook accepted without signature validation when secret is configured  
* no silent event drop during burst conditions  
* no queue action without audit record  
* no review-required verification state promoted to write-ready

---

# **9\. Success criteria**

This packet is complete only when all are true:

1. DanteCode reacts to fs and Git hook events reliably.  
2. Local workflow execution works on representative workflow files.  
3. Auto PR / version / changelog flows work in dry-run and real gated modes.  
4. Webhook handling works securely.  
5. Event runs are durable and resumable.  
6. Multi-worktree / multi-repo automation can run concurrently.  
7. Every automated Git write is verification-gated.  
8. The benchmark harness proves live concurrent workflow execution.  
9. Event automation becomes reusable by Council, subagents, and future autonomy flows.

---

# **10\. Risks and corrections**

## **Risk 1 — event overload**

Correction:

* central queue  
* dedupe  
* per-repo throttling  
* checkpoint pruning  
* explicit backpressure

## **Risk 2 — Git conflicts from automation**

Correction:

* worktree isolation first  
* branch-per-workflow policy when needed  
* verification before promotion  
* integrate with merge strategy hooks later

## **Risk 3 — security exposure**

Correction:

* fail-closed webhook verification  
* audited overrides  
* strict write/promotion gates

## **Risk 4 — complexity explosion**

Correction:

* watchers \+ queue \+ local runner first  
* then promotion/webhooks  
* then scaling/recovery polish

## **Risk 5 — too much logic spreads outside the package**

Correction:

* `event-orchestrator/` remains the source of truth  
* outside integrations call into it instead of reimplementing it

---

# **11\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing EA-01: DanteCode Event Automation / Git Enhancement.

Goal:  
Build a reactive, durable, Git-native workflow automation spine for DanteCode that supports:  
\- fs/Git hook watching  
\- local workflow execution  
\- event queues and rate limiting  
\- auto PR / version / changelog flows  
\- secure webhooks  
\- scheduled Git tasks  
\- multi-worktree and multi-repo scaling  
\- checkpointed recovery  
\- DanteForge verification on every automated Git write

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- packages/git-engine/src/event-orchestrator is the source of truth  
\- No automated Git write without explicit verification outcome  
\- No webhook acceptance without verification when secret is configured  
\- No silent event drops  
\- No queue/run state that lives only in memory for critical flows  
\- No promotion from review-required to write-ready automatically

Create:  
packages/git-engine/src/event-orchestrator/  
 types.ts  
 git-event-watcher.ts  
 event-normalizer.ts  
 event-queue.ts  
 local-workflow-runner.ts  
 webhook-handler.ts  
 auto-pr-engine.ts  
 changeset-manager.ts  
 scheduler.ts  
 workflow-state-store.ts  
 audit-log.ts  
 rate-limiter.ts  
 multi-repo-coordinator.ts  
 index.ts

Generation order:

G1:  
\- types.ts  
\- index.ts  
\- tests

G2:  
\- workflow-state-store.ts  
\- audit-log.ts  
\- tests

G3:  
\- event-normalizer.ts  
\- tests

G4:  
\- event-queue.ts  
\- rate-limiter.ts  
\- tests

G5:  
\- git-event-watcher.ts  
\- tests

G6:  
\- local-workflow-runner.ts  
\- tests

G7:  
\- scheduler.ts  
\- tests

G8:  
\- changeset-manager.ts  
\- tests

G9:  
\- auto-pr-engine.ts  
\- tests

G10:  
\- webhook-handler.ts  
\- tests

G11:  
\- multi-repo-coordinator.ts  
\- tests

G12:  
Integrate with:  
\- background-agent.ts  
\- checkpointer.ts  
\- recovery-engine.ts  
\- tests

G13:  
Integrate DanteForge verification bridge  
\- tests

G14:  
Integrate with:  
\- model-router.ts  
\- subagent spawning/orchestrator  
\- tests

G15:  
Integrate:  
\- MCP tools  
\- slash commands  
\- streaming progress  
\- tests

G16:  
\- benchmark harness / fixtures / reports  
\- tests

Required public APIs:  
\- gitWatch(eventType, path?, options?)  
\- runGithubWorkflow(workflowPath, eventPayload?)  
\- autoPrCreate(title, body?, changesets?)  
\- webhookListen(provider, secret?)  
\- scheduleGitTask(cron, task)

Golden flows:  
\- file change to workflow  
\- hook-triggered verification  
\- local workflow execution  
\- promotion flow  
\- secure webhook  
\- concurrency and recovery across 8 workflows

At the end of each generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until all golden flows pass.  
---

# **12\. Final judgment**

This machine matters because it turns Git from a passive repo layer into a **reactive automation substrate**.

The correct build order is:

**contracts → state/audit → normalize → queue → watch → run → promote → webhook → scale → recovery → verification**

That will get you to a real event spine without collapsing under complexity.

