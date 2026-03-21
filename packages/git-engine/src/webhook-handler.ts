import * as http from "node:http";
import * as crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import * as path from "node:path";
import {
  GitAutomationStore,
  keepLatest,
  type StoredAutomationEvent,
  type StoredWebhookListenerRecord,
} from "./automation-store.js";

export type WebhookProvider = "github" | "gitlab" | "custom";

export interface WebhookOptions {
  port?: number;
  secret?: string;
  path?: string;
  provider?: WebhookProvider;
  cwd?: string;
  persist?: boolean;
  listenerId?: string;
  maxHistory?: number;
}

export interface NormalizedWebhookEvent {
  id: string;
  listenerId: string;
  provider: WebhookProvider;
  event: string;
  timestamp: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}

const ACTIVE_WEBHOOK_LISTENERS = new Map<string, WebhookListener>();

export class WebhookListener extends EventEmitter {
  private server: http.Server;
  private readonly secret?: string;
  private readonly path: string;
  private readonly provider: WebhookProvider;
  private readonly cwd: string;
  private readonly persist: boolean;
  private readonly maxHistory: number;
  private readonly listenerId: string;
  private readonly store: GitAutomationStore;
  private readonly startedAt: string;
  private status: StoredWebhookListenerRecord["status"] = "active";
  private stoppedAt?: string;
  private lastEventAt?: string;
  private receivedCount = 0;
  private recentEvents: StoredAutomationEvent[] = [];
  private error?: string;
  public port: number;

  constructor(options: WebhookOptions = {}) {
    super();
    this.secret = options.secret;
    this.path = options.path || "/webhook";
    this.provider = options.provider ?? "github";
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.persist = options.persist ?? true;
    this.maxHistory = options.maxHistory ?? 20;
    this.listenerId = options.listenerId ?? randomUUID().slice(0, 12);
    this.store = new GitAutomationStore(this.cwd);
    this.startedAt = new Date().toISOString();
    this.port = options.port ?? 3000;

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
  }

  get id(): string {
    return this.listenerId;
  }

  public async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, () => {
        this.server.removeListener("error", reject);
        const address = this.server.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        }
        resolve();
      });
    });

    ACTIVE_WEBHOOK_LISTENERS.set(this.listenerId, this);
    await this.persistSnapshot();
  }

  public async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    ACTIVE_WEBHOOK_LISTENERS.delete(this.listenerId);
    this.status = this.status === "error" ? "error" : "stopped";
    this.stoppedAt = new Date().toISOString();
    await this.persistSnapshot();
  }

  public snapshot(): StoredWebhookListenerRecord {
    return {
      id: this.listenerId,
      provider: this.provider,
      port: this.port,
      path: this.path,
      status: this.status,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      ...(this.stoppedAt ? { stoppedAt: this.stoppedAt } : {}),
      ...(this.lastEventAt ? { lastEventAt: this.lastEventAt } : {}),
      receivedCount: this.receivedCount,
      recentEvents: [...this.recentEvents],
      ...(this.error ? { error: this.error } : {}),
    };
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      if (req.method !== "POST" || req.url !== this.path) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
        return;
      }

      const body = await readBody(req);
      const verificationError = this.verifyRequest(req, body);
      if (verificationError) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end(verificationError);
        return;
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid JSON payload");
        return;
      }

      const eventName = resolveWebhookEventName(this.provider, req.headers);
      const normalizedEvent: NormalizedWebhookEvent = {
        id: randomUUID().slice(0, 12),
        listenerId: this.listenerId,
        provider: this.provider,
        event: eventName,
        timestamp: new Date().toISOString(),
        payload,
        headers: normalizeHeaders(req.headers),
      };

      this.receivedCount += 1;
      this.lastEventAt = normalizedEvent.timestamp;
      this.recentEvents = keepLatest(
        [
          ...this.recentEvents,
          {
            id: normalizedEvent.id,
            timestamp: normalizedEvent.timestamp,
            summary: `${eventName} webhook`,
            payload: {
              provider: this.provider,
              event: eventName,
              path: this.path,
            },
          },
        ],
        this.maxHistory,
      );
      this.status = "active";
      await this.persistSnapshot();

      this.emit(eventName, payload);
      this.emit("event", normalizedEvent);
      this.emit("any-event", normalizedEvent);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, event: eventName, listenerId: this.listenerId }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = "error";
      this.error = message;
      await this.persistSnapshot();

      if (this.listenerCount("error") > 0) {
        this.emit("error", new Error(message));
      }

      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal server error");
    }
  }

  private verifyRequest(req: http.IncomingMessage, body: string): string | null {
    if (!this.secret) {
      return null;
    }

    if (this.provider === "github") {
      const signature = readHeader(req.headers, "x-hub-signature-256");
      if (!signature) {
        return "Missing signature";
      }
      const expected = signPayload(this.secret, body);
      try {
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
          return "Invalid signature";
        }
      } catch {
        return "Invalid signature";
      }
      return null;
    }

    if (this.provider === "gitlab") {
      const token = readHeader(req.headers, "x-gitlab-token");
      return token === this.secret ? null : "Invalid token";
    }

    const customSecret = readHeader(req.headers, "x-webhook-secret");
    return customSecret === this.secret ? null : "Invalid secret";
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.persist) {
      return;
    }
    await this.store.upsertWebhookListener(this.snapshot());
  }
}

export async function listWebhookListeners(
  projectRoot = process.cwd(),
): Promise<StoredWebhookListenerRecord[]> {
  const store = new GitAutomationStore(path.resolve(projectRoot));
  return store.listWebhookListeners();
}

export async function stopWebhookListener(
  listenerId: string,
  projectRoot = process.cwd(),
): Promise<boolean> {
  const active = ACTIVE_WEBHOOK_LISTENERS.get(listenerId);
  if (active) {
    await active.stop();
    return true;
  }

  const store = new GitAutomationStore(path.resolve(projectRoot));
  const listeners = await store.listWebhookListeners();
  const existing = listeners.find((listener) => listener.id === listenerId);
  if (!existing) {
    return false;
  }

  await store.upsertWebhookListener({
    ...existing,
    status: existing.status === "error" ? "error" : "stopped",
    updatedAt: new Date().toISOString(),
    stoppedAt: new Date().toISOString(),
  });
  return true;
}

function signPayload(secret: string, payload: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  return `sha256=${hmac.digest("hex")}`;
}

function readHeader(headers: http.IncomingHttpHeaders, key: string): string | undefined {
  const value = headers[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function resolveWebhookEventName(
  provider: WebhookProvider,
  headers: http.IncomingHttpHeaders,
): string {
  if (provider === "github") {
    return readHeader(headers, "x-github-event") ?? "unknown-event";
  }
  if (provider === "gitlab") {
    return readHeader(headers, "x-gitlab-event") ?? "unknown-event";
  }
  return readHeader(headers, "x-webhook-event") ?? "custom-event";
}

function normalizeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      normalized[key] = value.join(", ");
    }
  }
  return normalized;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
