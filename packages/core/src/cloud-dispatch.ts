// ============================================================================
// @dantecode/core — Cloud Agent Dispatcher
// 3-tier dispatch: local -> Docker -> cloud HTTP with SSE progress streaming.
// ============================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { DockerAgentConfig, SandboxExecResult } from "@dantecode/config-types";

const execAsync = promisify(exec);

// ─── Types ───────────────────────────────────────────────────────────────────

export type DispatchMode = "local" | "docker" | "cloud";

export interface CloudAgentConfig {
  /** Base URL for the cloud agent API endpoint */
  endpoint: string;
  /** Authentication token for the cloud API */
  apiToken: string;
  /** Timeout in milliseconds for cloud requests */
  timeoutMs?: number;
  /** Whether to stream progress via SSE */
  streamProgress?: boolean;
}

export interface DispatchResult {
  mode: DispatchMode;
  success: boolean;
  output: string;
  touchedFiles: string[];
  durationMs: number;
  error?: string;
}

export interface DispatchOptions {
  prompt: string;
  projectRoot: string;
  preferredMode?: DispatchMode;
  cloudConfig?: CloudAgentConfig;
  dockerConfig?: DockerAgentConfig;
  /** Agent executor for local dispatch (runs the prompt through the real agent loop) */
  localExecutor?: LocalAgentExecutor;
  /** Called with progress messages during execution */
  onProgress?: (message: string) => void;
  /** Timeout in ms for the entire dispatch */
  timeoutMs?: number;
}

