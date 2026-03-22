SkillBridge V+E Execution Packet PRD  
Author: ChatGpt 5.4

Date: 2026-03-20

I’m opening the DanteForge and DanteCode repos side by side and mapping which responsibilities belong in each. The key question is whether SkillBridge should live in the end-user runtime, the binary forge layer, or be split across both.

Thought for 5m 58s

Yes. The idea is strong.

My honest take after reviewing the uploaded **DanteForge** repo and the uploaded **DanteCode** repo is:

**the moat is real, but Grok’s PRD currently mixes three different products into one feature**:

1. a **compiler/converter**  
2. an **installer/distributor**  
3. a **runtime/execution system**

Those should not all live in the same place.

Also, one important correction: **Qwen raw skills do not need `settings.json` registration**. Qwen discovers skills from `~/.qwen/skills/` and `.qwen/skills/` as folders containing `SKILL.md`; `/skills` is for explicit invocation. `settings.json` and `mcpServers` matter for **MCP servers**, not for plain skill folders.

So the good news is: **Qwen is actually the easy target**.  
The hard parts are:

* source acquisition and normalization,  
* capability classification,  
* safe wrapper generation,  
* verification,  
* and clean separation between **DanteForge responsibilities** and **DanteCode responsibilities**.

---

# **V+E Masterplan**

## **DanteForge SkillBridge / DanteCode Runtime Integration**

## **1\. Verdict**

This should be built.

But not exactly the way Grok framed it.

### **What I think is right**

* The market need is real.  
* A “grab a Claude skill repo and make it usable elsewhere” feature is a strong differentiator.  
* DanteForge is the right place for the **compiler \+ verifier \+ installer**.  
* DanteCode is the right place for the **runtime consumption \+ project-local activation \+ execution semantics**.

### **What I think is wrong in the current PRD**

* It overstates how trivial the Qwen target is.  
* It understates the complexity of CLI/MCP wrapper generation.  
* It assumes `settings.json` registration for Qwen skills when that is only needed for MCP servers.  
* It tries to keep the implementation under 5 new files. That is not realistic and would encourage bad architecture.  
* It treats PDSE as the only verification lens, but converted skills need their own **conversion-fidelity and runtime-compatibility scoring**.

---

## **2\. Repo truth after inspection**

From my inspection of the uploaded repos:

### **DanteForge already owns**

* skill discovery/loading  
* external skill registry/scanning  
* Antigravity import flow  
* assistant installation into user registries  
* awesome-scan style discovery  
* constitution / anti-stub / audit-style verification  
* packaged skill distribution patterns  
* MCP config/helper logic

In other words, **DanteForge already behaves like a forge, distributor, and verifier**.

### **DanteCode already owns**

* project-local skill storage under `.dantecode/skills`  
* skill import/wrap/validate/remove CLI flows  
* a `skill-adapter` package  
* runtime activation of skills in the CLI  
* wave-based skill execution behavior in the agent loop  
* an MCP package with config/client/server/tool bridge  
* the actual agent execution environment

In other words, **DanteCode already behaves like a consumer/runtime**.

### **Strategic conclusion**

Do **not** make DanteCode the source-of-truth compiler.  
Do **not** stuff all runtime concerns into DanteForge.

The correct split is:

* **DanteForge** \= compile, normalize, verify, emit, install  
* **DanteCode** \= import compiled bundle, activate it locally, execute it safely

---

## **3\. Revised product thesis**

The product should be reframed as:

### **DanteForge SkillBridge Compiler**

A canonical compiler that ingests Claude-style skill sources and emits verified multi-target bundles.

### **DanteCode SkillBridge Runtime**

A runtime integration layer that imports those bundles into project-local `.dantecode/skills`, exposes them in `dantecode skills`, and executes them through DanteCode’s agent/tool runtime.

That gives you:

* a real moat in DanteForge  
* a smooth UX in DanteCode  
* no split-brain converter logic

---

## **4\. Corrected PRD statement**

### **Product name**

**SkillBridge**

### **One-sentence definition**

A verified multi-target skill compiler and installer that converts Claude-style skills into **DanteForge-packaged**, **DanteCode-consumable**, **Qwen-native**, and optionally **MCP-exposed** bundles.

### **Core promise**

“Bring in a Claude-style skill once, then emit safe, installable targets for multiple agent environments.”

### **True MVP**

Not “convert everything into everything.”

The real MVP is:

1. ingest Claude-style skill source  
2. normalize into a canonical internal representation  
3. emit:  
   * DanteCode bundle  
   * Qwen skill folder  
   * optional MCP scaffold  
4. verify conversion quality  
5. install into target registries when explicitly requested

---

## **5\. The most important product correction**

### **Qwen emitter**

For Qwen, the raw-skill target is:

* folder  
* `SKILL.md`  
* optional supporting files  
* installed to `~/.qwen/skills/<slug>/` or `.qwen/skills/<slug>/`

That part is straightforward. Qwen auto-discovers those folders.

### **Qwen MCP output**

If you also want the skill to expose tools via MCP, then yes:

* generate MCP server output  
* generate a Qwen MCP install snippet or patch  
* update `mcpServers` in `settings.json` only on explicit install / opt-in.

So the PRD must distinguish:

* `--to qwen-skill`  
* `--to mcp`  
* `--install qwen-skill`  
* `--install qwen-mcp`

Those are not the same thing.

---

## **6\. What belongs in DanteForge vs DanteCode**

## **DanteForge owns**

### **A. Source intake**

* GitHub repo URL  
* GitHub tree URL  
* local folder  
* single `SKILL.md`  
* batch repo traversal

### **B. Canonical normalization**

* frontmatter parsing  
* instruction extraction  
* support-file discovery  
* provenance capture  
* license capture  
* conversion warnings  
* capability classification

### **C. Emitters**

* DanteCode bundle emitter  
* Qwen skill emitter  
* MCP scaffold emitter  
* generic CLI wrapper emitter if actually warranted

### **D. Verification / certification**

* parse validity  
* anti-stub on generated code  
* constitution safety on generated code/wrappers  
* target completeness  
* installability checks  
* conversion score

### **E. Install/distribution**

* install to assistant registries  
* update packaged skill catalogs  
* awesome-scan integration  
* lessons / audit / manifest output  
* future marketplace path

---

## **DanteCode owns**

### **A. Project-local bundle consumption**

* import compiled SkillBridge bundle into `.dantecode/skills`  
* register it in local skill registry  
* expose it through `dantecode skills list/show/validate/remove`

### **B. Runtime activation**

* `/skill <name>`  
* wave parsing  
* instruction execution  
* tool availability mapping

### **C. Runtime safety**

This is where your previous DTR work matters.

If a converted skill requires:

* downloads,  
* web fetches,  
* MCP calls,  
* subagents,  
* file writes,

then DanteCode’s scheduler/runtime must guarantee blocking semantics and verification before continuing. Otherwise the converted skill may import cleanly but execute badly.

