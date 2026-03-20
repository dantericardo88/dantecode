import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  CodeIndex,
  criticDebate,
  createEmbeddingProvider,
  globalVerificationRailRegistry,
  WebSearchOrchestrator,
  runQaSuite,
  SmartExtractor,
  ModelRouterImpl,
  readOrInitializeState,
  SubAgentManager,
  verifyOutput,
  PersistentMemory,
  SessionStore,
} from "@dantecode/core";
import {
  DuckDuckGoProvider,
} from "@dantecode/web-research";
import { UpliftOrchestrator } from "@dantecode/agent-orchestrator";
import {
  formatLessonsForPrompt,
  queryLessons,
  recordLesson,
  recordPreference,
  recordSuccessPattern,
  runAntiStubScanner,
  runConstitutionCheck,
  runLocalPDSEScorer,
} from "@dantecode/danteforge";
import type { LessonSeverity, LessonType } from "@dantecode/config-types";
import {
  watchGitEvents,
  listGitWatchers,
  stopGitWatcher,
  addChangeset,
  WebhookListener,
  listWebhookListeners,
  stopWebhookListener,
  scheduleGitTask,
  listScheduledGitTasks,
  stopScheduledGitTask,
  GitAutomationOrchestrator,
} from "@dantecode/git-engine";
import type {
  GitEventType,
  GitWatchOptions,
  WorkflowOptions,
  BumpType,
  WebhookProvider,
} from "@dantecode/git-engine";
import type { ToolHandler } from "./server.js";

const VERIFIABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".json",
  ".md",
]);

