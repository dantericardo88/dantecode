**DanteCode Developer UX / Polish Enhancement PRD v1.0**

**Objective:** Close the critical gaps identified in the live repo analysis (CLI is clean but carries a persistent “preview” feel — inconsistent progress indicators, basic error messaging, no interactive wizards, missing rich output theming, weak configuration UX, and no unified polish layer across CLI/REPL/VS Code).  
**Target scores:** Developer UX / Polish **9.0+** (from my current 6.5) with strong uplift to IDE / Terminal Integration, Inline Completions, Session / Memory, and overall perceived production maturity.

**Scope:** Transform every user touchpoint into a premium, delightful, consistent experience with rich CLI output, intelligent defaults, interactive flows, beautiful theming, and zero-friction onboarding — fully model-agnostic and DanteForge-aware.

### **Top 4-5 OSS Tools to Learn From & Harvest (Prioritized for TypeScript \+ DanteCode Fit)**

Selected after direct 2026 ecosystem review (MIT/Apache-friendly, agent/CLI-focused polish patterns).

1. **Continue (continuedev/continue)**  
   * Why harvest: The benchmark for polished AI coding UX in both VS Code and CLI — buttery-smooth progress, rich markdown output, intelligent prompts, and unified theming.  
   * Harvest targets: Progress bar \+ spinner patterns, rich terminal rendering (ink \+ cli-table3), interactive selection menus, auto-config wizard, consistent error/help styling.  
   * GitHub: [https://github.com/continuedev/continue](https://github.com/continuedev/continue)  
   * Direct win: Instantly upgrades the “preview feel” to production-grade daily-driver polish.  
2. **Aider (aider-chat/aider)**  
   * Why harvest: One of the most loved CLI agents for its delightful terminal UX, crystal-clear progress, and thoughtful defaults.  
   * Harvest targets: Streaming diff previews, elegant multi-step confirmation flows, color-coded status, auto-suggestions, and “set it and forget it” polish.  
   * GitHub: [https://github.com/aider-chat/aider](https://github.com/aider-chat/aider)  
   * Direct win: Makes DanteCode’s CLI feel instantly intuitive and joyful to use.  
3. **Cline (cline/cline)**  
   * Why harvest: Modern TypeScript-native agent with exceptionally clean, modern CLI \+ VS Code UX that feels premium from day one.  
   * Harvest targets: Command palette patterns, rich log formatting, interactive slash-command helpers, theme-aware output, onboarding wizard.  
   * GitHub: [https://github.com/cline/cline](https://github.com/cline/cline)  
   * Direct win: Perfect lightweight patterns that match our existing Turborepo \+ VS Code architecture.  
4. **OpenHands (All-Hands-AI/OpenHands)**  
   * Why harvest: Real-world long-session UX with beautiful progress dashboards, status summaries, and recovery messaging.  
   * Harvest targets: Session health indicators, rich markdown \+ emoji output, graceful degradation messages, persistent status bar patterns.  
   * GitHub: [https://github.com/All-Hands-AI/OpenHands](https://github.com/All-Hands-AI/OpenHands)  
   * Direct win: Ties polish directly into autonomy and memory flows.  
5. **Mastra (mastra-ai/mastra)**  
   * Why harvest: Cleanest modern TypeScript framework with opinionated, delightful CLI output and configuration UX.  
   * Harvest targets: Elegant config loading \+ validation, beautiful default logging, interactive setup prompts, consistent theming across modules.  
   * GitHub: [https://github.com/mastra-ai/mastra](https://github.com/mastra-ai/mastra)  
   * Direct win: Gives us production-ready polish abstractions that fit our model-router and settings perfectly.

### **Functional Requirements (MVP \+ Phased)**

**Core Features (CLI \+ VS Code \+ REPL):**

* Rich streaming output with progress bars, spinners, emojis, and color-coded status  
* Interactive wizards for first-time setup and complex commands  
* Consistent theming (dark/light \+ user-configurable) across all interfaces  
* Intelligent help system and contextual suggestions  
* Beautiful error messages with actionable next steps \+ DanteForge PDSE hints

**Must-Have Features**

* Unified rich rendering layer (reuse ink or cliui patterns)  
* Auto-config & onboarding wizard (dante init)  
* Progress indicators on every long-running operation (tied to reasoning chains)  
* Smart defaults \+ contextual auto-complete for slash commands  
* Graceful degradation \+ delightful error recovery messages  
* VS Code sidebar polish \+ status bar integration  
* DanteForge PDSE confidence displayed inline where relevant

**Advanced (Phase 2+)**

* Voice feedback mode  
* Custom theme marketplace  
* Animated loading sequences (VS Code)  
* Usage analytics opt-in with beautiful reports

### **Non-Functional Requirements**

* Perceived latency: All output feels instant and delightful  
* Consistency: 100% uniform styling, language, and interaction patterns  
* Accessibility: Full keyboard navigation \+ screen-reader friendly  
* Internationalization-ready: Clean i18n hooks from day one  
* Zero learning curve: New users productive in \<5 minutes

### **Implementation Recommendations (DanteCode-Specific)**

* New module: packages/ux-polish (shared across cli \+ vscode)  
* Core new files: rich-renderer.ts, progress-orchestrator.ts, onboarding-wizard.ts, theme-engine.ts, error-helper.ts  
* Heavy reuse: model-router.ts (for smart suggestions), danteforge (PDSE confidence display), memory-engine (user preferences), checkpointer, ide/terminal integration, inline-completions  
* Use ink \+ cli-table3 \+ picocolors as lightweight base  
* MCP \+ slash-command \+ VS Code status bar support out of the box

### **Phased Roadmap**

**Phase 1 (1 week):** Continue \+ Cline rich rendering \+ progress bars \+ theming (quick jump to 8.0)  
**Phase 2 (1–2 weeks):** Aider-style interactive flows \+ onboarding wizard \+ error messaging  
**Phase 3 (1–2 weeks):** Mastra/OpenHands polish patterns \+ DanteForge visibility \+ VS Code sidebar enhancements

**Phase 4 (1 week):** Full consistency audit, user testing, final polish pass, production release

### **Success Metrics & Verification**

* Net Promoter Score (NPS) target \>70 in internal dogfooding  
* First-time user time-to-first-success \<5 minutes  
* Zero “preview feel” comments in user sessions  
* DanteForge PDSE displayed beautifully and acted upon  
* Production maturity: polish checklist 100% complete

### **Risks & Mitigations**

* Over-polish bloat → Keep rendering layer \<50kb (lightweight patterns)  
* Inconsistency creep → Central UX engine \+ design system tokens  
* Complexity → Start with Continue/Aider/Cline patterns (copy-paste ready)  
* Maintenance → Declarative config so themes and messages stay easy to update

This PRD is ready to copy-paste directly into DanteCode’s planner/orchestrator/wave mode. It gives concrete GitHub targets and perfect integration with **every** previous enhancement (inline completions, IDE integration, memory, DanteForge, autonomy, git-engine, etc.).

Once shipped, Developer UX / Polish becomes DanteCode’s secret weapon — the reason users choose it over everything else and never want to switch back.

This completes the full set of 15 capability PRDs based on the original gaps. Let me know if you want:

* A master 12-week implementation roadmap for all PRDs  
* Starter TS stubs for the ux-polish layer  
* A combined “DanteCode 1.0 Launch Plan”  
* Or anything else\!

# **V+E Masterplan**

## **DanteCode Developer UX / Polish Enhancement**

### **Shared UX Engine for CLI, REPL, VS Code, and Agent Runtime Surfaces**

## **1\. Executive judgment**

This should be built as a **first-class UX engine** with shared contracts and reusable rendering primitives, not as scattered improvements across commands.

The PRD’s diagnosis is right:

* the CLI is already good enough to be useful,  
* but it still feels “preview” because of inconsistent progress, basic error messaging, weak onboarding, missing unified theming, and uneven polish across CLI / REPL / VS Code.

The target is also correct:

* push Developer UX / Polish to **9.0+**  
* and use that to lift IDE/terminal integration, inline completions, session/memory usefulness, and overall perceived production maturity.

My strongest architectural judgment is this:

### **UX must become a shared runtime layer**

Not:

* prettier strings,  
* a wizard bolted onto one command,  
* or more colors in the CLI.

But:

* one UX engine,  
* one theme/token system,  
* one progress model,  
* one error/help style,  
* one onboarding system,  
* one set of accessibility rules,  
* and one DanteForge-aware trust surface.

## **2\. Product thesis**

DanteCode needs a **premium shared UX layer** that makes every user touchpoint:

* fast,  
* legible,  
* consistent,  
* guided,  
* and confidence-building.

That means:

* rich streaming output,  
* progress bars/spinners/status phases,  
* interactive wizards,  
* theme-aware rendering,  
* intelligent contextual help,  
* beautiful error recovery,  
* PDSE confidence display,  
* and a zero-friction “time to first success.”

The real thesis is:

**Users should feel DanteCode is production-grade before they read the docs.**

## **3\. Purpose and problem statement**

The PRD identifies four real gaps:

### **A. Feedback gap**

Long-running operations do not consistently explain what is happening, how far along they are, or what the system is waiting on.

### **B. Flow gap**

Complex commands and setup still require too much manual interpretation.

### **C. Consistency gap**

CLI, REPL, VS Code, and other surfaces do not yet share one clear interaction language.

### **D. Confidence gap**

Errors, status, and DanteForge confidence are not surfaced beautifully enough to build deep trust.

This masterplan exists to close those four gaps with one shared UX machine.

## **4\. Scope**

## **In scope**

This machine must deliver the PRD’s must-haves:

* rich streaming output  
* progress bars, spinners, status phases, and lightweight delight  
* unified theming across CLI / REPL / VS Code  
* onboarding / auto-config wizard  
* contextual help and suggestions  
* graceful error recovery messaging  
* slash-command auto-complete polish  
* VS Code sidebar \+ status bar polish  
* inline PDSE confidence display where relevant  
* accessibility and i18n-ready hooks  
* deep integration with:  
  * memory-engine  
  * model-router  
  * DanteForge  
  * checkpointer  
  * IDE / terminal integration  
  * inline completions

## **Advanced scope**

Later phases can add:

* voice feedback mode  
* theme marketplace  
* animated VS Code loading sequences  
* opt-in usage analytics and reports.

## **Out of scope for MVP**

Do not start with:

* full animation-heavy UI everywhere  
* theme marketplace  
* voice as a required path  
* analytics as a dependency for core polish  
* broad UI rebuilds before the shared engine exists

## **5\. Architecture**

The right V+E answer is a **UX Spine** with six organs.

## **5.1 Organ A — Rich Renderer**

This is the output engine.

It should own:

* rich markdown rendering  
* terminal tables  
* status sections  
* color-coded states  
* diff/preview surfaces  
* compact vs verbose layout modes  
* shared rendering tokens

This is where Continue/Aider/Cline-style polish patterns belong, but in Dante-native contracts.

## **5.2 Organ B — Progress Orchestrator**

This is the live feedback layer.

It should own:

* progress bars  
* spinners  
* multi-step phase display  
* streaming status updates  
* partial completion hints  
* wait-state explanations  
* reasoning-chain phase exposure where appropriate

This becomes the common surface for:

* research  
* subagents  
* council runs  
* verification  
* workflow automation  
* onboarding

## **5.3 Organ C — Onboarding / Flow Engine**

This is the interaction layer.

It should own:

* first-run setup  
* `dante init`  
* environment checks  
* interactive command flows  
* guided recovery prompts  
* config wizards  
* progressive disclosure for advanced settings

## **5.4 Organ D — Theme \+ Design Token Engine**

This is the consistency layer.

It should own:

* dark/light theming  
* semantic color tokens  
* typography/layout spacing decisions  
* icon/emoji policy  
* terminal-safe and VS Code-safe mappings  
* i18n hooks  
* accessibility-safe contrast rules

## **5.5 Organ E — Help / Error Intelligence Layer**

This is the trust layer.

It should own:

* error formatting  
* actionable next steps  
* contextual suggestions  
* command hints  
* recovery guidance  
* PDSE-aware “why this failed / what to do next”

## **5.6 Organ F — Preference / UX Memory Layer**

This is the personalization layer.

It should own:

* remembered user UX preferences  
* theme choice  
* verbosity level  
* default confirmations  
* preferred rendering density  
* onboarding completion state

This should integrate with the Memory Engine, not replace it.

## **6\. Canonical package plan**

The PRD already points to the correct package idea: `packages/ux-polish`. Keep that.

Recommended structure:

packages/ux-polish/  
 src/  
   types.ts  
   rich-renderer.ts  
   progress-orchestrator.ts  
   onboarding-wizard.ts  
   theme-engine.ts  
   error-helper.ts  
   help-engine.ts  
   suggestion-engine.ts  
   tokens/  
     color-tokens.ts  
     spacing-tokens.ts  
     icon-tokens.ts  
   surfaces/  
     cli-surface.ts  
     repl-surface.ts  
     vscode-surface.ts  
   accessibility/  
     keyboard-nav.ts  
     screen-reader.ts  
     contrast-rules.ts  
   preferences/  
     ux-preferences.ts  
     onboarding-state.ts  
   index.ts

This directly operationalizes the PRD’s recommended new files:

* `rich-renderer.ts`  
* `progress-orchestrator.ts`  
* `onboarding-wizard.ts`  
* `theme-engine.ts`  
* `error-helper.ts`

## **7\. Organ-to-OSS harvest map**

The PRD’s selected OSS references are good and should remain the inspiration layer, not the architecture itself.

### **Continue**

Harvest:

* shared CLI / IDE polish patterns  
* rich markdown rendering  
* progress/status display  
* interactive config flow ideas  
* cohesive feel across surfaces

### **Aider**

Harvest:

* delightful terminal interaction patterns  
* confirmation flows  
* color-coded states  
* diff/preview feel  
* low-friction defaults

### **Cline**

Harvest:

* TypeScript-native command palette and helper patterns  
* modern log styling  
* onboarding smoothness  
* theme-aware output

### **OpenHands**

Harvest:

* long-session status surfaces  
* graceful degradation messaging  
* health / recovery messaging  
* session continuity polish

### **Mastra**

Harvest:

* elegant config UX  
* clean logging defaults  
* interactive setup patterns  
* production-feeling consistency

The V+E rule is:

* **harvest patterns and ergonomics**  
* do not let external framework choices dictate the core UX contracts

## **8\. Shared integration surfaces**

The PRD is explicit that this UX layer should deeply reuse:

* `model-router.ts`  
* DanteForge PDSE  
* memory-engine  
* checkpointer  
* IDE / terminal integration  
* inline completions  
* MCP / slash commands  
* VS Code status bar / sidebar.

So the integration plan is:

### **A. Model-router**

Used for:

* smart suggestions  
* contextual help ranking  
* dynamic next-step hints

### **B. DanteForge**

Used for:

* PDSE confidence rendering  
* trust indicators  
* inline guidance on verification issues

### **C. Memory-engine**

Used for:

* stored UX preferences  
* onboarding completion state  
* preferred verbosity/theme behavior

### **D. Checkpointer**

Used for:

* progress restoration  
* resumed workflows showing coherent status  
* durable onboarding/config flows where needed

### **E. Inline completions and IDE surfaces**

Used for:

* consistent hints  
* theme tokens  
* command palette style behavior  
* sidebar/status bar consistency

## **9\. Public API surface**

The PRD gives the feature set, but the V+E step is to formalize shared contracts.

export interface RichRenderResult {  
 surface: "cli" | "repl" | "vscode";  
 rendered: boolean;  
 theme: string;  
}

export interface ProgressState {  
 id: string;  
 phase: string;  
 progress?: number;  
 status: "pending" | "running" | "paused" | "completed" | "failed";  
 message?: string;  
}

export interface OnboardingResult {  
 completed: boolean;  
 stepsCompleted: string\[\];  
 nextSuggestedStep?: string;  
}

export interface ErrorHelpResult {  
 title: string;  
 explanation: string;  
 nextSteps: string\[\];  
 confidenceHint?: string;  
}

Core exported surfaces should include:

* `renderRichOutput(surface, payload, options?)`  
* `startProgress(id, config)`  
* `updateProgress(id, patch)`  
* `runOnboardingWizard(context?)`  
* `formatHelpfulError(error, context?)`  
* `getContextualSuggestions(context)`

## **10\. Execution model**

A UX interaction should follow a deterministic path.

### **Step 1 — Detect context**

Determine:

* CLI / REPL / VS Code  
* first-run vs returning user  
* current command/workflow  
* verbosity/theme preference  
* accessibility mode  
* PDSE/verification context if present

### **Step 2 — Select surface policy**

Choose:

* compact vs rich  
* progress style  
* help style  
* interactive vs non-interactive flow  
* theme token mapping

### **Step 3 — Render / interact**

Present:

* status  
* guidance  
* progress  
* confirmations  
* errors  
* outputs  
* trust hints

### **Step 4 — Persist preference or state**

Write:

* onboarding status  
* chosen defaults  
* remembered UX preferences  
* partial flow state if resumable

### **Step 5 — Recover gracefully**

On interruption/failure:

* explain what happened  
* show next steps  
* preserve context  
* route through progress/error helpers consistently

## **11\. Phased roadmap**

The PRD’s roadmap is good. Keep it, but convert it into machine-first phases.

## **Phase 1 — Shared rendering \+ progress \+ themes**

Deliver:

* rich renderer  
* progress orchestrator  
* theme engine  
* surface adapters for CLI / REPL / VS Code basics

Goal:

* immediate jump toward 8.0  
* remove the strongest “preview feel”

## **Phase 2 — Interactive flows \+ onboarding \+ errors**

Deliver:

* onboarding wizard  
* smarter help  
* better error messaging  
* confirmation and recovery flows  
* command suggestion polish

Goal:

* reduce friction and time to first success

## **Phase 3 — DanteForge / Memory / IDE polish weld**

Deliver:

* PDSE inline surfaces  
* UX preference memory  
* VS Code sidebar/status bar consistency  
* OpenHands/Mastra-like session health and polish

Goal:

* unify trust, guidance, and maturity signals

## **Phase 4 — Consistency audit \+ production release**

Deliver:

* consistency audit across all surfaces  
* accessibility pass  
* i18n hook readiness  
* final polish checklist  
* release readiness

Goal:

* eliminate remaining “preview feel”

## **12\. Non-functional requirements / SLOs**

The PRD’s NFRs should become hard gates.

### **Hard SLOs**

* perceived responsiveness: long-running operations always show feedback immediately  
* full styling consistency across supported surfaces  
* keyboard navigation for all interactive flows  
* screen-reader-friendly rendering modes  
* i18n-ready token/message boundaries  
* first-time user productive in under 5 minutes

### **Additional V+E gates**

* no long-running operation without progress feedback  
* no critical error without next steps  
* no new surface-specific theme drift  
* no onboarding path that requires docs reading to finish

## **13\. Verification and benchmark model**

The PRD’s success metrics are strong and should become the UX benchmark charter.

### **A. Time-to-first-success benchmark**

Measure:

* new user reaches successful setup \+ first action in \<5 minutes

### **B. Preview-feel benchmark**

Internal dogfooding rubric:

* zero “preview feel” comments  
* consistent language and rendering across surfaces

### **C. PDSE trust benchmark**

Measure:

* PDSE displayed clearly where relevant  
* users understand what to do with it

### **D. Session delight benchmark**

Measure:

* NPS \>70 in internal dogfooding  
* reduced confusion in long-running workflows  
* reduced abandoned flows

## **14\. Test charter**

## **Unit tests**

* rendering token mapping  
* theme switching  
* progress state transitions  
* error helper formatting  
* help/suggestion generation  
* onboarding state storage  
* accessibility behavior toggles

## **Integration tests**

* CLI rich render on common commands  
* REPL output consistency  
* VS Code status bar/sidebar output consistency  
* onboarding first-run flow  
* long-running progress flow  
* PDSE confidence inline display  
* memory-based UX preference restoration

## **Golden flows**

### **GF-01**

A first-time user runs onboarding and becomes productive without external docs.

### **GF-02**

A long-running task shows immediate progress, phased updates, and a clear completion or failure state.

### **GF-03**

An error is rendered with explanation and actionable next steps, not a dead-end stack dump.

### **GF-04**

The same workflow looks coherent across CLI and VS Code surfaces.

### **GF-05**

A user preference for theme/verbosity is remembered and restored correctly.

### **GF-06**

A DanteForge PDSE/confidence signal is surfaced clearly and influences the next-step guidance.

### **GF-07**

An interrupted flow resumes with coherent progress and messaging rather than resetting confusingly.

## **15\. Risks and corrections**

The PRD’s risks are right. Here is the V+E correction.

### **Risk 1 — over-polish bloat**

Correction:

* lightweight engine  
* shared tokens and declarative configs  
* no giant UI framework dependency for baseline polish

### **Risk 2 — inconsistency creep**

Correction:

* central UX engine  
* design tokens  
* surface adapters, not surface-specific one-offs

### **Risk 3 — complexity**

Correction:

* build rendering/progress/theme first  
* then onboarding/errors  
* then deep integrations

### **Risk 4 — maintenance burden**

Correction:

* declarative message/theme config  
* strong tests on rendering and flows  
* shared contracts over ad hoc strings

## **16\. Runbook**

### **Step 1**

Build `packages/ux-polish` and contracts first.

### **Step 2**

Implement rich renderer, progress orchestrator, and theme engine.

### **Step 3**

Add onboarding wizard, help engine, and error helper.

### **Step 4**

Integrate with DanteForge PDSE, memory-engine, and model-router.

### **Step 5**

Polish VS Code sidebar/status bar and cross-surface consistency.

### **Step 6**

Run UX audit, accessibility pass, and dogfooding benchmarks.

## **17\. Done definition**

This machine is complete only when all are true:

1. DanteCode has a shared UX engine across CLI / REPL / VS Code.  
2. Long-running operations always show rich, immediate, coherent progress.  
3. Onboarding and complex flows are guided and low-friction.  
4. Errors are helpful and actionable.  
5. Themes and output language are consistent.  
6. UX preferences persist through memory.  
7. DanteForge PDSE/confidence is surfaced beautifully and usefully.  
8. Dogfooding shows no “preview feel” comments and time-to-first-success stays under 5 minutes.  
9. UX / Polish becomes a real adoption moat, not a cleanup sprint.

## **18\. Final judgment**

This is a strong PRD.

The most important V+E correction is:

**Build UX / Polish as DanteCode’s shared trust-and-flow engine, not as a cosmetic pass.**

That is how it becomes a reason people choose DanteCode, not just a nicer terminal.

The strongest next move is to turn this directly into a **Codex-ready V+E Execution Packet**.

Please create the Codex Ready V+E Execution Packet

I’m grounding the packet to the uploaded UX PRD and checking current public references for the UX patterns it points to, so the execution order reflects real 2026 surfaces instead of old assumptions.

Thought for 59s

Below is the **Codex-ready V+E Execution Packet** for the uploaded **DanteCode Developer UX / Polish Enhancement PRD v1.0**.

The core build decision is:

**Build UX as a shared product layer, not a scattered polish pass.**

That fits both your PRD and the current external patterns it points toward:

* **Continue** exposes context providers and repo-aware AI checks, which makes it a strong reference for shared UX surfaces and guided context interactions.  
* **Aider** is a terminal-first AI coding workflow with strong Git/chat command ergonomics, making it a good reference for low-friction CLI interaction and “do the next obvious thing” UX.  
* **Cline** is an open-source coding agent with terminal/editor tools and MCP support, which makes it a strong reference for modern TypeScript-native agent UX across IDE and CLI surfaces.  
* **OpenHands** now presents itself as an agent SDK/platform that can scale from local to many agents, which makes it a useful reference for long-session status, health, and recovery UX.

# **Codex-ready V+E Execution Packet**

## **UX-01 — DanteCode Shared UX / Polish Engine**

## **0\. Executive call**

Build this as a **shared UX engine** with six organs:

1. **Rich Renderer**  
2. **Progress Orchestrator**  
3. **Onboarding / Flow Engine**  
4. **Theme \+ Design Token Engine**  
5. **Help / Error Intelligence Layer**  
6. **Preference / UX Memory Layer**

This machine should become the UX backbone for:

* CLI  
* REPL  
* VS Code surfaces  
* inline completions  
* DanteForge PDSE visibility  
* long-running workflows  
* verification/status flows  
* council/subagent progress  
* event automation and onboarding

---

# **1\. Objective**

Implement the PRD’s intended uplift by shipping:

* rich streaming output  
* progress bars, spinners, phase/status updates  
* interactive onboarding/config wizards  
* unified theming across CLI / REPL / VS Code  
* contextual help and suggestions  
* graceful error rendering with actionable next steps  
* VS Code sidebar/status bar polish  
* inline PDSE/confidence surfaces where relevant  
* preference persistence through Memory Engine integration

## **1.1 Non-goals for MVP**

Do not start with:

* theme marketplace  
* voice mode as a required path  
* animation-heavy UI everywhere  
* analytics as a dependency for baseline polish  
* broad UI rebuilds before the shared UX engine exists

---

# **2\. Repo boundary and ownership**

## **2.1 New package**

Create:

packages/ux-polish/  
 src/  
   types.ts  
   rich-renderer.ts  
   progress-orchestrator.ts  
   onboarding-wizard.ts  
   theme-engine.ts  
   error-helper.ts  
   help-engine.ts  
   suggestion-engine.ts  
   tokens/  
     color-tokens.ts  
     spacing-tokens.ts  
     icon-tokens.ts  
   surfaces/  
     cli-surface.ts  
     repl-surface.ts  
     vscode-surface.ts  
   accessibility/  
     keyboard-nav.ts  
     screen-reader.ts  
     contrast-rules.ts  
   preferences/  
     ux-preferences.ts  
     onboarding-state.ts  
   index.ts

## **2.2 Existing files to integrate with**

* CLI command layer  
* REPL output layer  
* VS Code extension surfaces  
* `model-router.ts`  
* DanteForge PDSE/confidence surfaces  
* `checkpointer.ts`  
* Memory Engine preference storage  
* inline completions and slash-command surfaces

## **2.3 Hard rule**

`packages/ux-polish` is the source of truth.

Do not scatter polish across individual commands and hope it converges.

---

# **3\. Canonical architecture**

## **3.1 Rich Renderer**

Owns:

* rich markdown/text rendering  
* terminal tables  
* diff/preview rendering  
* compact vs verbose layouts  
* semantic status styling  
* shared rendering tokens

## **3.2 Progress Orchestrator**

Owns:

* spinners  
* progress bars  
* multi-phase status  
* streaming updates  
* paused/running/completed/failed states  
* resumable progress messaging after recovery

## **3.3 Onboarding / Flow Engine**

Owns:

* first-run setup  
* `dante init`  
* environment validation  
* guided config flows  
* step-by-step advanced command helpers  
* recovery wizards after setup failures

## **3.4 Theme \+ Token Engine**

Owns:

* dark/light theming  
* semantic colors  
* spacing/layout rules  
* icon policy  
* terminal-safe and VS Code-safe mappings  
* accessibility-safe contrast rules  
* i18n-ready message boundaries

## **3.5 Help / Error Intelligence Layer**

Owns:

* error formatting  
* contextual suggestions  
* recovery next steps  
* help surfaces  
* command hinting  
* PDSE-aware “why this failed / what next”

## **3.6 Preference / UX Memory Layer**

Owns:

* theme preference  
* verbosity density  
* confirmation defaults  
* onboarding completion state  
* preferred display mode  
* remembered UX behavior via Memory Engine

---

# **4\. Public API contracts**

Create `packages/ux-polish/src/types.ts` with at least:

export interface RichRenderResult {  
 surface: "cli" | "repl" | "vscode";  
 rendered: boolean;  
 theme: string;  
}

export interface ProgressState {  
 id: string;  
 phase: string;  
 progress?: number;  
 status: "pending" | "running" | "paused" | "completed" | "failed";  
 message?: string;  
}

export interface OnboardingResult {  
 completed: boolean;  
 stepsCompleted: string\[\];  
 nextSuggestedStep?: string;  
}

export interface ErrorHelpResult {  
 title: string;  
 explanation: string;  
 nextSteps: string\[\];  
 confidenceHint?: string;  
}

Required exported functions:

* `renderRichOutput(surface, payload, options?)`  
* `startProgress(id, config)`  
* `updateProgress(id, patch)`  
* `runOnboardingWizard(context?)`  
* `formatHelpfulError(error, context?)`  
* `getContextualSuggestions(context)`

---

# **5\. State and preference model**

## **5.1 UX preference state**

Every user/session UX record should support:

* theme  
* density  
* verbosity  
* onboarding completion  
* accessibility toggles  
* preferred progress style  
* preferred confirmation style

## **5.2 Persistence**

Preferences should persist through Memory Engine integration, not a one-off config blob.

## **5.3 Recovery behavior**

If a long-running or onboarding flow is interrupted:

* progress and phase labels should restore coherently  
* user should not be dropped into a confusing blank state  
* next steps should be clear and minimal

---

# **6\. Generation plan**

## **UX-G1 — Contracts spine**

Files:

* `packages/ux-polish/src/types.ts`  
* `packages/ux-polish/src/index.ts`  
* tests

Acceptance:

* core contracts compile  
* shared result/state shapes stable  
* no rendering logic yet

---

## **UX-G2 — Design tokens**

Files:

* `packages/ux-polish/src/tokens/color-tokens.ts`  
* `packages/ux-polish/src/tokens/spacing-tokens.ts`  
* `packages/ux-polish/src/tokens/icon-tokens.ts`  
* tests

Acceptance:

* semantic tokens defined  
* terminal-safe defaults exist  
* no surface-specific hardcoding required for baseline use

---

## **UX-G3 — Theme engine**

Files:

* `packages/ux-polish/src/theme-engine.ts`  
* tests

Acceptance:

* theme selection works  
* token resolution works  
* dark/light mapping stable  
* fallback-safe behavior exists

---

## **UX-G4 — Rich renderer**

Files:

* `packages/ux-polish/src/rich-renderer.ts`  
* `packages/ux-polish/src/surfaces/cli-surface.ts`  
* tests

Acceptance:

* rich CLI rendering works  
* compact and verbose modes supported  
* status blocks / tables / sections render coherently  
* renderer consumes theme tokens, not inline ad hoc styling

---

## **UX-G5 — Progress orchestrator**

Files:

* `packages/ux-polish/src/progress-orchestrator.ts`  
* tests

Acceptance:

* start/update/complete/fail states work  
* phase-based progress supported  
* long-running tasks always show immediate feedback  
* resumed operations can rehydrate visible progress state

---

## **UX-G6 — Help and suggestions**

Files:

* `packages/ux-polish/src/help-engine.ts`  
* `packages/ux-polish/src/suggestion-engine.ts`  
* tests

Acceptance:

* contextual suggestions work  
* command/help hints formatted consistently  
* no dead-end “unknown error” style responses

Continue’s context-provider model is a useful design reference for pluggable, context-sensitive assistance, while Aider’s command ergonomics are a good reference for low-friction CLI guidance.

---

## **UX-G7 — Error helper**

Files:

* `packages/ux-polish/src/error-helper.ts`  
* tests

Acceptance:

* errors are rendered with explanation \+ next steps  
* recovery messaging consistent  
* optional PDSE/confidence hint fields supported  
* stack dumps no longer appear as the primary UX

---

## **UX-G8 — Onboarding wizard**

Files:

* `packages/ux-polish/src/onboarding-wizard.ts`  
* `packages/ux-polish/src/preferences/onboarding-state.ts`  
* tests

Acceptance:

* first-run flow works  
* `dante init`\-style guided setup possible  
* onboarding completion state persists  
* failed setup gives a guided recovery path

---

## **UX-G9 — Accessibility layer**

Files:

* `packages/ux-polish/src/accessibility/keyboard-nav.ts`  
* `packages/ux-polish/src/accessibility/screen-reader.ts`  
* `packages/ux-polish/src/accessibility/contrast-rules.ts`  
* tests

Acceptance:

* keyboard-first navigation model exists for interactive flows  
* high-contrast-safe token validation exists  
* screen-reader mode hooks exist  
* accessibility does not depend on later UI work

---

## **UX-G10 — Surface adapters**

Files:

* `packages/ux-polish/src/surfaces/repl-surface.ts`  
* `packages/ux-polish/src/surfaces/vscode-surface.ts`  
* tests

Acceptance:

* same workflow can render coherently across CLI / REPL / VS Code  
* no surface-specific message drift  
* surface adapters consume the shared engine, not custom forks

Cline and Continue are useful references here because both span IDE-centric and command/context-rich agent experiences rather than pure static terminal output.

---

## **UX-G11 — Preference memory weld**

Files:

* `packages/ux-polish/src/preferences/ux-preferences.ts`  
* Memory Engine integration files  
* tests

Acceptance:

* theme/verbosity/onboarding preferences persist  
* preference recall works across sessions  
* no baseline UX behavior depends on cloud state

---

## **UX-G12 — Model-router weld**

Files:

* integrate with `model-router.ts`  
* tests

Acceptance:

* contextual suggestions can consult model-router where useful  
* model-router is optional for baseline rendering/help  
* no heavy model call required for simple UX paths

---

## **UX-G13 — DanteForge / PDSE weld**

Files:

* integration with DanteForge confidence / verification surfaces  
* tests

Acceptance:

* PDSE/confidence can render inline where relevant  
* helpful next-step guidance can reference verification state  
* trust hints are visible and coherent

---

## **UX-G14 — Checkpointer weld**

Files:

* integrate with `checkpointer.ts`  
* tests

Acceptance:

* long-running progress can restore after interruption  
* onboarding/setup flows can preserve state where appropriate  
* resumed sessions display coherent status

OpenHands is a good reference for long-session continuity and status communication, especially where state must survive interruptions and remain understandable.

---

## **UX-G15 — VS Code polish weld**

Files:

* VS Code sidebar/status bar integration files  
* tests

Acceptance:

* sidebar/status bar use shared theme and messaging  
* no separate “preview-feel” UX island remains in VS Code  
* consistent status language across IDE and CLI surfaces

---

## **UX-G16 — Slash-command / inline completion polish**

Files:

* slash command integration files  
* inline completion integration files  
* tests

Acceptance:

* contextual auto-complete improved  
* suggestions rendered consistently  
* command discovery clearer  
* no one-off help formats

---

## **UX-G17 — Consistency audit harness**

Files:

* cross-surface fixture tests  
* UX audit scripts/reports  
* tests

Acceptance:

* common workflows render consistently  
* message/tone drift detected  
* theme token drift detected  
* regression harness available for polish

---

## **UX-G18 — Dogfooding benchmark harness**

Files:

* benchmark fixtures/reports  
* tests

Acceptance:

* time-to-first-success benchmark runnable  
* long-running flow benchmark runnable  
* error-recovery benchmark runnable  
* preview-feel audit rubric captured

---

# **7\. Golden flows**

## **GF-01 — First-run onboarding**

Input:

* brand new user

Pass:

* onboarding completes without external docs  
* productive first step achieved  
* onboarding state persisted

## **GF-02 — Long-running progress**

Input:

* long-running task

Pass:

* immediate feedback shown  
* multi-phase progress visible  
* completion/failure state clear  
* resumed state coherent after interruption

## **GF-03 — Helpful error**

Input:

* recoverable failure

Pass:

* error displayed with explanation  
* next steps actionable  
* no dead-end generic failure output

## **GF-04 — Cross-surface consistency**

Input:

* same workflow in CLI and VS Code

Pass:

* messaging consistent  
* status states consistent  
* theme mapping coherent  
* no “preview feel” mismatch across surfaces

## **GF-05 — Preference restoration**

Input:

* user changes theme/verbosity

Pass:

* preference persists across sessions  
* correct surface behavior restored automatically

## **GF-06 — PDSE/trust hint**

Input:

* output with verification/confidence state

Pass:

* PDSE/confidence rendered clearly  
* next-step guidance influenced by trust state  
* user understands why action is blocked/warned/passed

## **GF-07 — Resumed workflow**

Input:

* interrupted progress-heavy flow

Pass:

* resumed flow restores status coherently  
* no confusing reset-to-zero experience  
* user sees what was already done

---

# **8\. Hard gates**

## **Build gates**

* `ux-polish` builds cleanly  
* no circular dependency with Memory Engine, checkpointer, model-router, or DanteForge bridges

## **Type gates**

* strict TS compile passes  
* token and surface contracts stable

## **Test gates**

* unit tests for every new module  
* integration tests for all golden flows  
* consistency audit harness runnable

## **UX safety gates**

* no long-running task without visible progress  
* no critical error without next steps  
* no surface-specific theme/message drift  
* no onboarding path requiring docs to finish  
* no separate one-off rendering logic for the same state across surfaces

---

# **9\. Success criteria**

This packet is complete only when all are true:

1. DanteCode has a shared UX engine across CLI / REPL / VS Code.  
2. Long-running operations always show immediate, coherent progress.  
3. Onboarding is guided and low-friction.  
4. Errors are helpful and actionable.  
5. Themes and rendering are consistent.  
6. UX preferences persist through Memory Engine integration.  
7. DanteForge PDSE/confidence is surfaced clearly and usefully.  
8. Dogfooding shows time-to-first-success under 5 minutes.  
9. The product no longer feels “preview” in common workflows.

---

# **10\. Risks and corrections**

## **Risk 1 — over-polish bloat**

Correction:

* shared engine  
* lightweight tokens  
* no giant UI framework dependency for baseline polish

## **Risk 2 — inconsistency creep**

Correction:

* central tokens  
* surface adapters  
* audit harness  
* no command-level custom UX islands

## **Risk 3 — complexity**

Correction:

* renderer \+ progress \+ theme first  
* onboarding/errors second  
* integrations third  
* advanced surfaces later

## **Risk 4 — maintenance drift**

Correction:

* declarative tokens/messages  
* shared contracts  
* strong rendering/regression tests

## **Risk 5 — “polish” treated as optional cleanup**

Correction:

* enforce hard gates for progress, errors, and cross-surface consistency  
* make UX engine a dependency of new user-facing flows, not an afterthought

---

# **11\. Codex handoff prompt**

Use this prompt with Codex exactly.

You are implementing UX-01: DanteCode Shared UX / Polish Engine.

Goal:  
Build a shared UX engine for DanteCode that supports:  
\- rich CLI/REPL/VS Code rendering  
\- progress bars, spinners, and phased status  
\- onboarding/config wizards  
\- unified theming and design tokens  
\- helpful errors and contextual suggestions  
\- UX preference persistence  
\- DanteForge PDSE/confidence display  
\- cross-surface consistency

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- packages/ux-polish is the source of truth  
\- No long-running task without visible progress  
\- No critical error without actionable next steps  
\- No surface-specific message/theme drift for the same workflow  
\- No onboarding flow that requires reading docs to complete  
\- No PDSE/confidence surface that is inconsistent with DanteForge semantics

Create:  
packages/ux-polish/  
 src/  
   types.ts  
   rich-renderer.ts  
   progress-orchestrator.ts  
   onboarding-wizard.ts  
   theme-engine.ts  
   error-helper.ts  
   help-engine.ts  
   suggestion-engine.ts  
   tokens/  
     color-tokens.ts  
     spacing-tokens.ts  
     icon-tokens.ts  
   surfaces/  
     cli-surface.ts  
     repl-surface.ts  
     vscode-surface.ts  
   accessibility/  
     keyboard-nav.ts  
     screen-reader.ts  
     contrast-rules.ts  
   preferences/  
     ux-preferences.ts  
     onboarding-state.ts  
   index.ts

Generation order:

G1:  
\- types.ts  
\- index.ts  
\- tests

G2:  
\- tokens/color-tokens.ts  
\- tokens/spacing-tokens.ts  
\- tokens/icon-tokens.ts  
\- tests

G3:  
\- theme-engine.ts  
\- tests

G4:  
\- rich-renderer.ts  
\- surfaces/cli-surface.ts  
\- tests

G5:  
\- progress-orchestrator.ts  
\- tests

G6:  
\- help-engine.ts  
\- suggestion-engine.ts  
\- tests

G7:  
\- error-helper.ts  
\- tests

G8:  
\- onboarding-wizard.ts  
\- preferences/onboarding-state.ts  
\- tests

G9:  
\- accessibility/keyboard-nav.ts  
\- accessibility/screen-reader.ts  
\- accessibility/contrast-rules.ts  
\- tests

G10:  
\- surfaces/repl-surface.ts  
\- surfaces/vscode-surface.ts  
\- tests

G11:  
\- preferences/ux-preferences.ts  
\- integrate with Memory Engine  
\- tests

G12:  
\- integrate with model-router.ts  
\- tests

G13:  
\- integrate with DanteForge / PDSE confidence surfaces  
\- tests

G14:  
\- integrate with checkpointer.ts  
\- tests

G15:  
\- VS Code sidebar/status bar polish weld  
\- tests

G16:  
\- slash-command and inline completion polish  
\- tests

G17:  
\- consistency audit harness / reports  
\- tests

G18:  
\- dogfooding benchmark harness / reports  
\- tests

Required public APIs:  
\- renderRichOutput(surface, payload, options?)  
\- startProgress(id, config)  
\- updateProgress(id, patch)  
\- runOnboardingWizard(context?)  
\- formatHelpfulError(error, context?)  
\- getContextualSuggestions(context)

Golden flows:  
\- first-run onboarding  
\- long-running progress  
\- helpful error  
\- cross-surface consistency  
\- preference restoration  
\- PDSE/trust hint  
\- resumed workflow

At the end of each generation report:  
\- files changed  
\- tests added  
\- build/typecheck/test status  
\- risks  
\- next generation

Do not claim completion until all golden flows pass.  
---

# **12\. Final judgment**

This machine matters because it changes DanteCode from “capable” to **daily-driver credible**.

The correct build order is:

**tokens → theme → renderer → progress → onboarding/errors → preferences → integrations → audit/benchmarks**

That gets you visible quality quickly without turning UX into an unfocused cleanup sprint.