So **SkillBridge depends on the DanteCode deterministic tool runtime work**. Not as a blocker for the first parser/emitter pass, but definitely as a blocker for “it just works.”

### **D. MCP consumption**

DanteCode already has MCP client/server/config/tool-bridge infrastructure. That means DanteCode should test and consume generated MCP bridges, but it should **not** be the primary place where those bridges are authored.

---

## **7\. New canonical architecture**

The missing piece in Grok’s PRD is a **canonical intermediate representation**.

Without that, you end up writing one-off translators:

* Claude → Qwen  
* Claude → MCP  
* Claude → CLI  
* Claude → DanteCode

That becomes brittle very fast.

### **Required internal object**

`skillbridge.json`

It should be the source-of-truth manifest for every conversion.

Suggested shape:

{  
 "version": "1",  
 "source": {  
   "kind": "github-tree",  
   "url": "…",  
   "repo": "…",  
   "commit": "…",  
   "path": "…",  
   "license": "…"  
 },  
 "normalizedSkill": {  
   "name": "web-scraper",  
   "slug": "web-scraper",  
   "description": "…",  
   "instructions": "…",  
   "supportFiles": \["reference.md", "scripts/helper.py"\],  
   "frontmatter": {},  
   "capabilities": {  
     "filesystem": true,  
     "network": true,  
     "shell": false,  
     "mcp": false,  
     "browser": false,  
     "llmRepairNeeded": false  
   },  
   "classification": "script-assisted"  
 },  
 "emitters": {  
   "dantecode": { "status": "success" },  
   "qwenSkill": { "status": "success" },  
   "mcp": { "status": "warning", "warnings": \["manual binding required"\] }  
 },  
 "verification": {  
   "parsePassed": true,  
   "constitutionPassed": true,  
   "antiStubPassed": true,  
   "conversionScore": 0.92  
 },  
 "warnings": \[\]  
}

This is the spine.

---

## **8\. Capability Profiler — the part Grok is missing**

Not every skill should be treated the same.

You need a **Capability Profiler** that classifies imported skills before emission.

### **Skill classes**

#### **Class A — Instruction-only**

Pure markdown guidance, no scripts, no executable assumptions.

Emit:

* DanteCode bundle  
* Qwen skill  
* maybe CLI alias only as a thin prompt wrapper

#### **Class B — Script-assisted**

Has scripts/resources/templates that can be packaged.

Emit:

* DanteCode bundle  
* Qwen skill  
* CLI wrapper  
* maybe MCP if tool contract is clear

#### **Class C — Tool-bound workflow**

Assumes browser tools, shell tools, repo tools, external APIs, etc.

Emit:

* DanteCode bundle with capability warnings  
* Qwen skill with support files  
* MCP only if tools can be mapped safely  
* no fake “working CLI wrapper” unless proven

#### **Class D — Unsupported / review-required**

Broken YAML, missing files, unsafe shell assumptions, impossible tool mapping.

Emit:

* report only  
* no install  
* status \= review required

This prevents false-success conversions.

---

## **9\. Revised command surface**

## **DanteForge**

### **Primary commands**

danteforge skills convert \<source\> \--to dantecode,qwen-skill,mcp \--verify  
danteforge skills verify \<bundle-or-source\>  
danteforge skills install \<bundle\> \--target qwen-skill  
danteforge skills install \<bundle\> \--target qwen-mcp  
danteforge skills scan \--source claude \<repo\>

### **Optional aliases**

danteforge skillbridge convert …  
danteforge awesome-scan \--source claude  
danteforge skills import \--from claude \<repo\>

## **DanteCode**

### **Facade command**

dantecode skills convert \<source\> \--to dantecode

That should delegate to the DanteForge library or binary, then import the resulting bundle locally.

### **Runtime import**

dantecode skills import-bridge \<bundle\>

This keeps the user experience smooth without duplicating compiler logic.

---

## **10\. File plan**

## **DanteForge — recommended additive structure**

Do **not** do a risky full reorg in phase 0\.  
That is too much churn for too little value.

Instead, add a new additive module family:

src/core/skillbridge/  
 source-resolver.ts  
 source-fetcher.ts  
 parser.ts  
 capability-profiler.ts  
 manifest.ts  
 verifier.ts  
 emitters/  
   dantecode.ts  
   qwen-skill.ts  
   mcp.ts  
   cli-wrapper.ts  
 installer.ts  
src/cli/commands/skills-convert.ts  
src/cli/commands/skills-verify.ts  
src/cli/commands/skills-install.ts  
tests/skillbridge/

### **Why additive is better**

Because DanteForge already has:

* `skills.ts`  
* `skills-import.ts`  
* `skill-registry.ts`  
* `assistant-installer.ts`  
* `awesome-scan.ts`

You should integrate with those, not destabilize them immediately.

---

## **DanteCode — required additions**

### **Extend existing areas, not new empire-building**

* `packages/cli/src/commands/skills.ts`  
* `packages/skill-adapter/src/importer.ts`  
* `packages/skill-adapter/src/registry.ts`  
* optional `packages/skill-adapter/src/parsers/qwen.ts`  
* integration tests across `packages/cli`, `packages/skill-adapter`, and `packages/mcp`

### **New internal concept**

DanteCode should understand a **compiled skill bundle**, not just raw imported markdown.

That means `.dantecode/skills/<name>/` may eventually contain:

* `SKILL.dc.md`  
* `skillbridge.json`  
* support files  
* optional MCP metadata  
* conversion warnings

---

## **11\. Verification model**

Grok’s PRD says “reuse PDSE.”

That is only partly right.

### **My recommendation**

Keep PDSE, but add a **SkillBridge Conversion Score**.

### **Required scoring dimensions**

* parse completeness  
* frontmatter fidelity  
* instruction fidelity  
* support-file completeness  
* target emission completeness  
* runtime compatibility  
* safety/constitution compliance  
* installability

### **Outcome buckets**

* **green** \= auto-install allowed  
* **amber** \= converted with warnings  
* **red** \= blocked / manual review

This is much more useful than forcing every skill through one pass/fail lens.

---

## **12\. Download / acquisition hardening**

This matters because the source is often remote.

The converter must not treat “download command finished” as “source acquired.”

It needs a lighter version of the same discipline you want in DanteCode runtime:

### **Required source acquisition steps**

1. acquire source  
2. verify source exists  
3. verify expected files exist  
4. verify target path is non-empty  
5. only then parse/convert

This applies to:

* GitHub repo archives  
* tree URL extraction  
* cloned repos  
* downloaded single-file skills

Otherwise SkillBridge itself becomes flaky.

---

## **13\. Golden flows**

These are the non-negotiable end-to-end proofs.

### **GF-01 — Single skill folder → Qwen skill**

Input:

* local folder with valid `SKILL.md`

Pass:

* normalized manifest created  
* Qwen skill emitted  
* install to `~/.qwen/skills/<slug>/`  
* no `settings.json` mutation required