export function createDefaultToolHandlers(): Record<string, ToolHandler> {
  return {
    pdse_score: async (args) => {
      const code = requiredString(args, "code");
      return serialize(runLocalPDSEScorer(code, process.cwd()));
    },
    anti_stub_scan: async (args) => {
      const code = requiredString(args, "code");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const filePath = optionalString(args, "filePath");
      return serialize(runAntiStubScanner(code, projectRoot, filePath));
    },
    constitution_check: async (args) => {
      const code = requiredString(args, "code");
      const filePath = optionalString(args, "filePath");
      return serialize(runConstitutionCheck(code, filePath));
    },
    lessons_query: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const lessons = await queryLessons({
        projectRoot,
        ...(optionalString(args, "filePattern")
          ? { filePattern: optionalString(args, "filePattern") }
          : {}),
        ...(optionalString(args, "language") ? { language: optionalString(args, "language") } : {}),
        limit: typeof args["limit"] === "number" ? args["limit"] : 10,
      });

      return serialize({
        count: lessons.length,
        lessons,
        prompt: formatLessonsForPrompt(lessons),
      });
    },
    semantic_search: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const query = requiredString(args, "query");
      const limit = typeof args["limit"] === "number" ? args["limit"] : 10;
      const index = new CodeIndex();

      const loaded = await index.load(projectRoot);
      if (!loaded) {
        await index.buildIndex(projectRoot);
        await index.save(projectRoot);
      }

      let queryEmbedding: number[] | undefined;
      let mode: "tfidf" | "hybrid" = "tfidf";
      const embeddingProviderInfo = index.getEmbeddingProviderInfo();

      if (index.hasEmbeddings && embeddingProviderInfo) {
        try {
          const provider = createEmbeddingProvider(embeddingProviderInfo.provider, {
            modelId: embeddingProviderInfo.modelId,
            ...(embeddingProviderInfo.dimensions
              ? { dimensions: embeddingProviderInfo.dimensions }
              : {}),
          });
          queryEmbedding = await provider.embedSingle(query);
          mode = "hybrid";
        } catch {
          mode = "tfidf";
        }
      }

      const results = index.search(query, limit, queryEmbedding);
      return serialize({
        mode,
        results: results.map((chunk) => ({
          filePath: chunk.filePath.replace(/\\/g, "/"),
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          symbols: chunk.symbols,
          snippet: chunk.content.slice(0, 240),
        })),
      });
    },
    record_lesson: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const pattern = requiredString(args, "pattern");
      const correction = requiredString(args, "correction");
      const type = (optionalString(args, "type") ?? "failure") as LessonType;
      const severity = (optionalString(args, "severity") ?? "warning") as LessonSeverity;

      const payload = {
        projectRoot,
        pattern,
        correction,
        ...(optionalString(args, "language") ? { language: optionalString(args, "language") } : {}),
        ...(optionalString(args, "framework")
          ? { framework: optionalString(args, "framework") }
          : {}),
        occurrences: 1,
        lastSeen: new Date().toISOString(),
        severity,
        source: "user" as const,
      };

      const lesson =
        type === "success"
          ? await recordSuccessPattern(payload, projectRoot)
          : type === "preference"
            ? await recordPreference(payload, projectRoot)
            : await recordLesson({ ...payload, type }, projectRoot);

      return serialize(lesson);
    },
    autoforge_verify: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const taskDescription = optionalString(args, "taskDescription");
      const requestedFilePaths = Array.isArray(args["filePaths"])
        ? args["filePaths"].filter((value): value is string => typeof value === "string")
        : [];
      const filePaths =
        requestedFilePaths.length > 0
          ? requestedFilePaths
          : await collectVerifiableFiles(projectRoot, 25);

      const files = await Promise.all(
        filePaths.map(async (filePath) => {
          const absolutePath = join(projectRoot, filePath);
          const code = await readFile(absolutePath, "utf-8");
          const antiStub = runAntiStubScanner(code, projectRoot, filePath);
          const constitution = runConstitutionCheck(code, filePath);
          const pdse = runLocalPDSEScorer(code, projectRoot);

          return {
            filePath,
            antiStubPassed: antiStub.passed,
            constitutionPassed: constitution.passed,
            pdsePassed: pdse.passedGate,
            pdseOverall: pdse.overall,
            hardViolations: antiStub.hardViolations.length,
            constitutionViolations: constitution.violations.length,
          };
        }),
      );

      const succeeded = files.every(
        (file) => file.antiStubPassed && file.constitutionPassed && file.pdsePassed,
      );

      return serialize({
        projectRoot,
        ...(taskDescription ? { taskDescription } : {}),
        succeeded,
        verifiedFiles: files.length,
        files,
      });
    },
    verify_output: async (args) => {
      const task = requiredString(args, "task");
      const output = requiredString(args, "output");
      const criteria = optionalRecord(args, "criteria");
      const rails = optionalRailArray(args, "rails");
      return serialize(verifyOutput({ task, output, ...(criteria ? { criteria } : {}), ...(rails ? { rails } : {}) }));
    },
    run_qa_suite: async (args) => {
      const planId = requiredString(args, "planId");
      const rawOutputs = args["outputs"];
      if (!Array.isArray(rawOutputs)) {
        throw new Error("Missing required array argument: outputs");
      }

      const outputs = rawOutputs.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`outputs[${index}] must be an object`);
        }

        const id = typeof entry["id"] === "string" && entry["id"].trim() ? entry["id"] : `output-${index + 1}`;
        const task = requiredString(entry, "task");
        const output = requiredString(entry, "output");
        const criteria = optionalRecord(entry, "criteria");
        const rails = optionalRailArray(entry, "rails");
        return {
          id,
          task,
          output,
          ...(criteria ? { criteria } : {}),
          ...(rails ? { rails } : {}),
        };
      });

      return serialize(runQaSuite(planId, outputs));
    },
    critic_debate: async (args) => {
      const opinionsArg = args["subagents"] ?? args["agents"];
      if (!Array.isArray(opinionsArg)) {
        throw new Error("Missing required array argument: subagents");
      }

      const opinions = opinionsArg.map((entry, index) => {
        if (!isRecord(entry)) {
          throw new Error(`subagents[${index}] must be an object`);
        }

        const agentId =
          typeof entry["agentId"] === "string" && entry["agentId"].trim()
            ? entry["agentId"]
            : typeof entry["id"] === "string" && entry["id"].trim()
              ? entry["id"]
              : `critic-${index + 1}`;
        const verdict = requiredString(entry, "verdict") as "pass" | "warn" | "fail";
        const confidence = typeof entry["confidence"] === "number" ? entry["confidence"] : undefined;
        const findings = Array.isArray(entry["findings"])
          ? entry["findings"].filter((value): value is string => typeof value === "string")
          : undefined;
        const critique = optionalString(entry, "critique");
        return {
          agentId,
          verdict,
          ...(confidence !== undefined ? { confidence } : {}),
          ...(findings ? { findings } : {}),
          ...(critique ? { critique } : {}),
        };
      });

      return serialize(criticDebate(opinions, optionalString(args, "output")));
    },
    add_verification_rail: async (args) => {
      const rule = requiredRecord(args, "rule");
      const added = globalVerificationRailRegistry.addRail(normalizeRail(rule));
      return serialize({
        added,
        totalRails: globalVerificationRailRegistry.listRails().length,
      });
    },
    web_search: async (args) => {
      const query = requiredString(args, "query");
      const provider = new DuckDuckGoProvider();
      const results = await provider.search(query);
      return serialize({
        query,
        results,
        uplifted: true
      });
    },

    web_fetch: async (args) => {
      const url = requiredString(args, "url");
      const instructions = optionalString(args, "instructions");
      const schemaStr = optionalString(args, "schema");
      const combinedInstructions = schemaStr ? `${instructions || ""}\nSchema:\n${schemaStr}`.trim() : instructions;
      const options = args["options"] as Record<string, unknown> | undefined;
      const projectRoot = process.cwd();
      
      const state = await readOrInitializeState(projectRoot);
      const routerConfig = {
        default: state.model.default,
        fallback: state.model.fallback,
        overrides: state.model.taskOverrides
      };
      const router = new ModelRouterImpl(routerConfig, projectRoot, "mcp-session");
      const extractor = new SmartExtractor(router);
      
      const extracted = await extractor.extract(url, { instructions: combinedInstructions, ...options });
      return serialize(extracted);
    },
    smart_extract: async (args) => {
      const url = requiredString(args, "url");
      const goal = requiredString(args, "goal");
      const projectRoot = process.cwd();
      
      const state = await readOrInitializeState(projectRoot);
      const routerConfig = {
        default: state.model.default,
        fallback: state.model.fallback,
        overrides: state.model.taskOverrides
      };
      const router = new ModelRouterImpl(routerConfig, projectRoot, "mcp-session");
      const extractor = new SmartExtractor(router);
      
      const extracted = await extractor.extract(url, { instructions: goal });
      return serialize(extracted);
    },
    batch_fetch: async (args) => {
      const urls = args["urls"] as string[];
      if (!Array.isArray(urls)) {
        throw new Error("Missing required array argument: urls");
      }
      const commonInstructions = optionalString(args, "commonInstructions");
      const projectRoot = process.cwd();
      
      const state = await readOrInitializeState(projectRoot);
      const routerConfig = {
        default: state.model.default,
        fallback: state.model.fallback,
        overrides: state.model.taskOverrides
      };
      const router = new ModelRouterImpl(routerConfig, projectRoot, "mcp-session");
      const extractor = new SmartExtractor(router);
      
      const results = await Promise.all(
        urls.map((url) =>
          extractor.extract(url, { instructions: commonInstructions })
        )
      );
      return serialize({ results });
    },
    spawn_subagent: async (args) => {
      const role = requiredString(args, "role");
      const task = requiredString(args, "task");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      
      const orchestrator = new UpliftOrchestrator({ projectRoot });
      const message = await orchestrator.executeSubTask("mcp-root", role, task);
      
      return serialize({
        role,
        status: "completed",
        uplifted: true,
        message
      });
    },

    git_watch: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const action = optionalString(args, "action") ?? "start";

      if (action === "list") {
        return serialize({ watchers: await listGitWatchers(projectRoot) });
      }

      if (action === "stop") {
        const watchId = requiredString(args, "watchId");
        return serialize({
          watchId,
          stopped: await stopGitWatcher(watchId, projectRoot),
        });
      }

      const eventType = requiredString(args, "eventType") as GitEventType;
      const targetPath = optionalString(args, "path");
      const options = optionalRecord(args, "options") as GitWatchOptions | undefined;
      const workflowPath = optionalString(args, "workflowPath");
      const eventPayload = optionalRecord(args, "eventPayload");
      const orchestrator = new GitAutomationOrchestrator({
        projectRoot,
        sessionId: "mcp-session",
        modelId: "mcp/git_watch",
      });

      const watcher = watchGitEvents(eventType, targetPath, {
        ...options,
        cwd: options?.cwd ?? projectRoot,
      });

      watcher.on("event", (evt) => {
        if (workflowPath) {
          void orchestrator
            .runWorkflowInBackground({
              workflowPath,
              eventPayload: {
                ...(eventPayload ?? {}),
                eventName: evt.type,
                watchId: watcher.id,
                relativePath: evt.data.relativePath,
              },
              trigger: {
                kind: "watch",
                sourceId: watcher.id,
                label: `${evt.type} ${evt.data.relativePath}`,
              },
            })
            .then((queued) => {
              console.log(`[GitEventWatcher] Queued workflow run ${queued.executionId}:`, evt);
            })
            .catch((error: unknown) => {
              console.error(`[GitEventWatcher] Automation failed`, error);
            });
          return;
        }
        console.log(`[GitEventWatcher] Event fired:`, evt);
      });

      return serialize({
        status: "started",
        watchId: watcher.id,
        eventType,
        ...(targetPath ? { targetPath } : {}),
        snapshot: watcher.snapshot(),
      });
    },
    run_github_workflow: async (args) => {
      const workflowPath = requiredString(args, "workflowPath");
      const eventPayload = optionalRecord(args, "eventPayload");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const options = optionalRecord(args, "options") as WorkflowOptions | undefined;
      const background = args["background"] === true;
      const orchestrator = new GitAutomationOrchestrator({
        projectRoot,
        sessionId: "mcp-session",
        modelId: "mcp/run_github_workflow",
      });

      const result = background
        ? await orchestrator.runWorkflowInBackground({
            workflowPath,
            eventPayload,
            options,
            trigger: {
              kind: "manual",
              label: "MCP run_github_workflow",
            },
          })
        : await orchestrator.runWorkflow({
            workflowPath,
            eventPayload,
            options,
            trigger: {
              kind: "manual",
              label: "MCP run_github_workflow",
            },
          });
      return serialize(result);
    },
    auto_pr_create: async (args) => {
      const title = requiredString(args, "title");
      const body = optionalString(args, "body");
      const base = optionalString(args, "base");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const options = { base, draft: args["draft"] === true, cwd: projectRoot };
      const background = args["background"] === true;

      // Optional changeset generation before PR
      const generateChangeset = args["generateChangeset"] as boolean | undefined;
      const type = (optionalString(args, "bumpType") || "patch") as BumpType;
      const packages = Array.isArray(args["packages"]) ? args["packages"] as string[] : [];

      const changesetFiles: string[] = [];
      if (generateChangeset && packages.length > 0) {
        const changeset = await addChangeset(type, packages, title, { cwd: projectRoot });
        if (changeset.filePath) {
          changesetFiles.push(changeset.filePath);
        }
      }

      const orchestrator = new GitAutomationOrchestrator({
        projectRoot,
        sessionId: "mcp-session",
        modelId: "mcp/auto_pr_create",
      });
      const result = background
        ? await orchestrator.runAutoPRInBackground({
            title,
            body,
            changesetFiles,
            options,
            trigger: {
              kind: "manual",
              label: "MCP auto_pr_create",
            },
          })
        : await orchestrator.createPullRequest({
            title,
            body,
            changesetFiles,
            options,
            trigger: {
              kind: "manual",
              label: "MCP auto_pr_create",
            },
          });
      return serialize({
        ...result,
        changesetFiles,
      });
    },
    webhook_listen: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const action = optionalString(args, "action") ?? "start";

      if (action === "list") {
        return serialize({ listeners: await listWebhookListeners(projectRoot) });
      }

      if (action === "stop") {
        const listenerId = requiredString(args, "listenerId");
        return serialize({
          listenerId,
          stopped: await stopWebhookListener(listenerId, projectRoot),
        });
      }

      const port = typeof args["port"] === "number" ? args["port"] : undefined;
      const secret = optionalString(args, "secret");
      const provider = (optionalString(args, "provider") ?? "github") as WebhookProvider;
      const workflowPath = optionalString(args, "workflowPath");
      const orchestrator = new GitAutomationOrchestrator({
        projectRoot,
        sessionId: "mcp-session",
        modelId: "mcp/webhook_listen",
      });
      const listener = new WebhookListener({
        port,
        secret,
        provider,
        path: optionalString(args, "path"),
        cwd: projectRoot,
      });
      await listener.start();

      listener.on("any-event", ({ event, payload }) => {
        if (workflowPath) {
          void orchestrator
            .runWorkflowInBackground({
              workflowPath,
              eventPayload: {
                ...payload,
                eventName: event,
              },
              trigger: {
                kind: "webhook",
                sourceId: listener.id,
                label: `${provider}:${event}`,
              },
            })
            .then((queued) => {
              console.log(`[WebhookListener] Queued workflow run ${queued.executionId}:`, event);
            })
            .catch((error: unknown) => {
              console.error(`[WebhookListener] Automation failed`, error);
            });
          return;
        }
        console.log(`[WebhookListener] Received event:`, event);
      });

      return serialize({
        status: "listening",
        listenerId: listener.id,
        port: listener.port,
        provider,
        path: optionalString(args, "path") ?? "/webhook",
      });
    },
    schedule_git_task: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const action = optionalString(args, "action") ?? "start";

      if (action === "list") {
        return serialize({ tasks: await listScheduledGitTasks(projectRoot) });
      }

      if (action === "stop") {
        const taskId = requiredString(args, "taskId");
        return serialize({
          taskId,
          stopped: await stopScheduledGitTask(taskId, projectRoot),
        });
      }

      const taskName = requiredString(args, "taskName");
      const intervalMs = typeof args["intervalMs"] === "number" ? args["intervalMs"] : undefined;
      const cron = optionalString(args, "cron");
      const workflowPath = optionalString(args, "workflowPath");
      const eventPayload = optionalRecord(args, "eventPayload");
      const orchestrator = new GitAutomationOrchestrator({
        projectRoot,
        sessionId: "mcp-session",
        modelId: "mcp/schedule_git_task",
      });

      const task = scheduleGitTask(
        cron ?? intervalMs ?? 60_000,
        async () => {
          if (workflowPath) {
            await orchestrator.runWorkflowInBackground({
              workflowPath,
              eventPayload,
              trigger: {
                kind: "schedule",
                label: taskName,
              },
            });
            return;
          }
          console.log(`[ScheduledTask] Running automated git task: ${taskName}`);
        },
        {
          cwd: projectRoot,
          taskName,
          runOnStart: false,
        },
      );

      return serialize({
        status: "scheduled",
        taskId: task.id,
        schedule: task.schedule,
        taskName,
      });
    },
    memory_store: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const key = requiredString(args, "key");
      const value = requiredString(args, "value");
      const scope = optionalString(args, "scope");
      const category = (optionalString(args, "category") ?? "fact") as any;

      const memory = new PersistentMemory(projectRoot);
      await memory.load();
      const entry = await memory.store(value, category, [key], scope);
      return serialize({ stored: true, entry });
    },
    memory_recall: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const query = requiredString(args, "query");
      const limit = typeof args["limit"] === "number" ? args["limit"] : 10;
      const scope = optionalString(args, "scope");

      const memory = new PersistentMemory(projectRoot);
      await memory.load();
      const results = memory.search(query, { limit, sessionId: scope });
      return serialize({ 
        query,
        count: results.length,
        results: results.map(r => ({ id: r.entry.id, content: r.entry.content, score: r.score, tags: r.entry.tags }))
      });
    },
    memory_summarize: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const sessionId = requiredString(args, "sessionId");
      
      const store = new SessionStore(projectRoot);
      const session = await store.load(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      const summary = await store.summarize(session);
      return serialize({ sessionId, summary });
    },
    memory_prune: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const threshold = typeof args["threshold"] === "number" ? args["threshold"] : 500;

      const memory = new PersistentMemory(projectRoot);
      await memory.load();
      const result = await memory.distill(threshold);
      return serialize(result);
    },
    cross_session_recall: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const userGoal = requiredString(args, "userGoal");

      const memory = new PersistentMemory(projectRoot);
      await memory.load();
      const results = memory.search(userGoal, { limit: 15 });
      return serialize({ 
        userGoal,
        context: results.map(r => `[${r.entry.category.toUpperCase()}] ${r.entry.content}`).join("\n"),
        count: results.length
      });
    },
    memory_visualize: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");

      const memory = new PersistentMemory(projectRoot);
      await memory.load();
      const entries = memory.getAll();
      const byCategory: Record<string, number> = {};
      const bySession: Record<string, number> = {};
      
      entries.forEach(e => {
        byCategory[e.category] = (byCategory[e.category] || 0) + 1;
        if (e.sessionId) bySession[e.sessionId] = (bySession[e.sessionId] || 0) + 1;
      });

      return serialize({ 
        totalEntries: entries.length,
        byCategory,
        sessionsWithMemory: Object.keys(bySession).length,
        mostRecentEntries: entries.sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 5)
      });
    },
  };
}

