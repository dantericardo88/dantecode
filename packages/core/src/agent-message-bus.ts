// packages/core/src/agent-message-bus.ts
// Inter-Agent Message Bus — pub/sub communication channel for multi-agent coordination.
// Closes dim 22 gap vs OpenHands/Devin which have bidirectional agent channels.
//
// Pattern: OpenHands event-bus pattern — agents emit typed events, interested
// parties subscribe, coordinator accumulates. Zero external deps.
//
// Architecture:
//   - AgentMessageBus: singleton pub/sub with topic namespacing
//   - AgentChannel: per-lane typed message stream with history
//   - HandoffSignal: explicit "lane A done, results for lane B" message
//   - AgentBroadcast: fan-out to all lanes simultaneously

// ─── Message Types ────────────────────────────────────────────────────────────

export type MessagePriority = "critical" | "high" | "normal" | "low";

export type MessageKind =
  | "task_result"        // Lane completed a sub-task
  | "handoff"            // Passing work to another lane
  | "broadcast"          // Fan-out to all subscribers
  | "status_update"      // Progress ping (non-blocking)
  | "error"              // Lane encountered a failure
  | "request"            // Lane requesting info from another lane
  | "response";          // Response to a request

export interface AgentMessage {
  /** Unique message ID */
  id: string;
  /** Source lane */
  from: string;
  /** Target lane (null = broadcast) */
  to: string | null;
  kind: MessageKind;
  priority: MessagePriority;
  /** Message payload */
  payload: Record<string, unknown>;
  /** Optional correlation to a prior request */
  correlationId?: string;
  /** ISO timestamp */
  timestamp: string;
  /** Hop count (incremented on relay) */
  hops: number;
}

export type MessageHandler = (message: AgentMessage) => void | Promise<void>;

// ─── Subscription Registry ────────────────────────────────────────────────────

interface Subscription {
  id: string;
  lane: string;
  kind?: MessageKind;  // If set, only receive this kind
  handler: MessageHandler;
}

// ─── AgentMessageBus ─────────────────────────────────────────────────────────

/**
 * Lightweight pub/sub bus for inter-agent communication.
 * Messages are delivered synchronously by default (async fire-and-forget supported).
 *
 * Usage:
 *   const bus = new AgentMessageBus();
 *   bus.subscribe("tester", (msg) => { ... });
 *   bus.send({ from: "coder", to: "tester", kind: "handoff", payload: { diff } });
 */
export class AgentMessageBus {
  private _subscriptions = new Map<string, Subscription[]>();
  private _history: AgentMessage[] = [];
  private readonly _maxHistory: number;
  private _msgCounter = 0;

  constructor(options: { maxHistory?: number } = {}) {
    this._maxHistory = options.maxHistory ?? 500;
  }

  /**
   * Subscribe a lane to receive messages.
   * @param lane     The lane name to subscribe as
   * @param handler  Callback invoked for each matching message
   * @param kind     Optional filter — only receive messages of this kind
   * @returns Unsubscribe function
   */
  subscribe(lane: string, handler: MessageHandler, kind?: MessageKind): () => void {
    const sub: Subscription = {
      id: `sub_${++this._msgCounter}`,
      lane,
      kind,
      handler,
    };
    const existing = this._subscriptions.get(lane) ?? [];
    existing.push(sub);
    this._subscriptions.set(lane, existing);

    return () => {
      const subs = this._subscriptions.get(lane) ?? [];
      this._subscriptions.set(lane, subs.filter((s) => s.id !== sub.id));
    };
  }

  /**
   * Send a message to a specific lane or broadcast to all.
   * Message is added to history and dispatched to matching subscribers.
   */
  send(message: Omit<AgentMessage, "id" | "timestamp" | "hops">): AgentMessage {
    const msg: AgentMessage = {
      ...message,
      id: `msg_${++this._msgCounter}_${Date.now()}`,
      timestamp: new Date().toISOString(),
      hops: 0,
    };

    this._addToHistory(msg);
    this._dispatch(msg);
    return msg;
  }

  /**
   * Broadcast a message to ALL subscribed lanes.
   */
  broadcast(from: string, kind: MessageKind, payload: Record<string, unknown>, priority: MessagePriority = "normal"): AgentMessage {
    return this.send({ from, to: null, kind, payload, priority });
  }

  /**
   * Send a handoff signal from one lane to another with result payload.
   * Sets priority to "high" and kind to "handoff".
   */
  handoff(from: string, to: string, result: Record<string, unknown>): AgentMessage {
    return this.send({
      from,
      to,
      kind: "handoff",
      priority: "high",
      payload: { result, handoffAt: new Date().toISOString() },
    });
  }

  /**
   * Send a request and return the correlation ID for matching the response.
   */
  request(from: string, to: string, query: Record<string, unknown>): string {
    const msg = this.send({
      from,
      to,
      kind: "request",
      priority: "normal",
      payload: query,
    });
    return msg.id;
  }

  /**
   * Send a response to a prior request.
   */
  respond(from: string, to: string, correlationId: string, data: Record<string, unknown>): AgentMessage {
    return this.send({
      from,
      to,
      kind: "response",
      priority: "high",
      payload: data,
      correlationId,
    });
  }

