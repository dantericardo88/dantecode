# DanteCode: The Vision

**Version:** 1.0  
**Date:** March 22, 2026  
**Author:** Ricky, Real Empanada Company  
**Classification:** North Star — every PRD, every feature, every decision traces back to this document

---

## The Insight

For the entire history of software, building a product required knowing how to code. If you had an idea, you had two options: learn to code yourself, or hire someone who could. Both paths demanded technical literacy — either to write the code or to evaluate the people writing it.

This created a gate. On one side: the 5% who can code. On the other side: the 95% who have ideas, domain expertise, taste, vision, and the ability to describe what they want — but no way to build it. Every product that was never built, every business that was never started, every problem that was never solved because the person who understood the problem couldn't write the code — that's the cost of the gate.

AI coding tools have started to open this gate, but they opened it facing the wrong direction. Claude Code, Cursor, Copilot, Aider — they all make the 5% faster. They're power tools for people who already know how to use the workshop. The 95% still can't walk in.

DanteCode opens the gate for the 95%.

---

## The Mission

**Separate knowing what to build from knowing how to build it.**

A person who can clearly describe what they want, evaluate whether they got it, and direct resources to close the gap should be able to build production-quality software — without writing a line of code, without understanding a line of code, and without trusting blindly that the code is correct.

---

## The Three Problems We Solve

### Problem 1: The Trust Gap

When an AI writes code for a non-technical person, the person has no way to know if the code is good. They can't read it. They can't review it. They can't tell a stub from a real implementation, a security vulnerability from a best practice, or a prototype from production code.

Every other AI coding tool assumes the user can evaluate the output. DanteCode assumes they can't.

**Our solution: DanteForge — mechanical verification that earns trust without requiring understanding.**

DanteForge doesn't ask the user to review code. It reviews the code itself — catching stubs, enforcing policies, scoring quality, and blocking bad output before the user ever sees it. The user sees one sentence: "Verified — no issues found" or "Caught 2 problems and fixed them." They don't need to understand what was caught. They need to trust that something is watching.

This is the core moat. It's the reason DanteCode exists instead of being a wrapper around Claude Code. Every competitor assumes a technical user who can evaluate output. We assume a non-technical user who needs a trust layer. That single assumption changes everything downstream.

### Problem 2: The Coordination Gap

Building real software requires coordinating multiple tools, multiple AI sessions, multiple codebases, and multiple concerns (frontend, backend, database, deployment, testing). Technical people coordinate this through expertise — they know what to do next because they've done it before.

Non-technical people don't have this expertise. They need a process that tells them what to do, when to do it, and what to carry between workspaces. They need a system where the AIs coordinate with each other through documents that the human transports but doesn't need to understand.

**Our solution: The Postal Service — a cross-workspace coordination protocol designed for non-technical operators.**

The human carries three types of documents between AI workspaces: PRDs (what to build), Run Reports (what was built), and Bug Reports (what went wrong). Each document is produced by one AI and consumed by another. The human never translates — they transport. The AIs on both ends speak the same language. The human is the envelope, not the editor.

### Problem 3: The Complexity Gap

Software has layers: architecture, infrastructure, security, testing, deployment, monitoring. Technical people manage this complexity through mental models built over years of experience. They know what a database schema should look like because they've seen a thousand of them.

Non-technical people don't have these mental models. When AI tools expose this complexity (69 slash commands, PDSE thresholds, GStack configurations, provider routing tables), the 95% bounces off. They don't need to understand the machinery — they need the machinery to work invisibly.

**Our solution: Progressive disclosure with invisible defaults.**

DanteCode has 23 packages, 206K lines of code, and deep infrastructure for verification, memory, evidence chains, debug trails, skill portability, and multi-agent orchestration. The user sees none of this. They see a prompt that says "what do you want to build?" and a verification line that says "done, no problems." The complexity exists to serve them, not to impress them.

Every feature is invisible until the user needs it. Every default is chosen so the user never has to choose. Every output is translated from engineering metrics into human sentences. The 5% can dig deeper if they want. The 95% never need to.

---

## Who We Serve

### Primary: The Non-Technical Builder

A person who has an idea for a software product but cannot code. They might be:

- An entrepreneur who understands their market but not programming
- A domain expert (doctor, teacher, lawyer, chef, artist) who knows exactly what tool their field needs
- A small business owner who wants custom software but can't afford a development team
- A product person who can write specs but has always needed engineers to implement them
- A student with a vision but no CS degree

They can describe what they want in plain language. They can evaluate whether the result matches their vision. They can make product decisions (this button should be blue, this flow should be simpler, this feature isn't needed). What they cannot do is write code, read code, debug code, or evaluate code quality.

**DanteCode is their engineering team.**

### Secondary: The Developer Who Wants Verification

A working programmer who uses AI coding tools but doesn't trust the output. They've been burned by hallucinated code, silent stubs, subtle bugs that only appear in production. They want a tool that checks the AI's work before it lands.

This user benefits from DanteForge's verification layer, the evidence chain, and the constitutional checks. They'll use the power-user features (PDSE scoring, GStack configuration, custom verification rails). They're the 5% — important, but not why we exist.

### We do not serve: Developers who want faster autocomplete

If someone wants tab-completion in their IDE, Cursor exists. If someone wants inline AI suggestions while they type, Copilot exists. If someone wants a chat-based coding assistant, Claude Code exists. We don't compete with these tools on speed or convenience for the coding workflow. We compete on trust for the non-coding workflow.

---

## The Product Principles

These principles govern every decision. When two options are equally valid, these break the tie.

### Principle 1: If the user has to understand code, we failed

Every output, every error message, every status update, every report must be comprehensible to someone who has never seen a line of code. If a feature requires technical knowledge to use, it's either hidden behind progressive disclosure or it's redesigned until it doesn't.

Test: Show the output to someone who doesn't code. If they say "what does this mean?" — rewrite it.

### Principle 2: Verification is the product, not the feature

Other tools treat code generation as the product and verification as optional. We treat verification as the product and code generation as the commodity. Any LLM can generate code. Only DanteCode tells you whether the code is trustworthy. The moment verification feels like friction instead of value, we've lost the thread.

Test: After every verification output, does the user trust DanteCode more? If not — the output isn't communicating what was caught and why it matters.

### Principle 3: The human transports, the AIs translate

The user should never be asked to make a technical judgment call. They should never be asked to "edit the config," "check the output," "run the tests," or "fix the error." They should only be asked to carry documents between AI workspaces and make product decisions (what to build, whether they like the result, what to change). Every technical decision is made by an AI. Every product decision is made by the human.

Test: Remove every instruction that requires the user to understand what they're doing. If the process still works — good. If it breaks — the process depends on technical knowledge it shouldn't.

### Principle 4: Defaults are decisions

Every default value is a product decision that 95% of users will never change. Defaults aren't "safe starting points" — they're permanent choices for most users. This means defaults must be correct, not conservative. If the project is Python, the default test runner must be pytest, not "please configure your test runner." If the user has one API key, the default provider must be that provider, not "please select a provider."

Test: Can a user go from install to working output without changing a single setting? If not — the defaults are wrong.

### Principle 5: Subtract before you add

Every feature that exists is a feature that can confuse, break, or slow down. Before adding anything, ask: can we solve this by removing something else? The 95% doesn't want more options — they want fewer decisions. The power of the product is in what it handles invisibly, not in what it exposes.

Test: After adding a feature, is the `/help` output longer? If yes — the feature should probably be invisible.

### Principle 6: The run report is the receipt

When a user asks DanteCode to build something, they deserve an honest accounting of what happened. Not "done." Not a score. A plain-language report that says: here's what I built, here's what I caught and fixed, here's what failed and why, here's what you need to do next. This report is the trust contract between DanteCode and the user. If the report lies, the trust is broken and the product is worthless.

Test: Can a non-technical user read the run report and explain to someone else what DanteCode did? If not — the report isn't clear enough.

---

## The Competitive Position

### What we are NOT

- We are not a faster way to write code (that's Copilot)
- We are not a better IDE integration (that's Cursor)
- We are not a developer chat assistant (that's Claude Code)
- We are not a git-integrated AI pair programmer (that's Aider)

### What we ARE

- We are the first AI coding tool built for people who don't code
- We are the first to make verification the product, not the feature
- We are the first to provide a trust layer between AI-generated code and non-technical users
- We are the first to define a cross-workspace coordination protocol for AI-driven development

### Why this can't be easily copied

The moat is not the code — it's the design philosophy. Any company can build a verification layer. But building a verification layer that's designed from day one for non-technical users requires rethinking every assumption that AI coding tools make about their users. The 69 slash commands exist because every AI coding tool assumes a technical user. Reducing them to 13 requires deciding that the non-technical user matters more than feature completeness. That's a strategic decision that companies serving the 5% will never make — it would alienate their core users.

Claude Code will always prioritize the developer experience because Anthropic's customers are developers. Cursor will always prioritize IDE integration because their users live in IDEs. Copilot will always prioritize autocomplete because that's what Microsoft's enterprise customers want. None of them will optimize for someone who can't code — because optimizing for the 95% means de-optimizing for the 5%, and their businesses run on the 5%.

We don't have that constraint. We're built for the 95% from the ground up. That's not a feature advantage — it's an architectural advantage that gets deeper with every decision we make.

---

## The Flywheel

The billion-dollar outcome requires a flywheel — a self-reinforcing cycle where each turn makes the next turn easier.

```
More non-technical users build software with DanteCode
  → More real-world usage data on what fails and what confuses
    → Better verification, better defaults, better reports
      → Higher trust from non-technical users
        → More non-technical users build software with DanteCode
```

The flywheel has a second loop for the skill ecosystem:

```
Non-technical users build successful products
  → Successful products become skill templates
    → New users start from proven templates instead of blank pages
      → Faster time-to-value for new users
        → More non-technical users build software with DanteCode
```

And a third loop for the developer ecosystem:

```
Developers see non-technical users building real products
  → Developers adopt DanteCode for verification features
    → Developer contributions improve the verification engine
      → Better verification attracts more non-technical users
```

The first loop (usage → trust) is what we're building now. The second loop (templates) comes after we have 100+ users. The third loop (developer ecosystem) comes after we have 1,000+ users. We don't need all three to start — we need the first one to be spinning before we invest in the others.

---

## The Decision Framework

When making any product decision, ask these questions in order:

**Question 1: Does this serve the 95% or the 5%?**
If it serves the 5%, it goes behind progressive disclosure or it doesn't get built. The 5% has options. The 95% has only us.

**Question 2: Does this require the user to understand code?**
If yes, redesign it until it doesn't. No exceptions.

**Question 3: Does this increase or decrease the number of decisions the user makes?**
Fewer decisions is always better. If a feature adds a choice, it must remove two others.

**Question 4: Does this make the run report more honest?**
The run report is the trust contract. Anything that makes it more honest is high priority. Anything that makes it less honest is a bug.

**Question 5: Does this make the first 5 minutes better?**
The first 5 minutes determines whether a user stays. Every feature that doesn't improve the first 5 minutes is a feature that serves existing users, not new ones. Both matter — but new users create the flywheel.

---

## What Success Looks Like

**In 6 months:** 100 non-technical users have built and deployed a working software product using DanteCode. The average time from install to first useful output is under 2 minutes. The Postal Service workflow is documented and followed by every user.

**In 18 months:** 10,000 users. A skill template marketplace exists with 200+ starter projects. DanteCode is the default recommendation when someone asks "I have an idea for an app but I can't code — where do I start?"

**In 3 years:** 100,000 users. DanteCode is to software what Canva is to graphic design — the tool that made an entire profession's skill set accessible to everyone. The 95% builds software the same way they currently write documents or make slides: by describing what they want and refining the result.

**The billion-dollar marker:** When "I built this with DanteCode" is as common and unremarkable as "I made this in Canva" — we've won.

---

## How to Use This Document

This document is not a PRD. It doesn't have deliverables or acceptance tests. It's a filter.

Every future PRD must reference this document and explain which principle it serves. Every feature proposal must answer the five decision framework questions. Every scoring matrix must include Score C (User Experience) and Score D (Distribution) alongside the engineering metrics.

If a proposed feature serves the 5% at the expense of the 95%, this document is the reason to say no.

If a design decision makes the product more complex in ways the user must understand, this document is the reason to simplify.

If the run report says "PDSE 94/100" instead of "Verified — no problems found," this document is the reason to rewrite it.

This is the north star. Everything else is navigation.