async function collectVerifiableFiles(projectRoot: string, limit: number): Promise<string[]> {
  const results: string[] = [];
  await walk(projectRoot, "", results, limit);
  return results;
}

async function walk(
  projectRoot: string,
  relativeDir: string,
  results: string[],
  limit: number,
): Promise<void> {
  if (results.length >= limit) {
    return;
  }

  const absoluteDir = join(projectRoot, relativeDir);
  const entries = await readdir(absoluteDir);
  for (const entry of entries) {
    if (results.length >= limit) {
      return;
    }

    if (entry === ".git" || entry === "node_modules" || entry === "dist") {
      continue;
    }

    const relativePath = relativeDir ? join(relativeDir, entry) : entry;
    const absolutePath = join(projectRoot, relativePath);
    const entryStat = await stat(absolutePath);

    if (entryStat.isDirectory()) {
      await walk(projectRoot, relativePath, results, limit);
      continue;
    }

    if (entryStat.isFile() && VERIFIABLE_EXTENSIONS.has(extname(entry))) {
      results.push(relativePath.replace(/\\/g, "/"));
    }
  }
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

function requiredRecord(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = args[key];
  if (!isRecord(value)) {
    throw new Error(`Missing required object argument: ${key}`);
  }
  return value;
}

function optionalRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  return isRecord(value) ? value : undefined;
}