### **GF-02 — GitHub tree URL → DanteCode bundle**

Input:

* GitHub tree URL targeting one skill folder

Pass:

* source acquired and verified  
* bundle emitted  
* `dantecode skills import-bridge` succeeds  
* skill shows up in local registry

### **GF-03 — Repo batch → mixed results**

Input:

* repo with multiple skills

Pass:

* each skill gets green/amber/red classification  
* green installs  
* amber emits warnings  
* red blocked with reasons

### **GF-04 — Skill \+ MCP target**

Input:

* skill that includes clear executable/script/tool contract

Pass:

* MCP scaffold emitted  
* Qwen MCP patch snippet generated  
* no silent mutation of `settings.json` unless explicit install command used

### **GF-05 — DanteCode activation**

Input:

* imported compiled bundle

Pass:

* `dantecode skills list` shows it  
* `/skill <name>` activates it  
* runtime warnings surfaced if required capabilities are unavailable

---

## **14\. Implementation phases**

## **Phase 0 — Contract first**

Define:

* `skillbridge.json`  
* normalized skill model  
* capability classes  
* verification result schema

This must happen before codegen.

## **Phase 1 — Source intake \+ normalization**

Build:

* local folder  
* single file  
* GitHub repo URL  
* GitHub tree URL

Output:

* normalized manifest only

## **Phase 2 — Qwen skill emitter**

This is the easiest emitter and should come first.

Output:

* `SKILL.md`  
* support files  
* install/uninstall helpers  
* tests against real path structure expected by Qwen.

## **Phase 3 — DanteCode bundle emitter**

Emit:

* `SKILL.dc.md`  
* local bundle manifest  
* support files  
* registry import path

This is where DanteCode integration begins.

## **Phase 4 — MCP emitter**

Only after canonical manifest and capability profiler exist.

Output:

* MCP server scaffold  
* transport metadata  
* target-specific install snippets

## **Phase 5 — Installers \+ scan integration**

Wire into:

* DanteForge `awesome-scan`  
* DanteForge assistant installer  
* DanteCode façade command

## **Phase 6 — Corpus testing**

Run against a real corpus:

* clean SKILL repos  
* ugly SKILL repos  
* script-heavy skills  
* broken YAML  
* multi-skill repos

## **Phase 7 — Standalone CLI**

Only after internals are stable.

---

## **15\. What must not happen**

1. Do not generate fake CLI wrappers for skills that are only instruction documents.  
2. Do not silently mutate Qwen `settings.json` for plain skills.  
3. Do not full-reorg DanteForge skills internals before the contract is stable.  
4. Do not duplicate compiler logic in DanteCode.  
5. Do not call something “converted successfully” if the target is only partially emitted.

---

## **16\. Direct gap analysis against Grok’s PRD**

### **Gap 1 — Qwen model is slightly wrong**

The PRD treats Qwen like it needs registration similar to MCP for skills. It does not; raw skills are discovered from the filesystem, while MCP is configured in `settings.json`.

### **Gap 2 — No canonical intermediate representation**

Without a normalized manifest, the feature will become a pile of translators.

### **Gap 3 — No capability profiling**

Not all skills should emit CLI and MCP equally.

### **Gap 4 — “\< 5 new files” is unrealistic**

This is a multi-emitter compiler with verification and installers. Forcing tiny file count will make the design worse.

### **Gap 5 — Verification is underspecified**

PDSE alone is not enough for skill conversion fidelity.

### **Gap 6 — Runtime dependency is missing**

Even if conversion succeeds, DanteCode still needs deterministic execution for tool-heavy skills.

### **Gap 7 — Standalone/inside-project state mutation is conflated**

Updating `STATE.yaml` and `lessons.md` makes sense in a DanteForge project flow, not in every standalone public-skill conversion.

---

## **17\. Final repo boundary recommendation**

### **Build first in DanteForge**

That is where the crown-jewel compiler, verifier, and installer belong.

### **Expose to DanteCode as:**

* library API  
* or stable binary invocation  
* plus a thin `dantecode skills convert` façade

### **DanteCode should build only:**

* bundle import  
* runtime registration  
* runtime activation  
* runtime warnings  
* execution compatibility

That is the clean split.

---

## **18\. Final opinion**

This can be one of your strongest features.

But only if you build it as:

**Forge \= compiler/certifier/distributor**  
**Code \= runtime/consumer/executor**

If you try to cram the whole thing into one layer, it will look exciting in demos and become brittle in reality.

If you build the canonical manifest first and keep the split clean, this becomes more than a converter. It becomes a **skill interoperability pipeline** with Dante ownership at the verification layer. That is the real moat.

The single biggest insight is this:

**Qwen is not the hard target. The hard problem is canonicalizing messy real-world skills into a verified intermediate form that multiple runtimes can trust.**

That is where DanteForge wins.

I can turn this into a **Codex-ready V+E execution packet** next, with exact files for the DanteForge repo and the DanteCode repo separately.

Please create the Codex ready V+E Execution Packet Pelase

I’m verifying the current DanteForge and DanteCode layouts from the uploaded zips, then I’ll lock the packet to real paths and pair it with the current Qwen skills/MCP behavior so the handoff is accurate.

I’ve locked the packet to the actual repo split now. The clean boundary is clear: DanteForge should compile/verify/install SkillBridge bundles, and DanteCode should import/activate/execute those bundles locally.

Thought for 2m 18s

Below is the **Codex-ready V+E Execution Packet** for **DanteForge SkillBridge** and the matching **DanteCode runtime/bundle integration**.

The design is locked to the actual uploaded repo split:

* **DanteForge** already behaves like the forge/verifier/distributor layer.  
* **DanteCode** already behaves like the local runtime/consumer layer.

One important design constraint from Qwen’s current docs: **Qwen skills are discovered from `~/.qwen/skills/` and project `.qwen/skills/`, where each skill is a directory containing `SKILL.md` and optional resources/scripts. MCP is configured separately via `mcpServers` in `settings.json`.** That is why this packet treats **`qwen-skill`** and **`qwen-mcp`** as different targets, and only allows `settings.json` mutation during explicit MCP installation, not during plain skill conversion.

---

# **Codex-ready V+E Execution Packet**

## **SB-01 — DanteForge SkillBridge \+ DanteCode Bundle Runtime**

## **0\. Executive call**

Build this.

But build it as **two coordinated systems**, not one tangled feature:

* **DanteForge SkillBridge Compiler**  
  Ingests Claude-style skill sources, normalizes them, verifies them, emits target bundles, installs them.  
* **DanteCode SkillBridge Runtime**  
  Imports compiled bundles into `.dantecode/skills`, registers them locally, exposes them in CLI, activates them safely at runtime.

### **Final repo boundary**

* **DanteForge owns:** source acquisition, parsing, canonical manifest, emitters, verification, installation, scan/discovery  
* **DanteCode owns:** bundle import, registry, local activation, runtime capability warnings, safe execution

