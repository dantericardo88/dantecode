/**
 * event-engine.ts
 *
 * Unified event system for git hooks, webhooks, and filesystem watchers.
 * Provides workflow registration, event queuing, routing, retry logic,
 * and condition-based filtering.
 */

import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All first-class event types recognised by the engine. */
export type DanteEventType =
  | "git:commit"
  | "git:push"
  | "git:checkout"
  | "git:merge"
  | "git:rebase"
  | "webhook:github"
  | "webhook:gitlab"
  | "webhook:custom"
  | "fs:change"
  | "fs:create"
  | "fs:delete"
  | "agent:complete"
  | "agent:fail"
  | "agent:start"
  | "custom";

/** A single event travelling through the engine. */
export interface DanteEvent {
  /** UUID v4 unique to this event. */
  id: string;
  /** Categorised event type. */
  type: DanteEventType;
  /** Arbitrary structured data attached by the producer. */
  payload: Record<string, unknown>;
  /** ISO-8601 timestamp of event creation. */
  timestamp: string;
  /** Human-readable origin identifier (e.g. "git-hook", "github-webhook"). */
  source: string;
  /** True once all matching workflows have run (or been attempted). */
  processed: boolean;
}

/** A workflow that reacts to one or more event types. */
export interface WorkflowDefinition {
  /** Unique workflow identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Event type(s) that trigger this workflow. */
  trigger: DanteEventType | DanteEventType[];
  /** Async or sync handler called with the matching event. */
  handler: (event: DanteEvent) => Promise<void> | void;
  /** Whether the workflow is active. */
  enabled: boolean;
  /**
   * Optional payload-based conditions. Every entry must match for the
   * workflow to be triggered.
   */
  conditions?: Array<{ field: string; value: unknown }>;
}

/** An entry in the engine's processing queue. */
export interface EventQueueEntry {
  /** The event being queued. */
  event: DanteEvent;
  /** ISO-8601 timestamp of enqueue time. */
  enqueuedAt: string;
  /** Number of processing attempts so far. */
  attempts: number;
  /** Maximum allowed attempts before the entry is discarded. */
  maxAttempts: number;
  /** Last error message if the most recent attempt failed. */
  lastError?: string;
}

/** Construction options for {@link EventEngine}. */
export interface EventEngineOptions {
  /** Maximum number of entries allowed in the queue. Default: 1000. */
  maxQueueSize?: number;
  /** Maximum retry attempts per event before it is dropped. Default: 3. */
  maxAttempts?: number;
}

// ---------------------------------------------------------------------------
// EventEngine
// ---------------------------------------------------------------------------

/** Result returned by {@link EventEngine.processNext}. */
export interface ProcessNextResult {
  processed: boolean;
  event?: DanteEvent;
  error?: string;
}

/**
 * EventEngine
 *
 * Central hub that accepts events, routes them to registered workflows, and
 * provides retry/back-off semantics for transient failures.
 *
 * @example
 * ```ts
 * const engine = new EventEngine({ maxQueueSize: 500 });
 *
 * engine.registerWorkflow({
 *   id: "notify-on-push",
 *   name: "Notify on Git Push",
 *   trigger: "git:push",
 *   enabled: true,
 *   handler: async (event) => { ... },
 * });
 *
 * engine.enqueue("git:push", { branch: "main" }, "cli");
 * await engine.processAll();
 * ```
 */
export class EventEngine {
  private readonly workflows: Map<string, WorkflowDefinition> = new Map();
  private readonly queue: EventQueueEntry[] = [];
  private readonly processedEvents: DanteEvent[] = [];
  private readonly options: Required<EventEngineOptions>;

  constructor(options: EventEngineOptions = {}) {
    this.options = {
      maxQueueSize: options.maxQueueSize ?? 1000,
      maxAttempts: options.maxAttempts ?? 3,
    };
  }

  // -------------------------------------------------------------------------
  // Workflow management
  // -------------------------------------------------------------------------

  /**
   * Register a workflow with the engine.
   *
   * @throws {Error} If a workflow with the same ID is already registered.
   */
  registerWorkflow(workflow: WorkflowDefinition): void {
    if (this.workflows.has(workflow.id)) {
      throw new Error(
        `Workflow with id "${workflow.id}" is already registered. ` +
          `Unregister the existing workflow first.`,
      );
    }
    this.workflows.set(workflow.id, workflow);
  }

  /**
   * Remove a workflow by ID.
   *
   * @returns `true` if the workflow existed and was removed, `false` otherwise.
   */
  unregisterWorkflow(id: string): boolean {
    return this.workflows.delete(id);
  }

  /**
   * Enable a previously disabled workflow.
   *
   * @returns `true` if the workflow was found (and is now enabled).
   */
  enableWorkflow(id: string): boolean {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;
    workflow.enabled = true;
    return true;
  }

