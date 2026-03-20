import { afterEach, describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import os from "node:os";
import {
  WebhookListener,
  listWebhookListeners,
} from "./webhook-handler.js";

describe("WebhookListener", () => {
  let listener: WebhookListener | undefined;
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (listener) {
      await listener.stop().catch(() => undefined);
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("verifies GitHub signatures and persists listener state", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "webhook-listener-"));
    listener = new WebhookListener({
      port: 0,
      secret: "test-secret",
      path: "/github",
      provider: "github",
      cwd: tmpDir,
    });
    await listener.start();

    const payload = JSON.stringify({ action: "opened", number: 12 });
    const signature = `sha256=${crypto
      .createHmac("sha256", "test-secret")
      .update(payload)
      .digest("hex")}`;

    const eventPromise = new Promise<{ event: string; payload: { action: string } }>((resolve) => {
      listener?.once("event", (event) =>
        resolve(event as { event: string; payload: { action: string } }),
      );
    });

    await sendWebhook(listener.port, "/github", payload, {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature,
    });

    const event = await eventPromise;
    expect(event.event).toBe("pull_request");
    expect(event.payload.action).toBe("opened");

    const records = await listWebhookListeners(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.receivedCount).toBe(1);
    expect(records[0]?.provider).toBe("github");
  });
});

async function sendWebhook(
  port: number,
  requestPath: string,
  body: string,
  headers: Record<string, string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = http.request({
      hostname: "127.0.0.1",
      method: "POST",
      port,
      path: requestPath,
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(body).toString(),
      },
    });

    request.on("response", (response) => {
      response.resume();
      response.on("end", resolve);
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}