This is the correct moat split.

---

# **1\. Purpose**

Create a verified interoperability pipeline that converts **Claude-style `SKILL.md` skills** into:

* **DanteCode bundles**  
* **Qwen-native skill folders**  
* **optional MCP scaffolds**  
* **optional CLI wrappers** only when capability profiling says they are real and safe

The system must avoid fake success.  
A conversion is only “green” if the emitted target is actually installable and usable.

---

# **2\. Scope**

## **In scope**

* local folder input  
* single `SKILL.md` input  
* GitHub repo URL input  
* GitHub tree URL input  
* batch repo traversal  
* canonical normalization into a single intermediate manifest  
* emitters:  
  * `dantecode`  
  * `qwen-skill`  
  * `mcp`  
  * `cli-wrapper` as conditional/amber target  
* verification and scoring  
* installer flows  
* DanteCode bundle import and local runtime registration

## **Out of scope for MVP**

* marketplace publishing  
* background auto-updaters  
* bidirectional reconversion between all agent ecosystems  
* “universal wrapper generation” for every skill regardless of capability fit  
* silent live mutation of Qwen `settings.json` during plain skill conversion

---

# **3\. Product definition**

## **3.1 User-facing thesis**

“Import a Claude skill once, emit verified targets for multiple runtimes.”

## **3.2 Primary commands**

### **DanteForge**

danteforge skills convert \<source\> \--to dantecode,qwen-skill,mcp \--verify  
danteforge skills verify \<bundle-or-source\>  
danteforge skills install \<bundle\> \--target qwen-skill  
danteforge skills install \<bundle\> \--target qwen-mcp  
danteforge skills scan \--source claude \<repo\>

### **DanteCode**

dantecode skills convert \<source\> \--to dantecode  
dantecode skills import-bridge \<bundle\>

### **Why this split exists**

Qwen plain skills are filesystem-discovered and do not need MCP registration; MCP uses `mcpServers` in `settings.json`. So the command surface must separate:

* plain Qwen skill emission/install  
* Qwen MCP install/configuration

---

# **4\. Inputs, outputs, and canonical artifacts**

## **4.1 Inputs**

* GitHub repo URL  
* GitHub tree URL  
* local directory  
* local `SKILL.md`  
* optional flags:  
  * `--batch`  
  * `--to`  
  * `--verify`  
  * `--install`  
  * `--output`  
  * `--allow-settings-mutation`  
  * `--project-root`

## **4.2 Canonical output directory**

Default:

.danteforge/converted/\<skill-slug\>/

## **4.3 Canonical bundle structure**

.danteforge/converted/\<skill-slug\>/  
 skillbridge.json  
 source/  
   SKILL.md  
   support-files/...  
 normalized/  
   normalized-skill.md  
   capability-profile.json  
 targets/  
   dantecode/  
     SKILL.dc.md  
     bundle.json  
     support-files/...  
   qwen-skill/  
     SKILL.md  
     support-files/...  
   mcp/  
     server.ts  
     manifest.json  
     install-snippet.json  
   cli-wrapper/  
     index.ts  
     package.json  
 reports/  
   verification.json  
   conversion-score.json  
   pdse.json

## **4.4 Canonical manifest**

Every conversion must produce `skillbridge.json`.

### **Minimum schema**

{  
 "version": "1",  
 "source": {  
   "kind": "github-tree",  
   "url": "",  
   "repo": "",  
   "commit": "",  
   "path": "",  
   "license": ""  
 },  
 "normalizedSkill": {  
   "name": "",  
   "slug": "",  
   "description": "",  
   "instructions": "",  
   "supportFiles": \[\],  
   "frontmatter": {},  
   "capabilities": {  
     "filesystem": false,  
     "network": false,  
     "shell": false,  
     "mcp": false,  
     "browser": false,  
     "llmRepairNeeded": false  
   },  
   "classification": "instruction-only"  
 },  
 "emitters": {  
   "dantecode": { "status": "success" },  
   "qwenSkill": { "status": "success" },  
   "mcp": { "status": "warning", "warnings": \[\] },  
   "cliWrapper": { "status": "skipped", "warnings": \[\] }  
 },  
 "verification": {  
   "parsePassed": true,  
   "constitutionPassed": true,  
   "antiStubPassed": true,  
   "conversionScore": 0.93  
 },  
 "warnings": \[\]  
}  
---

# **5\. Capability model**

This is mandatory. Do not emit every target blindly.

## **5.1 Skill classes**

### **Class A — instruction-only**

Pure markdown guidance, examples, process instructions.

Allowed emitters:

* `dantecode`  
* `qwen-skill`  
* optional very thin CLI prompt alias

### **Class B — script-assisted**

Has local scripts/resources/templates that can be packaged.

Allowed emitters:

* `dantecode`  
* `qwen-skill`  
* conditional `cli-wrapper`  
* conditional `mcp`

### **Class C — tool-bound workflow**

Assumes shell, browser, repo tools, APIs, or model/tool orchestration.

Allowed emitters:

* `dantecode`  
* `qwen-skill`  
* `mcp` only if tools can be mapped safely  
* `cli-wrapper` usually amber, not green

### **Class D — review-required**

Broken frontmatter, missing support files, invalid structure, impossible tool mapping, unsafe assumptions.

Allowed emitters:

* report only  
* no install  
* no green certification

## **5.2 Capability fields**

export interface CapabilityProfile {  
 filesystem: boolean;  
 network: boolean;  
 shell: boolean;  
 browser: boolean;  
 mcp: boolean;  
 scriptsPresent: boolean;  
 templatesPresent: boolean;  
 llmRepairNeeded: boolean;  
 targetRecommendations: Array\<"dantecode" | "qwen-skill" | "mcp" | "cli-wrapper"\>;  
 riskLevel: "low" | "medium" | "high";  
 classification: "instruction-only" | "script-assisted" | "tool-bound" | "review-required";  
}  
---

# **6\. Verification model**

## **6.1 Existing systems to reuse**

### **DanteForge**

* anti-stub  
* constitution checks  
* verifier flow  
* existing skills scan/import surfaces  
* assistant installer  
* awesome-scan

### **DanteCode**

* skill-adapter  
* registry  
* local `.dantecode/skills`  
* CLI command surface  
* MCP package  
* runtime activation path

## **6.2 New scoring model**

Keep PDSE, but add **SkillBridge Conversion Score**.

### **Scoring dimensions**

* parse completeness  
* frontmatter fidelity  
* instruction fidelity  
* support-file completeness  
* emitter completeness  
* installability  
* runtime compatibility  
* generated code safety  
* target confidence

### **Final bucket**

* **green** — auto-install allowed  
* **amber** — installable with warnings  
* **red** — blocked / manual review required

### **Hard rule**

No target may report `success` unless all expected emitted files exist and pass verification.

---

# **7\. Repo-specific architecture**

## **7.1 DanteForge responsibilities**