function optionalRailArray(
  args: Record<string, unknown>,
  key: string,
): Array<{
  id: string;
  name: string;
  description?: string;
  mode?: "hard" | "soft";
  requiredSubstrings?: string[];
  forbiddenPatterns?: string[];
  minLength?: number;
  maxLength?: number;
}> | undefined {
  const value = args[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    return normalizeRail(entry);
  });
}

function normalizeRail(rule: Record<string, unknown>): {
  id: string;
  name: string;
  description?: string;
  mode?: "hard" | "soft";
  requiredSubstrings?: string[];
  forbiddenPatterns?: string[];
  minLength?: number;
  maxLength?: number;
} {
  const id = requiredString(rule, "id");
  const name = requiredString(rule, "name");
  const requiredSubstrings = arrayOfStrings(rule["requiredSubstrings"]);
  const forbiddenPatterns = arrayOfStrings(rule["forbiddenPatterns"]);
  const mode = rule["mode"] === "soft" ? "soft" : rule["mode"] === "hard" ? "hard" : undefined;
  const minLength = typeof rule["minLength"] === "number" ? rule["minLength"] : undefined;
  const maxLength = typeof rule["maxLength"] === "number" ? rule["maxLength"] : undefined;
  const description = optionalString(rule, "description");

  return {
    id,
    name,
    ...(description ? { description } : {}),
    ...(mode ? { mode } : {}),
    ...(requiredSubstrings.length > 0 ? { requiredSubstrings } : {}),
    ...(forbiddenPatterns.length > 0 ? { forbiddenPatterns } : {}),
    ...(minLength !== undefined ? { minLength } : {}),
    ...(maxLength !== undefined ? { maxLength } : {}),
  };
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
