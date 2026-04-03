# DanteCode Vision

## Product statement

DanteCode is a coding agent built for people who cannot read code.

Most AI coding tools accelerate developers — the 5% who already know what correct code looks like. DanteCode exists for the other 95%: founders, designers, operators, and domain experts who have ideas worth building but no ability to verify whether the AI actually built them correctly.

The goal is not to generate code faster. The goal is to make AI-generated code trustworthy for people who will never read it.

## Core thesis

Code generation is a commodity. Every model can produce code. The unsolved problem is the trust gap: when a non-technical user tells an AI "build me X" and the AI says "done," the user has no way to know if it actually did the job, cut corners, or silently failed.

DanteCode closes that gap with machine-verified evidence. Not "trust me" — trust the verification receipt, the anti-stub scan, the PDSE score, the run report written in plain language.

The moat is verification, not generation. Any model can write a login page. Only a verification layer can tell you whether the password hashing is real or a stub that returns the input unchanged.

## Strategic position

- Default provider: Grok
- Product identity: model-agnostic, user-agnostic
- Verification layer: DanteForge
- Main wedge: trustworthy AI output for people who cannot audit it themselves

Grok is the default because it is the clearest market gap today. Model portability matters because users should never be trapped by a provider. If your workflows, skills, and verification history only work with one model, you are locked in — and non-technical users are the least equipped to migrate when that lock-in becomes a problem.

## What DanteForge does

DanteForge is the trust engine that lets non-technical users rely on AI output:

- **Anti-stub enforcement**: catches functions that look complete but do nothing
- **PDSE scoring**: a single number (0-100) that answers "did the AI actually do the work?"
- **Constitution checks**: ensures output follows safety and quality rules
- **GStack validation**: verifies structural correctness across the codebase
- **Run reports**: plain-language accounting of what was built, what failed, and what needs attention

The user never reads the code. They read the report and the score. If DanteForge says the score is 85 and the report says "3 of 4 features complete, auth needs retry," that is enough to act on — no technical knowledge required.

## Principles

- **Verification first**: every generated artifact must prove itself before being trusted. The user's confidence comes from evidence, not from the AI claiming "done."
- **Plain-language surface**: scores, reports, and status must be legible to someone who has never opened a terminal before today.
- **Portable by default**: skills, workflows, and verification history travel with the user across models and providers. No lock-in, ever.
- **Honest failure reporting**: partial completions, crashes, and low-confidence results are reported explicitly. Silent failure is the enemy of non-technical users because they have no other way to detect it.
- **Crash-safe accountability**: run reports are written even on failure. If DanteCode crashes, the user still has a record of what happened.

## Non-goals

- Replacing developers for complex systems architecture
- Full enterprise release automation in v1
- Perfect live-provider parity before the first public release
- Marketing-grade polish over honest capability reporting
- Building features exclusively for the 5% who already have technical fluency

## Success signals

- A non-technical founder can run `/party` on a set of PRDs and know — from the report and score alone — whether the output is real.
- Users can switch providers without losing their skills, workflows, or verification history.
- DanteForge catches stubs, silent failures, and low-quality output before the user ships it.
- The trust gap between "AI said done" and "it actually works" shrinks measurably with every release.
- The product becomes more valuable as shared skills accumulate, without forcing a single-model future.