### **Existing files to integrate with**

* `src/core/skills.ts`  
* `src/core/skills-import.ts`  
* `src/core/skill-registry.ts`  
* `src/core/assistant-installer.ts`  
* `src/cli/commands/skills-import.ts`  
* `src/cli/commands/awesome-scan.ts`  
* `src/cli/index.ts`  
* `src/cli/commands/index.ts`  
* `src/core/verifier.ts`  
* `src/core/pdse.ts`

### **New module family to add**

src/core/skillbridge/  
 types.ts  
 manifest.ts  
 parser.ts  
 capability-profiler.ts  
 source-resolver.ts  
 source-fetcher.ts  
 verifier.ts  
 emitters/  
   dantecode.ts  
   qwen-skill.ts  
   mcp.ts  
   cli-wrapper.ts  
 installer.ts  
src/cli/commands/skills-convert.ts  
src/cli/commands/skills-verify.ts  
src/cli/commands/skills-install.ts  
tests/skillbridge/

### **Why additive structure is correct**

Do not full-reorg `src/core/skills.ts` and `skills-import.ts` in phase 0\.  
DanteForge already has working skill surfaces. Add SkillBridge beside them, then integrate.

---

## **7.2 DanteCode responsibilities**

### **Existing files to integrate with**

* `packages/skill-adapter/src/importer.ts`  
* `packages/skill-adapter/src/registry.ts`  
* `packages/skill-adapter/src/index.ts`  
* `packages/cli/src/commands/skills.ts`  
* `packages/mcp/src/*`  
* `packages/core/src/skill-wave-orchestrator.ts`

### **New/extended modules**

packages/skill-adapter/src/parsers/skillbridge.ts  
packages/skill-adapter/src/import-bridge.ts  
packages/skill-adapter/src/types/skillbridge.ts  
packages/skill-adapter/src/index.ts  
packages/cli/src/commands/skills.ts   (extend)  
tests / package tests for import-bridge flow

### **Bundle contract for DanteCode**

Imported bridge bundles must land under:

.dantecode/skills/\<skill-slug\>/  
 SKILL.dc.md  
 skillbridge.json  
 support-files/...  
 warnings.json

### **Runtime behavior**

DanteCode must surface capability warnings during activation:

* missing filesystem access assumptions  
* missing shell/tools  
* missing MCP configuration  
* target emitted amber/red

---

# **8\. APIs and library contracts**

## **8.1 DanteForge core exports**

export interface SkillSourceInput {  
 source: string;  
 kind: "local-file" | "local-dir" | "github-repo" | "github-tree";  
 batch?: boolean;  
}

export interface SkillBridgeConvertOptions {  
 to: Array\<"dantecode" | "qwen-skill" | "mcp" | "cli-wrapper"\>;  
 verify?: boolean;  
 outputDir?: string;  
 allowSettingsMutation?: boolean;  
 projectRoot?: string;  
}

export interface SkillBridgeConvertResult {  
 bundleDir: string;  
 manifestPath: string;  
 targets: Record\<string, "success" | "warning" | "skipped" | "blocked"\>;  
 warnings: string\[\];  
 conversionScore: number;  
}

Required functions:

* `resolveSkillSource(input)`  
* `fetchSkillSource(input)`  
* `parseSkillSource(input)`  
* `profileSkillCapabilities(skill)`  
* `emitDanteCodeBundle(manifest)`  
* `emitQwenSkill(manifest)`  
* `emitMcpScaffold(manifest)`  
* `emitCliWrapper(manifest)`  
* `verifySkillBridgeBundle(bundleDir)`  
* `installSkillBridgeTarget(bundleDir, target)`

## **8.2 DanteCode exports**

Required functions:

* `importSkillBridgeBundle(bundleDir, projectRoot)`  
* `registerImportedBridgeSkill(projectRoot, bundleDir)`  
* `listBridgeWarnings(skillName, projectRoot)`  
* `validateBridgeSkill(skillName, projectRoot)`

---

# **9\. Install rules**

## **9.1 Qwen plain skill**

Install path:

* `~/.qwen/skills/<slug>/`  
* or project-local `.qwen/skills/<slug>/`

No `settings.json` mutation required for plain skill install. Qwen documents project `.qwen/skills/` and user skills directories, and describes skills as folders with `SKILL.md` and optional resources/scripts.

## **9.2 Qwen MCP**

Only on explicit install:

* update `mcpServers` in `settings.json`  
* or emit install snippet for manual application

MCP server configuration is handled through `mcpServers` in Qwen settings.

## **9.3 DanteCode install**

Import into local project:

* `.dantecode/skills/<slug>/`  
* register in local registry  
* preserve manifest and warnings

## **9.4 DanteForge project-mode side effects**

`STATE.yaml`, lessons, and audit updates are only allowed when:

* a DanteForge project root is detected  
* and the user invoked project-mode verification/install

Do not mutate DanteForge project state for generic third-party public skill conversions by default.

---

# **10\. Performance and SLOs**

## **Conversion SLOs**

* single local skill parse \+ normalize: under 1 second typical  
* single local skill emit for `dantecode,qwen-skill`: under 3 seconds typical  
* remote GitHub tree/repo conversions exclude network time from core conversion SLO  
* `verify` must never mark success on missing files  
* 95% parse success target on real Claude-style corpus  
* 80% zero-manual-edit target for `qwen-skill` and `dantecode`  
* 0 silent partial-success conversions

## **Reliability SLOs**

* no installer may claim success unless target files are present and verified  
* no MCP settings mutation unless explicit install target chosen  
* no CLI wrapper green status unless capability profile allows it

---

# **11\. Golden flows**

## **GF-01 — Local Claude skill → Qwen skill**

Input:

* local folder with valid `SKILL.md`

Pass:

* `skillbridge.json` created  
* `targets/qwen-skill/SKILL.md` emitted  
* install to `~/.qwen/skills/<slug>/`  
* no `settings.json` mutation

## **GF-02 — GitHub tree URL → DanteCode bundle**

Input:

* GitHub tree URL targeting one skill folder

Pass:

* source acquired and verified  
* `targets/dantecode/SKILL.dc.md` emitted  
* `dantecode skills import-bridge <bundle>` succeeds  
* skill appears in registry

## **GF-03 — Batch repo scan → mixed class outputs**

Input:

* repo with multiple skills

Pass:

* each skill classified green/amber/red  
* green auto-install allowed  
* amber emits warnings  
* red blocked with reasons

## **GF-04 — Skill with clear executable contract → MCP scaffold**

Input:

* skill with explicit executable/tool shape

Pass:

* MCP scaffold emitted  
* Qwen MCP install snippet emitted  
* no settings mutation unless `install --target qwen-mcp`

## **GF-05 — Runtime activation in DanteCode**

Input:

* imported bundle

Pass:

* `dantecode skills list` shows it  
* `dantecode skills show <name>` shows bridge metadata  
* runtime surfaces warnings if capability assumptions are unmet

