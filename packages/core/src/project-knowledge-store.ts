// packages/core/src/project-knowledge-store.ts
// Cross-session project knowledge persistence (dim 21: session memory 8→9).
//
// Facts learned in one session (architecture patterns, user preferences,
// recurring bugs, key conventions) persist to ~/.dantecode/project-knowledge.json
// and are loaded back at the start of the next session.
//
// This closes the gap vs Cursor/Augment which maintain persistent project context.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { recordContextHit } from "./context-coverage-tracker.js";
import { bufferRetrievedFact } from "./retrieval-citation-tracker.js";
import { createHash } from "node:crypto";

export type KnowledgeCategory =
  | "architecture"   // Key design decisions, package structure
  | "convention"     // Coding conventions, naming patterns
  | "preference"     // User preferences discovered through interaction
  | "bug"            // Recurring bugs or known issues
  | "workflow"       // How the user likes to work
  | "context";       // One-off project context facts

export interface KnowledgeFact {
  id: string;
  category: KnowledgeCategory;
  fact: string;
  /** Confidence 0-1; decays over time if not reinforced */
  confidence: number;
  /** ISO timestamp when first recorded */
  createdAt: string;
  /** ISO timestamp when last accessed or reinforced */
  reinforcedAt: string;
  /** Session IDs that referenced this fact */
  sessionRefs: string[];
  /** Number of times this fact was surfaced and found useful */
  hitCount: number;
}

export interface ProjectKnowledgeSnapshot {
  projectRoot: string;
  projectHash: string;
  facts: KnowledgeFact[];
  lastSessionId?: string;
  lastUpdatedAt: string;
}

const DECAY_RATE_PER_DAY = 0.05; // confidence -= 5% per day without reinforcement
const MIN_CONFIDENCE = 0.1;      // facts below this are pruned on next save
const MAX_FACTS = 200;           // cap to prevent unbounded growth

export class ProjectKnowledgeStore {
  private readonly _storePath: string;
  private _snapshot: ProjectKnowledgeSnapshot;

  constructor(projectRoot: string, storeDir?: string) {
    const dir = storeDir ?? join(homedir(), ".dantecode", "knowledge");
    const projectHash = createHash("sha256")
      .update(projectRoot)
      .digest("hex")
      .slice(0, 16);
    this._storePath = join(dir, `${projectHash}.json`);

    mkdirSync(dirname(this._storePath), { recursive: true });
    this._snapshot = this._load(projectRoot, projectHash);
  }

  /** Add or reinforce a fact. Returns the fact ID. */
  upsert(
    fact: string,
    category: KnowledgeCategory,
    sessionId: string,
    confidence = 0.8,
  ): string {
    // Check for near-duplicate by first 60 chars
    const existing = this._snapshot.facts.find(
      (f) => f.category === category && f.fact.slice(0, 60) === fact.slice(0, 60),
    );

    if (existing) {
      existing.confidence = Math.min(1, existing.confidence + 0.1);
      existing.reinforcedAt = new Date().toISOString();
      if (!existing.sessionRefs.includes(sessionId)) {
        existing.sessionRefs.push(sessionId);
      }
      return existing.id;
    }

    const id = createHash("sha256")
      .update(`${category}:${fact}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12);

    this._snapshot.facts.push({
      id,
      category,
      fact,
      confidence,
      createdAt: new Date().toISOString(),
      reinforcedAt: new Date().toISOString(),
      sessionRefs: [sessionId],
      hitCount: 0,
    });

    return id;
  }

  /** Retrieve facts relevant to a query, sorted by confidence × recency. */
  query(
    category?: KnowledgeCategory,
    limit = 10,
    sessionId?: string,
  ): KnowledgeFact[] {
    this._applyDecay();

    const candidates = category
      ? this._snapshot.facts.filter((f) => f.category === category)
      : this._snapshot.facts;

    const sorted = [...candidates]
      .filter((f) => f.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => {
        const aScore = a.confidence * (1 + a.hitCount * 0.1);
        const bScore = b.confidence * (1 + b.hitCount * 0.1);
        return bScore - aScore;
      })
      .slice(0, limit);

    // Increment hit counts for surfaced facts
    if (sessionId) {
      for (const fact of sorted) {
        fact.hitCount++;
        if (!fact.sessionRefs.includes(sessionId)) {
          fact.sessionRefs.push(sessionId);
        }
      }
    }

    // Sprint AT (dim 2): track context hit for knowledge retrieved
    if (sorted.length > 0) {
      try {
        recordContextHit({ sessionId: sessionId ?? "knowledge-store", key: category ?? "all", source: "repo-memory", relevanceScore: sorted[0]?.confidence ?? 0.8 });
      } catch { /* non-fatal */ }
      // Sprint AZ (dim 2): buffer each retrieved fact for citation scoring
      try {
        for (const f of sorted) {
          bufferRetrievedFact(sessionId ?? "knowledge-store", f.fact.slice(0, 80), f.fact, "repo-memory");
        }
      } catch { /* non-fatal */ }
    }
    return sorted;
  }

  /** Format top facts as a system-prompt injection block. */
  formatForPrompt(limit = 8, sessionId?: string): string {
    const facts = this.query(undefined, limit, sessionId);
    if (facts.length === 0) return "";

    const lines = facts.map((f) => `- [${f.category}] ${f.fact}`).join("\n");
    return `## Project Knowledge (from prior sessions)\n${lines}`;
  }

  /** Persist to disk. Call at session end. */
  save(sessionId?: string): void {
    this._applyDecay();
    this._prune();
    this._snapshot.lastUpdatedAt = new Date().toISOString();
    if (sessionId) this._snapshot.lastSessionId = sessionId;
    writeFileSync(this._storePath, JSON.stringify(this._snapshot, null, 2), "utf8");
  }

  /** Number of facts currently stored. */
  get size(): number {
    return this._snapshot.facts.length;
  }

  /** Remove a fact by ID. */
  remove(id: string): boolean {
    const before = this._snapshot.facts.length;
    this._snapshot.facts = this._snapshot.facts.filter((f) => f.id !== id);
    return this._snapshot.facts.length < before;
  }

  private _load(projectRoot: string, projectHash: string): ProjectKnowledgeSnapshot {
    if (existsSync(this._storePath)) {
      try {
        const raw = readFileSync(this._storePath, "utf8");
        return JSON.parse(raw) as ProjectKnowledgeSnapshot;
      } catch {
        // Corrupted file — start fresh
      }
    }
    return {
      projectRoot,
      projectHash,
      facts: [],
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  private _applyDecay(): void {
    const now = Date.now();
    for (const fact of this._snapshot.facts) {
      const daysElapsed = (now - new Date(fact.reinforcedAt).getTime()) / 86_400_000;
      fact.confidence = Math.max(
        MIN_CONFIDENCE,
        fact.confidence * Math.pow(1 - DECAY_RATE_PER_DAY, daysElapsed),
      );
    }
  }

  private _prune(): void {
    // Remove facts below minimum confidence
    this._snapshot.facts = this._snapshot.facts.filter(
      (f) => f.confidence >= MIN_CONFIDENCE,
    );
    // If still over cap, remove lowest-confidence facts
    if (this._snapshot.facts.length > MAX_FACTS) {
      this._snapshot.facts.sort((a, b) => b.confidence - a.confidence);
      this._snapshot.facts = this._snapshot.facts.slice(0, MAX_FACTS);
    }
  }
}