  /**
   * Disable a workflow without removing it.
   *
   * @returns `true` if the workflow was found (and is now disabled).
   */
  disableWorkflow(id: string): boolean {
    const workflow = this.workflows.get(id);
    if (!workflow) return false;
    workflow.enabled = false;
    return true;
  }

  /**
   * Return all registered workflows (enabled or not).
   */
  getWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  // -------------------------------------------------------------------------
  // Event production
  // -------------------------------------------------------------------------

  /**
   * Factory helper — create a {@link DanteEvent} without enqueueing it.
   */
  createEvent(
    type: DanteEventType,
    payload: Record<string, unknown>,
    source = "unknown",
  ): DanteEvent {
    return {
      id: randomUUID(),
      type,
      payload,
      timestamp: new Date().toISOString(),
      source,
      processed: false,
    };
  }

  /**
   * Create an event and add it to the processing queue.
   *
   * If the queue is at capacity the event is still returned but not enqueued.
   *
   * @returns The newly created {@link DanteEvent}.
   */
  enqueue(
    type: DanteEventType,
    payload: Record<string, unknown>,
    source = "unknown",
  ): DanteEvent {
    const event = this.createEvent(type, payload, source);

    if (this.queue.length < this.options.maxQueueSize) {
      const entry: EventQueueEntry = {
        event,
        enqueuedAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: this.options.maxAttempts,
      };
      this.queue.push(entry);
    }

    return event;
  }

  // -------------------------------------------------------------------------
  // Event routing
  // -------------------------------------------------------------------------

  /**
   * Find all enabled workflows that match the given event's type and
   * conditions.
   */
  routeEvent(event: DanteEvent): WorkflowDefinition[] {
    const matches: WorkflowDefinition[] = [];

    for (const workflow of this.workflows.values()) {
      if (!workflow.enabled) continue;

      const triggers = Array.isArray(workflow.trigger)
        ? workflow.trigger
        : [workflow.trigger];

      if (!triggers.includes(event.type)) continue;

      if (!this.matchesConditions(event, workflow.conditions)) continue;

      matches.push(workflow);
    }

    return matches;
  }

  /**
   * Evaluate whether an event's payload satisfies every condition.
   *
   * @param event      The event to test.
   * @param conditions Conditions to evaluate. `undefined` / empty = always true.
   */
  matchesConditions(
    event: DanteEvent,
    conditions: WorkflowDefinition["conditions"],
  ): boolean {
    if (!conditions || conditions.length === 0) return true;

    for (const condition of conditions) {
      if (event.payload[condition.field] !== condition.value) {
        return false;
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Queue processing
  // -------------------------------------------------------------------------

  /**
   * Process the next event in the queue.
   *
   * - Finds all matching, enabled workflows and invokes each handler.
   * - On handler failure the attempt count is incremented and the error is
   *   stored. The entry is re-queued at the end unless `maxAttempts` is
   *   exhausted.
   * - On success (or exhausted retries) the event is marked processed and
   *   moved to `processedEvents`.
   *
   * @returns `{ processed: false }` when the queue is empty.
   */
  async processNext(): Promise<ProcessNextResult> {
    if (this.queue.length === 0) {
      return { processed: false };
    }

    const entry = this.queue.shift()!;
    entry.attempts += 1;

    const matchingWorkflows = this.routeEvent(entry.event);

    let lastError: string | undefined;

    for (const workflow of matchingWorkflows) {
      try {
        await workflow.handler(entry.event);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    if (lastError !== undefined && entry.attempts < entry.maxAttempts) {
      // Re-queue for retry.
      entry.lastError = lastError;
      this.queue.push(entry);
      return { processed: false, event: entry.event, error: lastError };
    }

    // Mark event as processed and archive it.
    entry.event.processed = true;
    entry.lastError = lastError;
    this.processedEvents.push(entry.event);

    return {
      processed: true,
      event: entry.event,
      error: lastError,
    };
  }

  /**
   * Drain the queue by calling {@link processNext} until it is empty.
   *
   * @returns The number of events that reached the `processed` state.
   */
  async processAll(): Promise<number> {
    let count = 0;

    // Use a ceiling to prevent infinite loops if retry keeps re-adding.
    const ceiling = this.queue.length * this.options.maxAttempts + 1;
    let iterations = 0;

    while (this.queue.length > 0 && iterations < ceiling) {
      const result = await this.processNext();
      if (result.processed) count++;
      iterations++;
    }

    return count;
  }

  // -------------------------------------------------------------------------
  // Inspection helpers
  // -------------------------------------------------------------------------

  /** Current number of entries waiting in the queue. */
  getQueueLength(): number {
    return this.queue.length;
  }

  /** All events that have completed processing (successfully or exhausted). */
  getProcessedEvents(): DanteEvent[] {
    return [...this.processedEvents];
  }

  /** Remove all pending entries from the queue. */
  clearQueue(): void {
    this.queue.splice(0, this.queue.length);
  }
}