---

# **12\. Generation plan**

## **Track A — DanteForge SkillBridge Compiler**

### **DF-01 — Contracts spine**

Files:

* `src/core/skillbridge/types.ts`  
* `src/core/skillbridge/manifest.ts`  
* `tests/skillbridge/contracts.test.ts`

Deliver:

* all core interfaces  
* manifest validator  
* no emitters yet

Acceptance:

* types compile  
* manifest round-trip test passes

---

### **DF-02 — Source resolution**

Files:

* `src/core/skillbridge/source-resolver.ts`  
* `src/core/skillbridge/source-fetcher.ts`  
* `tests/skillbridge/source-resolution.test.ts`

Deliver:

* detect local file, local dir, GitHub repo URL, GitHub tree URL  
* fetch/acquire to temp or output staging  
* verify source existence before parse

Acceptance:

* local file/dir supported  
* GitHub repo/tree normalized  
* missing sources fail closed

---

### **DF-03 — Parser \+ normalized markdown**

Files:

* `src/core/skillbridge/parser.ts`  
* `tests/skillbridge/parser.test.ts`

Deliver:

* parse frontmatter  
* extract instructions  
* collect support files  
* generate normalized markdown representation

Acceptance:

* valid skills parse  
* malformed skills produce review-required status, not false success

---

### **DF-04 — Capability profiler**

Files:

* `src/core/skillbridge/capability-profiler.ts`  
* `tests/skillbridge/capability-profiler.test.ts`

Deliver:

* classify Class A/B/C/D  
* target recommendations  
* risk level

Acceptance:

* corpus examples map to expected classes  
* unsupported workflows flagged amber/red

---

### **DF-05 — Qwen emitter**

Files:

* `src/core/skillbridge/emitters/qwen-skill.ts`  
* `tests/skillbridge/qwen-emitter.test.ts`

Deliver:

* emit Qwen skill folder  
* include `SKILL.md`  
* include support files/resources  
* install helper for `~/.qwen/skills` / project `.qwen/skills`

Acceptance:

* folder structure matches Qwen’s documented skills layout  
* plain install does not touch `settings.json`

---

### **DF-06 — DanteCode emitter**

Files:

* `src/core/skillbridge/emitters/dantecode.ts`  
* `tests/skillbridge/dantecode-emitter.test.ts`

Deliver:

* emit `SKILL.dc.md`  
* emit `bundle.json`  
* emit support files  
* emit warnings payload

Acceptance:

* bundle imports cleanly into DanteCode fixture structure

---

### **DF-07 — MCP emitter**

Files:

* `src/core/skillbridge/emitters/mcp.ts`  
* `tests/skillbridge/mcp-emitter.test.ts`

Deliver:

* emit scaffold only  
* transport metadata  
* install snippet for Qwen `mcpServers`  
* no silent settings mutation

Acceptance:

* scaffold generated only for compatible skills  
* incompatible skills become warning/blocked

---

### **DF-08 — CLI wrapper emitter**

Files:

* `src/core/skillbridge/emitters/cli-wrapper.ts`  
* `tests/skillbridge/cli-wrapper-emitter.test.ts`

Deliver:

* only emit for Class A/B where safe  
* no fake universal wrapper

Acceptance:

* tool-bound workflows do not get green CLI wrapper success unless proven

---

### **DF-09 — Bundle verifier**

Files:

* `src/core/skillbridge/verifier.ts`  
* `tests/skillbridge/verifier.test.ts`

Deliver:

* verify files exist  
* verify target completeness  
* calculate conversion score  
* integrate anti-stub \+ constitution \+ PDSE for generated outputs where applicable

Acceptance:

* no target can claim success on missing files  
* green/amber/red buckets emitted

---

### **DF-10 — Installer**

Files:

* `src/core/skillbridge/installer.ts`  
* `tests/skillbridge/installer.test.ts`

Deliver:

* install Qwen skill  
* install Qwen MCP with explicit opt-in  
* install DanteForge packaged or project-mode outputs as appropriate

Acceptance:

* install paths are correct  
* settings mutation only on explicit MCP install

---

### **DF-11 — CLI command surface**

Files:

* `src/cli/commands/skills-convert.ts`  
* `src/cli/commands/skills-verify.ts`  
* `src/cli/commands/skills-install.ts`  
* `src/cli/commands/index.ts`  
* `src/cli/index.ts`

Deliver:

* new command surface  
* help text  
* clean exit codes

Acceptance:

* commands appear in CLI  
* happy path and error path tested

---

### **DF-12 — Scan integration**

Files:

* `src/cli/commands/awesome-scan.ts`  
* `src/core/skill-registry.ts`  
* `tests/skillbridge/scan-integration.test.ts`

Deliver:

* `--source claude`  
* repo batch scan path  
* discovery report with green/amber/red

Acceptance:

* scan reports do not install by accident  
* external skill findings can be passed into convert

---

## **Track B — DanteCode Bundle Runtime**

### **DC-01 — Bundle types \+ parser**

Files:

* `packages/skill-adapter/src/types/skillbridge.ts`  
* `packages/skill-adapter/src/parsers/skillbridge.ts`  
* `packages/skill-adapter/src/parsers/parsers.test.ts`

Deliver:

* parse `skillbridge.json`  
* validate bundle structure  
* parse `targets/dantecode/`

Acceptance:

* invalid bundles fail cleanly  
* valid bundles parsed into registry-ready structures

---

### **DC-02 — Import bridge bundle**

Files:

* `packages/skill-adapter/src/import-bridge.ts`  
* `packages/skill-adapter/src/index.ts`  
* `packages/skill-adapter/src/importer.test.ts`

Deliver:

* import compiled bundle into `.dantecode/skills/<slug>/`  
* preserve manifest and warnings

Acceptance:

* imported bridge bundle lands in expected structure  
* metadata retained

---

### **DC-03 — Registry integration**

Files:

* `packages/skill-adapter/src/registry.ts`  
* `packages/skill-adapter/src/registry.test.ts`

Deliver:

* registry understands bridge-installed bundles  
* expose source \= `skillbridge`  
* show warnings and conversion score

Acceptance:

* `listSkills` includes imported bridge bundle  
* `getSkill` can show origin metadata

---

### **DC-04 — CLI integration**

Files:

* `packages/cli/src/commands/skills.ts`  
* CLI tests in package

Deliver:

* `dantecode skills import-bridge <bundle>`  
* optional `dantecode skills convert <source> --to dantecode` façade that shells into or links against DanteForge conversion logic

Acceptance:

* bundle import works from CLI  
* clear output for warnings and target confidence

---

### **DC-05 — Runtime warning surface**

Files:

* `packages/core/src/skill-wave-orchestrator.ts`  
* related tests

Deliver:

* activation warnings for unmet assumptions  
* bridge metadata available to runtime  
* do not silently claim full execution compatibility

Acceptance:

* if a skill assumes shell/browser/MCP and current runtime lacks it, the user is warned before or during activation