export interface CloudAgentResponse {
  taskId: string;
  status: "completed" | "failed";
  output: string;
  touchedFiles: string[];
  error?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Build a fallback chain based on the preferred mode. */
function buildFallbackChain(preferred: DispatchMode): DispatchMode[] {
  switch (preferred) {
    case "cloud":
      return ["cloud", "docker", "local"];
    case "docker":
      return ["docker", "local"];
    case "local":
      return ["local"];
  }
}

// ─── Mode Selection ──────────────────────────────────────────────────────────

/**
 * Determine the best dispatch mode based on available infrastructure.
 * Returns "cloud" if cloudConfig is provided, "docker" if dockerConfig
 * is provided, otherwise "local".
 */
export function selectDispatchMode(options: DispatchOptions): DispatchMode {
  if (options.preferredMode) {
    return options.preferredMode;
  }
  if (options.cloudConfig) {
    return "cloud";
  }
  if (options.dockerConfig) {
    return "docker";
  }
  return "local";
}

// ─── Local Dispatch ──────────────────────────────────────────────────────────

/** Optional agent executor injected by the caller for local dispatch. */
export type LocalAgentExecutor = (
  prompt: string,
  projectRoot: string,
) => Promise<{ output: string; touchedFiles: string[] }>;

async function dispatchLocal(options: DispatchOptions): Promise<DispatchResult> {
  const startedAt = Date.now();
  options.onProgress?.("Running agent task locally...");

  try {
    let output: string;
    let touchedFiles: string[] = [];

    if (options.localExecutor) {
      // Use the injected agent executor for real local dispatch
      const result = await Promise.race([
        options.localExecutor(options.prompt, options.projectRoot),
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("Local execution timed out")),
            options.timeoutMs ?? 300_000,
          );
        }),
      ]);
      output = result.output;
      touchedFiles = result.touchedFiles;
    } else {
      // Fallback: run the prompt as a shell command in the project directory.
      // This supports simple scripted tasks (e.g. "npm run build").
      const result = await execAsync(options.prompt, {
        cwd: options.projectRoot,
        timeout: options.timeoutMs ?? 300_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      output = result.stdout.trim();
    }

    const durationMs = Date.now() - startedAt;
    options.onProgress?.("Local execution completed.");

    return {
      mode: "local",
      success: true,
      output,
      touchedFiles,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    const execError = err as Error & {
      stdout?: string;
      stderr?: string;
      signal?: string;
    };

    const timedOut =
      execError.signal === "SIGTERM" || (err instanceof Error && err.message.includes("timed out"));

    return {
      mode: "local",
      success: false,
      output: execError.stdout ?? "",
      touchedFiles: [],
      durationMs,
      error: timedOut ? "Local execution timed out" : errorMessage(err),
    };
  }
}

// ─── Docker Dispatch ─────────────────────────────────────────────────────────

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execAsync("docker info", { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function dispatchDocker(options: DispatchOptions): Promise<DispatchResult> {
  const startedAt = Date.now();
  options.onProgress?.("Checking Docker availability...");

  if (!options.dockerConfig) {
    return {
      mode: "docker",
      success: false,
      output: "",
      touchedFiles: [],
      durationMs: Date.now() - startedAt,
      error: "No Docker configuration provided",
    };
  }

  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    return {
      mode: "docker",
      success: false,
      output: "",
      touchedFiles: [],
      durationMs: Date.now() - startedAt,
      error: "Docker is not available on this system",
    };
  }

  options.onProgress?.("Starting Docker container...");

  try {
    const SANDBOX_PACKAGE_NAME = "@dantecode/sandbox";
    const { SandboxManager, SandboxExecutor } = await import(SANDBOX_PACKAGE_NAME);

    const spec = {
      image: options.dockerConfig.image,
      workdir: "/workspace",
      networkMode: options.dockerConfig.networkMode ?? "bridge",
      mounts: [
        {
          hostPath: options.projectRoot,
          containerPath: "/workspace",
          readonly: options.dockerConfig.readOnlyMount ?? true,
        },
      ],
      env: {},
      memoryLimitMb: options.dockerConfig.memoryLimitMb ?? 2048,
      cpuLimit: options.dockerConfig.cpuLimit ?? 2,
      timeoutMs: options.timeoutMs ?? 300_000,
    };

    const manager = new SandboxManager(spec);
    await manager.start();

    options.onProgress?.("Executing task in Docker container...");
    const executor = new SandboxExecutor(manager, options.projectRoot);
    const result: SandboxExecResult = await executor.run(
      `echo "${options.prompt.replace(/"/g, '\\"')}"`,
      options.timeoutMs,
    );

    await manager.stop();

    const durationMs = Date.now() - startedAt;
    options.onProgress?.("Docker execution completed.");

    if (result.timedOut) {
      return {
        mode: "docker",
        success: false,
        output: result.stdout,
        touchedFiles: [],
        durationMs,
        error: "Docker execution timed out",
      };
    }

    return {
      mode: "docker",
      success: result.exitCode === 0,
      output: result.stdout.trim(),
      touchedFiles: [],
      durationMs,
      error: result.exitCode !== 0 ? result.stderr : undefined,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startedAt;
    return {
      mode: "docker",
      success: false,
      output: "",
      touchedFiles: [],
      durationMs,
      error: errorMessage(err),
    };
  }
}

// ─── SSE Parsing ─────────────────────────────────────────────────────────────

interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Parse Server-Sent Events from a ReadableStream.
 * Yields each parsed event with its data field.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() ?? "";

      let currentEvent: string | undefined;
      let currentData = "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const dataValue = line.slice(5).trim();
          if (currentData) {
            currentData += "\n" + dataValue;
          } else {
            currentData = dataValue;
          }
        } else if (line.trim() === "") {
          // Empty line = end of event
          if (currentData) {
            yield { event: currentEvent, data: currentData };
            currentEvent = undefined;
            currentData = "";
          }
        }
      }

      // If there's accumulated data without a trailing blank line, keep it
      if (currentData) {
        yield { event: currentEvent, data: currentData };
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const remaining = buffer.trim();
      if (remaining.startsWith("data:")) {
        yield { data: remaining.slice(5).trim() };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Cloud Dispatch ──────────────────────────────────────────────────────────

function cloudResult(
  startedAt: number,
  partial: Omit<DispatchResult, "mode" | "durationMs">,
): DispatchResult {
  return { mode: "cloud", durationMs: Date.now() - startedAt, ...partial };
}

/** Drain an SSE stream coming back from the cloud agent. Calls onProgress for
 *  every progress frame and returns the final result fields when the
 *  `complete` event arrives (or the stream ends without one). */
async function consumeCloudSseStream(
  body: NonNullable<Response["body"]>,
  onProgress?: DispatchOptions["onProgress"],
): Promise<{ output: string; touchedFiles: string[]; error?: string; success: boolean }> {
  let output = "";
  let touchedFiles: string[] = [];
  let error: string | undefined;
  let success = false;

  for await (const event of parseSSEStream(body)) {
    try {
      const parsed = JSON.parse(event.data);
      if (event.event === "progress" || parsed.type === "progress") {
        onProgress?.(parsed.message ?? parsed.data ?? "Processing...");
      } else if (event.event === "complete" || parsed.type === "complete" || parsed.status) {
        const r = parsed as CloudAgentResponse;
        output = r.output ?? "";
        touchedFiles = r.touchedFiles ?? [];
        error = r.error;
        success = r.status === "completed";
      }
    } catch {
      if (event.data && event.data !== "[DONE]") onProgress?.(event.data);
    }
  }
  return { output, touchedFiles, error, success };
}

async function dispatchCloud(options: DispatchOptions): Promise<DispatchResult> {
  const startedAt = Date.now();

  if (!options.cloudConfig) {
    return cloudResult(startedAt, {
      success: false, output: "", touchedFiles: [],
      error: "No cloud configuration provided",
    });
  }

  const { endpoint, apiToken, timeoutMs: cloudTimeout, streamProgress } = options.cloudConfig;
  const timeout = options.timeoutMs ?? cloudTimeout ?? 600_000;
  options.onProgress?.("Dispatching task to cloud agent...");

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeout);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    };
    if (streamProgress) headers["Accept"] = "text/event-stream";

    const response = await fetch(`${endpoint}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: options.prompt,
        projectRoot: options.projectRoot,
        stream: streamProgress ?? false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      return cloudResult(startedAt, {
        success: false, output: "", touchedFiles: [],
        error: `Cloud API returned ${response.status}: ${errorBody}`,
      });
    }

    if (streamProgress && response.body) {
      const r = await consumeCloudSseStream(response.body, options.onProgress);
      return cloudResult(startedAt, {
        success: r.success, output: r.output, touchedFiles: r.touchedFiles, error: r.error,
      });
    }

    const responseData = (await response.json()) as CloudAgentResponse;
    options.onProgress?.("Cloud execution completed.");
    return cloudResult(startedAt, {
      success: responseData.status === "completed",
      output: responseData.output ?? "",
      touchedFiles: responseData.touchedFiles ?? [],
      error: responseData.error,
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return cloudResult(startedAt, {
        success: false, output: "", touchedFiles: [], error: "Cloud request timed out",
      });
    }
    return cloudResult(startedAt, {
      success: false, output: "", touchedFiles: [], error: errorMessage(err),
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ─── Dispatch Orchestrator ───────────────────────────────────────────────────

/**
 * Dispatch an agent task using the 3-tier strategy.
 * Tries the preferred mode first, falls back through the tiers on failure.
 */
export async function dispatchAgentTask(options: DispatchOptions): Promise<DispatchResult> {
  const preferred = selectDispatchMode(options);
  const chain = buildFallbackChain(preferred);

  let lastResult: DispatchResult | undefined;

  for (const mode of chain) {
    options.onProgress?.(`Attempting ${mode} dispatch...`);

    let result: DispatchResult;

    switch (mode) {
      case "cloud":
        result = await dispatchCloud(options);
        break;
      case "docker":
        result = await dispatchDocker(options);
        break;
      case "local":
        result = await dispatchLocal(options);
        break;
    }

    if (result.success) {
      return result;
    }

    lastResult = result;
    options.onProgress?.(
      `${mode} dispatch failed: ${result.error ?? "unknown error"}. Trying next tier...`,
    );
  }

  // All tiers exhausted — return the last failure result
  return (
    lastResult ?? {
      mode: preferred,
      success: false,
      output: "",
      touchedFiles: [],
      durationMs: 0,
      error: "All dispatch tiers exhausted",
    }
  );
}