  /**
   * Get message history, optionally filtered by lane or kind.
   */
  getHistory(opts: { lane?: string; kind?: MessageKind; limit?: number } = {}): AgentMessage[] {
    let msgs = this._history;
    if (opts.lane) {
      msgs = msgs.filter((m) => m.from === opts.lane || m.to === opts.lane || m.to === null);
    }
    if (opts.kind) {
      msgs = msgs.filter((m) => m.kind === opts.kind);
    }
    if (opts.limit) {
      msgs = msgs.slice(-opts.limit);
    }
    return msgs;
  }

  /**
   * Get all pending handoff messages directed at a specific lane.
   */
  getPendingHandoffs(lane: string): AgentMessage[] {
    return this._history.filter((m) => m.kind === "handoff" && m.to === lane);
  }

  /**
   * Clear all subscriptions and history (for test isolation).
   */
  reset(): void {
    this._subscriptions.clear();
    this._history = [];
    this._msgCounter = 0;
  }

  /**
   * Format bus state as a context string for injection into agent prompts.
   * Used in multi-agent orchestration to give each lane awareness of others.
   */
  formatForContext(lane: string, maxMessages = 5): string {
    const relevant = this.getHistory({ lane, limit: maxMessages });
    if (relevant.length === 0) return "";

    const lines: string[] = ["## Agent Message Bus", ""];
    for (const msg of relevant) {
      const dir = msg.to === null ? "broadcast" : msg.to === lane ? "→ you" : `→ ${msg.to}`;
      lines.push(`**[${msg.kind}]** ${msg.from} ${dir}: ${JSON.stringify(msg.payload).slice(0, 120)}`);
    }
    return lines.join("\n");
  }

  /** Subscriber count across all lanes. */
  get subscriberCount(): number {
    let count = 0;
    for (const subs of this._subscriptions.values()) count += subs.length;
    return count;
  }

  /** Total messages in history. */
  get historySize(): number {
    return this._history.length;
  }

  private _addToHistory(msg: AgentMessage): void {
    this._history.push(msg);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }
  }

  private _dispatch(msg: AgentMessage): void {
    const targets: string[] = [];

    if (msg.to === null) {
      // Broadcast — collect all lanes
      for (const lane of this._subscriptions.keys()) {
        if (lane !== msg.from) targets.push(lane);  // Don't send to self
      }
    } else {
      targets.push(msg.to);
    }

    for (const lane of targets) {
      const subs = this._subscriptions.get(lane) ?? [];
      for (const sub of subs) {
        if (sub.kind && sub.kind !== msg.kind) continue;  // Kind filter
        try {
          const result = sub.handler(msg);
          if (result instanceof Promise) {
            result.catch(() => { /* fire and forget */ });
          }
        } catch {
          // Non-fatal — subscriber errors don't block the bus
        }
      }
    }
  }
}

// ─── AgentChannel ─────────────────────────────────────────────────────────────

/**
 * Per-lane message channel with typed result accumulation.
 * Wraps AgentMessageBus with lane-specific ergonomics.
 */
export class AgentChannel {
  private readonly _bus: AgentMessageBus;
  readonly lane: string;
  private _results: Record<string, unknown>[] = [];

  constructor(bus: AgentMessageBus, lane: string) {
    this._bus = bus;
    this.lane = lane;

    // Auto-accumulate task_result messages directed at this lane
    this._bus.subscribe(lane, (msg) => {
      if (msg.kind === "task_result") {
        this._results.push({ from: msg.from, ...msg.payload });
      }
    }, "task_result");
  }

  /** Send a message to another lane. */
  send(to: string, kind: MessageKind, payload: Record<string, unknown>, priority: MessagePriority = "normal"): AgentMessage {
    return this._bus.send({ from: this.lane, to, kind, payload, priority });
  }

  /** Broadcast to all lanes. */
  broadcast(kind: MessageKind, payload: Record<string, unknown>): AgentMessage {
    return this._bus.broadcast(this.lane, kind, payload);
  }

  /** Handoff results to the next lane in the pipeline. */
  handoff(to: string, result: Record<string, unknown>): AgentMessage {
    return this._bus.handoff(this.lane, to, result);
  }

  /** Subscribe to messages directed at this lane. */
  subscribe(handler: MessageHandler, kind?: MessageKind): () => void {
    return this._bus.subscribe(this.lane, handler, kind);
  }

  /** Get accumulated results from other lanes. */
  getResults(): Record<string, unknown>[] {
    return [...this._results];
  }

  /** Clear accumulated results. */
  clearResults(): void {
    this._results = [];
  }
}

// ─── Global Bus ───────────────────────────────────────────────────────────────

/** Global singleton bus — use in production agent coordination. */
export const globalAgentBus = new AgentMessageBus({ maxHistory: 1000 });

/** Create an AgentChannel on the global bus. */
export function createAgentChannel(lane: string): AgentChannel {
  return new AgentChannel(globalAgentBus, lane);
}