---

## **Track C — End-to-end weld**

### **E2E-01**

* local skill → DanteForge convert → DanteCode import → local list/show

### **E2E-02**

* local skill → DanteForge convert/install → Qwen skill folder present

### **E2E-03**

* batch repo → report only, mixed output classes

### **E2E-04**

* skill → MCP scaffold → explicit Qwen MCP install snippet

---

# **13\. CI and gate sheet**

## **DanteForge gates**

* `npm run build`  
* `npm run typecheck`  
* `npm run lint`  
* `npm run test`  
* `npm run verify`

## **DanteCode gates**

* root build  
* root typecheck  
* root lint  
* root test  
* smoke on `dantecode skills`

## **Hard gates**

* no file marked success unless emitted files exist  
* no silent Qwen `settings.json` mutation during plain skill conversion  
* no universal fake CLI wrapper success  
* no duplicate compiler logic in DanteCode  
* no project-state mutation in standalone conversion mode  
* no stubbed MCP scaffold marked green

---

# **14\. JSONL / evidence examples**

## **14.1 Conversion audit event**

{"at":"2026-03-20T12:00:00Z","kind":"skillbridge.convert.started","level":"info","actor":"danteforge","data":{"source":"https://github.com/example/repo/tree/main/skills/web-scraper","targets":\["dantecode","qwen-skill","mcp"\]}}  
{"at":"2026-03-20T12:00:01Z","kind":"skillbridge.profile.completed","level":"info","actor":"danteforge","data":{"slug":"web-scraper","classification":"tool-bound","riskLevel":"medium"}}  
{"at":"2026-03-20T12:00:02Z","kind":"skillbridge.emit.completed","level":"info","actor":"danteforge","data":{"slug":"web-scraper","targets":{"dantecode":"success","qwen-skill":"success","mcp":"warning"}}}  
{"at":"2026-03-20T12:00:03Z","kind":"skillbridge.verify.completed","level":"info","actor":"danteforge","data":{"slug":"web-scraper","conversionScore":0.91,"bucket":"amber"}}

## **14.2 DanteCode import event**

{"at":"2026-03-20T12:05:00Z","kind":"skillbridge.import.started","level":"info","actor":"dantecode","data":{"bundleDir":".danteforge/converted/web-scraper"}}  
{"at":"2026-03-20T12:05:01Z","kind":"skillbridge.import.completed","level":"info","actor":"dantecode","data":{"slug":"web-scraper","targetDir":".dantecode/skills/web-scraper","warnings":\["mcp target requires explicit config install"\]}}  
---

# **15\. Risks and mitigations**

## **Risk 1 — Treating all skills as equally translatable**

Mitigation:

* capability profiler  
* green/amber/red target statuses  
* review-required classification

## **Risk 2 — Wrong Qwen assumptions**

Mitigation:

* distinguish `qwen-skill` from `qwen-mcp`  
* no settings mutation for plain skill install  
* explicit Qwen install tests against documented structure

## **Risk 3 — Compiler duplicated in DanteCode**

Mitigation:

* DanteCode only imports bundles or calls the Forge surface  
* all canonical normalization lives in DanteForge

## **Risk 4 — CLI wrapper overpromising**

Mitigation:

* emit only when capability profile allows  
* otherwise warning/skipped

## **Risk 5 — Converted skill imports fine but runs badly**

Mitigation:

* DanteCode surfaces runtime capability warnings  
* tie future high-confidence execution to deterministic tool runtime hardening

---

# **16\. Runbook**

## **Step 1**

Implement **DF-01 through DF-04** first.  
Do not touch installers before manifest \+ parser \+ profiler are stable.

## **Step 2**

Ship **DF-05 and DF-06** next.  
Qwen skill emitter and DanteCode emitter are the real MVP.

## **Step 3**

Only then add **DF-07 and DF-08**.  
MCP and CLI wrapper are higher-risk targets.

## **Step 4**

Implement **DF-09 through DF-11** to harden verification and CLI surfaces.

## **Step 5**

Implement **DC-01 through DC-04** so DanteCode can consume the bundles.

## **Step 6**

Implement **DC-05** to make runtime honesty visible.

## **Step 7**

Run golden flows and corpus tests before any public announcement.

---

# **17\. “Done” definition**

This packet is complete only when all are true:

1. DanteForge can convert a valid Claude-style skill into:  
   * a DanteCode bundle  
   * a Qwen skill folder  
2. Qwen plain skill install works without `settings.json` mutation  
3. Qwen MCP output requires explicit install/config path  
4. DanteCode can import the compiled bundle into `.dantecode/skills`  
5. DanteCode registry shows bundle origin, warnings, and score  
6. batch scan produces green/amber/red classifications  
7. no target reports false green success  
8. CLI wrapper is only emitted when genuinely supported  
9. all command/help/test/build/typecheck gates pass in both repos

---

# **18\. Codex handoff prompt**

Use this prompt with Codex exactly as the execution brief.

You are implementing SB-01: DanteForge SkillBridge \+ DanteCode Bundle Runtime.

Goal:  
Build a canonical skill conversion pipeline in DanteForge that ingests Claude-style SKILL.md sources, normalizes them into a single intermediate manifest, verifies them, and emits verified targets for DanteCode, Qwen Skill folders, and optional MCP/CLI wrapper targets. Then add DanteCode bundle import/runtime support for those compiled bundles.

Hard architectural split:  
\- DanteForge owns source acquisition, normalization, emitters, verification, install  
\- DanteCode owns bundle import, registry, local activation, runtime warnings  
\- Do NOT duplicate compiler logic inside DanteCode

Critical Qwen rules:  
\- Plain Qwen skills are folders containing SKILL.md under \~/.qwen/skills/ or project .qwen/skills/  
\- Plain Qwen skill conversion/install must NOT mutate settings.json  
\- MCP servers are configured separately via mcpServers in settings.json  
\- Only explicit qwen-mcp install may touch MCP config

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- Files under 500 LOC where practical  
\- Add tests in every generation  
\- Fail closed  
\- No fake success states  
\- No silent partial target success  
\- No project-state mutation in standalone conversion mode  
\- Do not emit green CLI wrappers for unsupported tool-bound skills

Implement in this order:

Track A — DanteForge  
1\. src/core/skillbridge/types.ts  
2\. src/core/skillbridge/manifest.ts  
3\. src/core/skillbridge/source-resolver.ts  
4\. src/core/skillbridge/source-fetcher.ts  
5\. src/core/skillbridge/parser.ts  
6\. src/core/skillbridge/capability-profiler.ts  
7\. src/core/skillbridge/emitters/qwen-skill.ts  
8\. src/core/skillbridge/emitters/dantecode.ts  
9\. src/core/skillbridge/emitters/mcp.ts  
10\. src/core/skillbridge/emitters/cli-wrapper.ts  
11\. src/core/skillbridge/verifier.ts  
12\. src/core/skillbridge/installer.ts  
13\. src/cli/commands/skills-convert.ts  
14\. src/cli/commands/skills-verify.ts  
15\. src/cli/commands/skills-install.ts  
16\. integrate with src/cli/commands/index.ts and src/cli/index.ts  
17\. add awesome-scan / registry integration

Track B — DanteCode  
1\. packages/skill-adapter/src/types/skillbridge.ts  
2\. packages/skill-adapter/src/parsers/skillbridge.ts  
3\. packages/skill-adapter/src/import-bridge.ts  
4\. extend packages/skill-adapter/src/registry.ts  
5\. extend packages/skill-adapter/src/index.ts  
6\. extend packages/cli/src/commands/skills.ts  
7\. surface bridge warnings in runtime activation paths

Canonical artifact:  
Every conversion must emit skillbridge.json as the source of truth.

Manifest requirements:  
\- source metadata  
\- normalized skill  
\- capability profile  
\- target emission statuses  
\- verification score  
\- warnings

Required target structure:  
\- targets/dantecode/  
\- targets/qwen-skill/  
\- targets/mcp/  
\- targets/cli-wrapper/  
\- reports/

Golden flows:  
\- local skill \-\> qwen skill  
\- github tree url \-\> dantecode bundle  
\- batch repo \-\> mixed green/amber/red  
\- skill \-\> mcp scaffold with explicit install path  
\- dantecode import-bridge \-\> list/show/validate

At the end of every generation report:  
\- files changed  
\- tests added  
\- gates passed/failed  
\- risks  
\- next generation

Do not claim completion unless both repos pass build/typecheck/test for the touched surfaces.  
---

# **19\. Final judgment**

This is one of the stronger feature directions you have.

The real moat is **not** “we convert to Qwen.” Qwen skills are relatively straightforward because their filesystem skill model is simple and documented. The real moat is that **DanteForge becomes the canonical verifier and emitter of trustworthy cross-runtime skill bundles**, while DanteCode becomes the best local runtime for consuming them.

The next implementation move should be **DF-01 through DF-04 only**, not the whole system in one leap.

**Addendum to ChatGPT’s SkillBridge V+E Execution Packet**  
**Author:** Grok  
**Date:** 2026-03-20

**Purpose:** This 2-page addendum adds the **missing half of the vision** from Richard’s screenshot (Codex \+ Claude Code \+ Antigravity/Gemini \+ DanteCode all open on the same repo). It turns SkillBridge into a complete system: universal skill converter **\+** live multi-agent Git orchestration with intelligent merge.

Read this **after** ChatGPT’s packet. It reuses everything ChatGPT defined (canonical skillbridge.json, capability profiler, repo split, Qwen rules) and adds the parallel-agent safety layer without changing any of ChatGPT’s boundaries.

### **1\. New Phase 2 – Multi-Agent Git Orchestrator (Screenshot Vision)**

**Goal**

When two+ council members (Codex, Claude Code, Antigravity, DanteCode) edit the same file in parallel worktrees, DanteCode automatically:

* Detects the overlap  
* Reviews both versions with PDSE scoring  
* Merges them intelligently (preserves intent, removes duplicates)  
* Creates one clean commit  
* Pushes to git

This is the feature that makes the screenshot your daily workflow instead of a demo.

**How it reuses ChatGPT’s work**

* Every converted skill already has skillbridge.json \+ capability profile.  
* The orchestrator reads that manifest to know what each agent is allowed to touch.  
* NOMA enforcement, worktree isolation, audit log, and lessons.md are already in DanteForge v0.8.0.

**New command (added to DanteForge CLI)**

Bash

```
danteforge party --orchestrate          # turns on live watcher across all agents
danteforge merge --auto                 # manual trigger for current conflicts
```

### **2\. OSS We Learn From (Exact Lessons)**

* **Gas Town** (steveyegge/gastown) → Persistent git worktree coordination for multiple Claude agents (our watcher foundation).  
* **Agent Orchestrator** (ComposioHQ/agent-orchestrator) → Parallel agents in isolated worktrees \+ auto conflict handling (exact screenshot pattern).  
* **Parallel Code** (johannesjo/parallel-code) → Side-by-side agents with worktrees (copy their detection logic).  
* **Merge Resolver** (roshan-acharya/Merge-Resolver) → AI-powered block-level merge (feed both versions to PDSE).  
* **mergiraf** (mergiraf/mergiraf) → Syntax-aware merge driver (hybrid with our LLM step).

We take \< 10 files total from these repos.

### **3\. File Additions (Additive Only — No Reorg)**

**DanteForge (add these 4 files first):**

text

```
src/core/git-orchestrator/
  watcher.ts              ← monitors worktrees + file changes
  merger.ts               ← PDSE + entity-level intelligent merge
  conflict-resolver.ts    ← uses skillbridge.json + capability profile
  index.ts                ← hooks into party mode
```

**DanteCode (add 1 file):**

text

```
packages/skill-adapter/src/git-merge-bridge.ts  ← calls DanteForge orchestrator
```

**Integration points (touch these last):**

* src/cli/commands/party.ts (add \--orchestrate flag)  
* src/core/autoforge.ts (wire into Magic presets)

### **4\. Council Starter Build Order (Start Here)**

**Day 1 – Contracts \+ Watcher (4 files)**

1. src/core/git-orchestrator/types.ts (reuse ChatGPT’s manifest \+ add GitEvent)  
2. src/core/git-orchestrator/watcher.ts (start with simple worktree polling)  
3. src/core/git-orchestrator/merger.ts (basic 3-way merge using PDSE)  
4. src/cli/commands/party.ts (add \--orchestrate flag \+ hook)

**Golden Flow to Test First**

* Open Codex and Claude Code side-by-side on the same repo (your screenshot).  
* Both edit the same file.  
* Run danteforge party \--orchestrate.  
* DanteCode should detect, review, merge, and commit.

**Codex Handoff Prompt (copy-paste this to Codex)**

text

```
You are implementing Phase 2 of SkillBridge: Multi-Agent Git Orchestrator.

Requirements:
- Build src/core/git-orchestrator/ (additive only)
- Reuse skillbridge.json + capability profiler from Phase 1
- Detect overlaps across worktrees
- Use PDSE to compare intent and merge cleanly
- One atomic commit + push
- No duplicate work

Start with:
1. src/core/git-orchestrator/types.ts
2. src/core/git-orchestrator/watcher.ts
3. src/core/git-orchestrator/merger.ts
4. Update party.ts with --orchestrate flag

Golden flow: two agents edit same file → auto-merge → clean commit.

Report files changed + tests added after each generation.
```

This addendum \+ ChatGPT’s packet gives the council everything they need to start building **today** — no gaps, no overlap, full screenshot vision included.

Copy this entire message and send it to the council. When they finish the first 4 files, ping me and I’ll give the next batch (merger logic \+ DanteCode bridge).

We’re ready. Let’s ship it.

