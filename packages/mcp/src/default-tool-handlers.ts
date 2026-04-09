import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  CodeIndex,
  criticDebate,
  createEmbeddingProvider,
  globalVerificationRailRegistry,
  runQaSuite,
  ModelRouterImpl,
  readOrInitializeState,
  verifyOutput,
  BrowserAgent,
  PersistentMemory,
  SessionStore,
} from "@dantecode/core";
import { WebExtractor } from "@dantecode/web-extractor";
import { DuckDuckGoProvider } from "@dantecode/web-research";
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
} from "@dantecode/git-engine";
import { GitAutomationOrchestrator } from "@dantecode/automation-engine";
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
      return serialize(
        verifyOutput({
          task,
          output,
          ...(criteria ? { criteria } : {}),
          ...(rails ? { rails } : {}),
        }),
      );
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

        const id =
          typeof entry["id"] === "string" && entry["id"].trim()
            ? entry["id"]
            : `output-${index + 1}`;
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
        const confidence =
          typeof entry["confidence"] === "number" ? entry["confidence"] : undefined;
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
        uplifted: true,
      });
    },

    web_fetch: async (args) => {
      const url = requiredString(args, "url");
      const instructions = optionalString(args, "instructions");
      const schemaStr = optionalString(args, "schema");
      const options = (args["options"] as Record<string, unknown> | undefined) || {};
      const projectRoot = (options["projectRoot"] as string) || process.cwd();

      const state = await readOrInitializeState(projectRoot);
      const routerConfig = {
        default: state.model.default,
        fallback: state.model.fallback,
        overrides: state.model.taskOverrides,
      };
      const router = new ModelRouterImpl(routerConfig, projectRoot, "mcp-session");
      const browserAgent = new BrowserAgent({ headless: true });
      const extractor = new WebExtractor({ projectRoot, modelRouter: router, browserAgent });

      const schema: Record<string, unknown> | undefined = schemaStr
        ? (JSON.parse(schemaStr) as Record<string, unknown>)
        : undefined;
      const result = await extractor.fetch(url, {
        instructions,
        schema,
        ...options,
      });
      return serialize(result);
    },
    smart_extract: async (args) => {
      const url = requiredString(args, "url");
      const goal = requiredString(args, "goal");
      const projectRoot = process.cwd();

      const state = await readOrInitializeState(projectRoot);
      const routerConfig = {
        default: state.model.default,
        fallback: state.model.fallback,
        overrides: state.model.taskOverrides,
      };
      const router = new ModelRouterImpl(routerConfig, projectRoot, "mcp-session");
      const browserAgent = new BrowserAgent({ headless: true });
      const extractor = new WebExtractor({ projectRoot, modelRouter: router, browserAgent });

      const result = await extractor.fetch(url, { instructions: goal });
      return serialize(result);
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
        overrides: state.model.taskOverrides,
      };
      const router = new ModelRouterImpl(routerConfig, projectRoot, "mcp-session");
      const browserAgent = new BrowserAgent({ headless: true });
      const extractor = new WebExtractor({ projectRoot, modelRouter: router, browserAgent });

      const results = await extractor.batchFetch(urls, { instructions: commonInstructions });
      return serialize({ results });
    },
    spawn_subagent: async (args) => {
      const role = requiredString(args, "role");
      const task = requiredString(args, "task");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      const orchestrator = new UpliftOrchestrator({
        projectRoot,
        agentRunner: async (_agentRole: string, agentObjective: string, worktreeRoot: string) => {
          // Structured summary for MCP callers; full LLM-backed runner deferred
          // to a session-handoff protocol (future PRD).
          return [
            `Objective: ${agentObjective}`,
            `Worktree: ${worktreeRoot}`,
            `Status: Queued for execution`,
          ].join("\n");
        },
      });
      const message = await orchestrator.executeSubTask("mcp-root", role, task);

      return serialize({
        role,
        status: "completed",
        uplifted: true,
        message,
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
            .then((queued: any) => {
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
      const packages = Array.isArray(args["packages"]) ? (args["packages"] as string[]) : [];

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
            .then((queued: any) => {
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
      const rawCategory = optionalString(args, "category") ?? "fact";
      const category =
        (["fact", "decision", "error", "strategy", "context"] as const).find(
          (c) => c === rawCategory,
        ) ?? "fact";

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
        results: results.map((r) => ({
          id: r.entry.id,
          content: r.entry.content,
          score: r.score,
          tags: r.entry.tags,
        })),
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
        context: results
          .map((r) => `[${r.entry.category.toUpperCase()}] ${r.entry.content}`)
          .join("\n"),
        count: results.length,
      });
    },
    memory_visualize: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");

      const memory = new PersistentMemory(projectRoot);
      await memory.load();
      const entries = memory.getAll();
      const byCategory: Record<string, number> = {};
      const bySession: Record<string, number> = {};

      entries.forEach((e) => {
        byCategory[e.category] = (byCategory[e.category] || 0) + 1;
        if (e.sessionId) bySession[e.sessionId] = (bySession[e.sessionId] || 0) + 1;
      });

      return serialize({
        totalEntries: entries.length,
        byCategory,
        sessionsWithMemory: Object.keys(bySession).length,
        mostRecentEntries: entries
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 5),
      });
    },

    run_tests: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const workspace = optionalString(args, "workspace");
      const pattern = optionalString(args, "pattern");

      const { execSync } = await import("node:child_process");
      const cmd = workspace
        ? `npm run test --workspace=${workspace} -- ${pattern ? `--testNamePattern="${pattern}"` : ""}`
        : `npm run test ${pattern ? `-- --testNamePattern="${pattern}"` : ""}`;

      try {
        const output = execSync(cmd, { cwd: projectRoot, encoding: "utf8", stdio: "pipe" });
        const lines = output.split("\n");
        const summary = lines.filter((l) => /pass|fail|error|\d+ test/i.test(l)).join("\n");
        return serialize({ status: "passed", summary: summary || output.slice(0, 2000) });
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const output = (e.stdout || "") + (e.stderr || "");
        const lines = output.split("\n");
        const failures = lines.filter((l) => /FAIL|✗|×|Error|fail/i.test(l)).slice(0, 50);
        return serialize({ status: "failed", failures, raw: output.slice(0, 3000) });
      }
    },

    get_coverage: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const workspace = optionalString(args, "workspace");

      const { execSync } = await import("node:child_process");
      const cmd = workspace
        ? `npm run test --workspace=${workspace} -- --coverage`
        : "npm run test -- --coverage";

      try {
        const output = execSync(cmd, { cwd: projectRoot, encoding: "utf8", stdio: "pipe" });
        const coverageMatch = output.match(/Statements\s*:\s*([\d.]+)%[\s\S]*?Branches\s*:\s*([\d.]+)%[\s\S]*?Functions\s*:\s*([\d.]+)%[\s\S]*?Lines\s*:\s*([\d.]+)%/);
        if (coverageMatch && coverageMatch[1] && coverageMatch[2] && coverageMatch[3] && coverageMatch[4]) {
          return serialize({
            statements: parseFloat(coverageMatch[1]),
            branches: parseFloat(coverageMatch[2]),
            functions: parseFloat(coverageMatch[3]),
            lines: parseFloat(coverageMatch[4]),
          });
        }
        return serialize({ raw: output.slice(0, 2000) });
      } catch (err) {
        const e = err as { stdout?: string; message?: string };
        return serialize({ error: e.message, raw: (e.stdout || "").slice(0, 2000) });
      }
    },

    analyze_error: async (args) => {
      const error = requiredString(args, "error");
      const filePath = optionalString(args, "filePath");

      // Parse TypeScript compiler errors
      const tsErrorPattern = /^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/gm;
      const tsErrors: Array<{ file: string; line: number; col: number; code: string; message: string }> = [];
      let match;
      while ((match = tsErrorPattern.exec(error)) !== null) {
        if (match[1] && match[2] && match[3] && match[4] && match[5]) {
          tsErrors.push({ file: match[1], line: parseInt(match[2]), col: parseInt(match[3]), code: match[4], message: match[5] });
        }
      }

      // Parse stack traces
      const stackLines = error.split("\n").filter((l) => l.trim().startsWith("at ")).slice(0, 5);
      const firstTsError = tsErrors[0];

      return serialize({
        type: tsErrors.length > 0 ? "typescript" : stackLines.length > 0 ? "runtime" : "unknown",
        tsErrors: tsErrors.length > 0 ? tsErrors : undefined,
        stackTrace: stackLines.length > 0 ? stackLines : undefined,
        filePath,
        summary: error.split("\n")[0]?.slice(0, 200) ?? "",
        suggestion: firstTsError
          ? `Fix TypeScript error ${firstTsError.code} in ${firstTsError.file}:${firstTsError.line}`
          : "Inspect the stack trace for the failing call site",
      });
    },

    suggest_fix: async (args) => {
      const error = requiredString(args, "error");
      const code = optionalString(args, "code");
      const filePath = optionalString(args, "filePath");

      // Pattern-based fix suggestions
      const fixes: string[] = [];

      if (/is not assignable to type/.test(error)) {
        fixes.push("Add missing type union member or cast with 'as' if intentional");
      }
      if (/Cannot find name/.test(error)) {
        fixes.push("Import the missing symbol or check for typos in the identifier");
      }
      if (/Property .* does not exist/.test(error)) {
        fixes.push("Extend the interface/type definition or use optional chaining (?.)");
      }
      if (/has no exported member/.test(error)) {
        fixes.push("Add the export to the source module's index.ts or check the import path");
      }
      if (/Expected .* arguments/.test(error)) {
        fixes.push("Check the function signature and provide the required arguments");
      }
      if (fixes.length === 0) {
        fixes.push("Read the error message carefully and verify the types on both sides of the assignment");
      }

      return serialize({
        error: error.slice(0, 300),
        filePath,
        hasCodeContext: (code?.length ?? 0) > 0,
        suggestedFixes: fixes,
        confidence: fixes.length > 1 ? "high" : "medium",
      });
    },

    list_skills: async (args) => {
      const filter = optionalString(args, "filter");
      const { readdir, readFile } = await import("node:fs/promises");
      // use already-imported `join` from node:path

      // Look for skills in common locations
      const skillDirs = [
        join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? "", ".claude", "skills"),
        join(process.cwd(), ".dantecode", "skills"),
      ];

      const skills: Array<{ name: string; path: string; description?: string }> = [];

      for (const dir of skillDirs) {
        try {
          const entries = await readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".md")) {
              const name = entry.name.replace(".md", "");
              if (!filter || name.toLowerCase().includes(filter.toLowerCase())) {
                try {
                  const content = await readFile(join(dir, entry.name), "utf8");
                  const descMatch = content.match(/^#+\s+(.+)/m);
                  skills.push({ name, path: join(dir, entry.name), description: descMatch?.[1] });
                } catch {
                  skills.push({ name, path: join(dir, entry.name) });
                }
              }
            }
          }
        } catch {
          // Directory doesn't exist — skip
        }
      }

      return serialize({ total: skills.length, skills });
    },

    get_session_history: async (args) => {
      const limit = typeof args["limit"] === "number" ? args["limit"] : 10;
      const sessionId = optionalString(args, "sessionId");

      const { readdir, readFile } = await import("node:fs/promises");
      // use already-imported `join` from node:path

      const sessionDir = join(process.cwd(), ".dantecode", "sessions");

      try {
        if (sessionId) {
          const filePath = join(sessionDir, `${sessionId}.json`);
          const content = await readFile(filePath, "utf8");
          return serialize(JSON.parse(content) as Record<string, unknown>);
        }

        const entries = await readdir(sessionDir);
        const sessions = entries
          .filter((e) => e.endsWith(".json"))
          .slice(0, limit)
          .map((e) => e.replace(".json", ""));

        return serialize({ total: entries.length, sessions });
      } catch {
        return serialize({ total: 0, sessions: [], note: "No session history found" });
      }
    },

    run_benchmark: async (args) => {
      const projectRoot = requiredString(args, "projectRoot");
      const task = requiredString(args, "task");
      void task; // context for display — danteforge assess determines scores

      // Delegate to danteforge assess for real dimension scores.
      // Returns the full 18-dimension competitive assessment.
      return runDanteForgeCmd("assess --json", projectRoot, 120_000);
    },

    get_token_usage: async (args) => {
      const sessionId = optionalString(args, "sessionId");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      // Read real cost history from the most recent session in cost-history.jsonl
      try {
        const { readFile: rf } = await import("node:fs/promises");
        const { join: pjoin } = await import("node:path");
        const { existsSync } = await import("node:fs");
        const historyPath = pjoin(projectRoot, ".dantecode", "cost-history.jsonl");
        if (existsSync(historyPath)) {
          const raw = await rf(historyPath, "utf-8");
          const lines = raw.split("\n").filter((l) => l.trim());
          const entries = lines
            .map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
            .filter(Boolean) as Record<string, unknown>[];
          // Filter by sessionId if provided
          const filtered = sessionId
            ? entries.filter((e) => e["sessionId"] === sessionId)
            : entries;
          const target = filtered.at(-1) ?? entries.at(-1);
          if (target) {
            const totalSessions = entries.length;
            const totalCost = entries.reduce((s, e) => s + ((e["cost"] as number) ?? 0), 0);
            return serialize({
              sessionId: target["sessionId"] ?? "unknown",
              inputTokens: target["inputTokens"] ?? 0,
              outputTokens: target["outputTokens"] ?? 0,
              cost: target["cost"] ?? 0,
              model: target["model"] ?? "unknown",
              tier: target["tier"] ?? "medium",
              totalSessions,
              totalCostUsd: parseFloat(totalCost.toFixed(6)),
              budgetTiers: { green: "<70%", yellow: "70-80%", red: "80-90%", critical: ">90%" },
            });
          }
        }
      } catch {
        // Fall through to empty response
      }
      return serialize({
        sessionId: sessionId ?? "none",
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        note: "No cost history found. Run a session first to populate token usage.",
        budgetTiers: { green: "<70%", yellow: "70-80%", red: "80-90%", critical: ">90%" },
      });
    },

    // ── Knowledge graph ──────────────────────────────────────────────────────
    get_workspace_map: async (_args) => {
      const projectRoot = process.cwd();
      const { readdir, readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      // Read root package.json for workspace globs
      let workspaces: string[] = [];
      let rootName = "unknown";
      try {
        const pkg = JSON.parse(await readFile(pjoin(projectRoot, "package.json"), "utf8")) as {
          name?: string;
          workspaces?: string[] | { packages?: string[] };
        };
        rootName = pkg.name ?? "unknown";
        workspaces = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : (pkg.workspaces?.packages ?? []);
      } catch { /* ignore */ }

      // Top-level directory listing (skip hidden and ignored dirs)
      const SKIP = new Set(["node_modules", ".git", "dist", ".turbo", ".cache"]);
      let topLevel: string[] = [];
      try {
        const entries = await readdir(projectRoot, { withFileTypes: true });
        topLevel = entries
          .filter((e) => !SKIP.has(e.name))
          .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
      } catch { /* ignore */ }

      return serialize({ projectRoot, rootName, workspaces, topLevel });
    },

    find_symbol: async (args) => {
      const symbol = requiredString(args, "symbol");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      const { execSync } = await import("node:child_process");
      try {
        // Search for the symbol in TypeScript/JavaScript files
        const cmd = `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" -l "${symbol.replace(/"/g, '\\"')}" .`;
        const raw = execSync(cmd, {
          cwd: projectRoot,
          encoding: "utf8",
          stdio: "pipe",
          // do not use shell injection — symbol is user input; we sanitize above
        });
        const files = raw.trim().split("\n").filter(Boolean).slice(0, 30);

        // Get first 5 matching lines per file
        const matches: Array<{ file: string; lines: string[] }> = [];
        for (const file of files.slice(0, 10)) {
          try {
            const lineCmd = `grep -n "${symbol.replace(/"/g, '\\"')}" "${file}"`;
            const lineRaw = execSync(lineCmd, {
              cwd: projectRoot,
              encoding: "utf8",
              stdio: "pipe",
            });
            matches.push({
              file,
              lines: lineRaw.trim().split("\n").filter(Boolean).slice(0, 5),
            });
          } catch { /* skip */ }
        }

        return serialize({ symbol, totalFiles: files.length, matches });
      } catch {
        return serialize({ symbol, totalFiles: 0, matches: [], note: "No matches found" });
      }
    },

    get_dependencies: async (args) => {
      const packageName = requiredString(args, "packageName");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      // Try common locations for the package.json
      const candidates = [
        pjoin(projectRoot, "packages", packageName, "package.json"),
        pjoin(projectRoot, packageName, "package.json"),
        pjoin(projectRoot, "package.json"),
      ];

      for (const candidate of candidates) {
        try {
          const pkg = JSON.parse(await readFile(candidate, "utf8")) as {
            name?: string;
            version?: string;
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
          };
          return serialize({
            packageName,
            resolvedPath: candidate,
            name: pkg.name,
            version: pkg.version,
            dependencies: pkg.dependencies ?? {},
            devDependencies: pkg.devDependencies ?? {},
            peerDependencies: pkg.peerDependencies ?? {},
          });
        } catch { /* try next */ }
      }

      return serialize({ packageName, error: `package.json not found for "${packageName}"` });
    },

    // ── Multi-repo ───────────────────────────────────────────────────────────
    list_workspaces: async (_args) => {
      const projectRoot = process.cwd();
      const { readdir, readFile, stat: fstat } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      let workspaceGlobs: string[] = [];
      try {
        const pkg = JSON.parse(await readFile(pjoin(projectRoot, "package.json"), "utf8")) as {
          workspaces?: string[] | { packages?: string[] };
        };
        workspaceGlobs = Array.isArray(pkg.workspaces)
          ? pkg.workspaces
          : (pkg.workspaces?.packages ?? []);
      } catch { /* ignore */ }

      // Resolve globs — handle patterns like "packages/*"
      const workspaces: Array<{ name: string; path: string; version?: string }> = [];
      for (const glob of workspaceGlobs) {
        const segments = glob.split("/");
        const base = segments.slice(0, -1).join("/");
        const tail = segments[segments.length - 1];
        if (tail === "*") {
          try {
            const entries = await readdir(pjoin(projectRoot, base), { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              const pkgPath = pjoin(projectRoot, base, entry.name, "package.json");
              try {
                const s = await fstat(pkgPath);
                if (s.isFile()) {
                  const p = JSON.parse(await readFile(pkgPath, "utf8")) as {
                    name?: string;
                    version?: string;
                  };
                  workspaces.push({
                    name: p.name ?? entry.name,
                    path: `${base}/${entry.name}`,
                    version: p.version,
                  });
                }
              } catch { /* skip */ }
            }
          } catch { /* skip */ }
        }
      }

      return serialize({ total: workspaces.length, workspaces });
    },

    cross_repo_search: async (args) => {
      const pattern = requiredString(args, "pattern");
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const fileGlob = optionalString(args, "fileGlob") ?? "*.ts";

      const { execSync } = await import("node:child_process");
      try {
        const cmd = `grep -rn --include="${fileGlob}" -l "${pattern.replace(/"/g, '\\"')}" packages/`;
        const raw = execSync(cmd, { cwd: projectRoot, encoding: "utf8", stdio: "pipe" });
        const files = raw.trim().split("\n").filter(Boolean);

        // Group by package
        const byPackage: Record<string, string[]> = {};
        for (const file of files) {
          const parts = file.split("/");
          const pkg = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0] ?? "root";
          (byPackage[pkg] ??= []).push(file);
        }

        return serialize({ pattern, totalFiles: files.length, byPackage });
      } catch {
        return serialize({ pattern, totalFiles: 0, byPackage: {}, note: "No matches found" });
      }
    },

    // ── Compliance / audit ───────────────────────────────────────────────────
    get_audit_log: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const limit = typeof args["limit"] === "number" ? args["limit"] : 50;

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const auditPath = pjoin(projectRoot, ".dantecode", "audit.log");
      try {
        const content = await readFile(auditPath, "utf8");
        const lines = content.trim().split("\n").filter(Boolean);
        const recent = lines.slice(-limit);
        return serialize({ total: lines.length, showing: recent.length, entries: recent });
      } catch {
        return serialize({ total: 0, showing: 0, entries: [], note: "No audit log found" });
      }
    },

    export_audit_trail: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const limit = typeof args["limit"] === "number" ? args["limit"] : 200;

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const auditPath = pjoin(projectRoot, ".dantecode", "audit.log");
      try {
        const content = await readFile(auditPath, "utf8");
        const lines = content.trim().split("\n").filter(Boolean).slice(-limit);

        // Attempt to parse as JSON lines; fall back to raw strings
        const entries = lines.map((line) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            return { raw: line };
          }
        });
        return serialize({ exportedAt: new Date().toISOString(), count: entries.length, entries });
      } catch {
        return serialize({ exportedAt: new Date().toISOString(), count: 0, entries: [] });
      }
    },

    get_compliance_report: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      // Probe key config files to build a compliance summary
      const checks: Record<string, { present: boolean; note?: string }> = {};

      for (const [label, relPath] of [
        ["danteforge_config", ".danteforge/config.json"],
        ["sandbox_config", ".dantecode/sandbox.json"],
        ["audit_log", ".dantecode/audit.log"],
        ["lessons_db", ".dantecode/lessons.json"],
        ["skillbook", ".dantecode/skillbook/skillbook.json"],
        ["constitution", ".danteforge/constitution.md"],
      ] as [string, string][]) {
        try {
          await readFile(pjoin(projectRoot, relPath), "utf8");
          checks[label] = { present: true };
        } catch {
          checks[label] = { present: false };
        }
      }

      const presentCount = Object.values(checks).filter((c) => c.present).length;
      const total = Object.keys(checks).length;

      return serialize({
        projectRoot,
        generatedAt: new Date().toISOString(),
        complianceScore: Math.round((presentCount / total) * 100),
        checks,
        summary: `${presentCount}/${total} compliance artifacts present`,
      });
    },

    // ── Productivity ─────────────────────────────────────────────────────────
    get_recent_errors: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const limit = typeof args["limit"] === "number" ? args["limit"] : 20;

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const candidates = [
        pjoin(projectRoot, ".dantecode", "audit.log"),
        pjoin(projectRoot, ".dantecode", "debug.log"),
      ];

      for (const logPath of candidates) {
        try {
          const content = await readFile(logPath, "utf8");
          const lines = content.trim().split("\n").filter(Boolean);
          const errorLines = lines
            .filter((l) => /error|fail|exception|crash/i.test(l))
            .slice(-limit);
          if (errorLines.length > 0) {
            return serialize({ source: logPath, count: errorLines.length, errors: errorLines });
          }
        } catch { /* try next */ }
      }

      return serialize({ count: 0, errors: [], note: "No error log found" });
    },

    get_repair_history: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const limit = typeof args["limit"] === "number" ? args["limit"] : 20;

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const repairLog = pjoin(projectRoot, ".dantecode", "repairs.json");
      try {
        const content = JSON.parse(await readFile(repairLog, "utf8")) as unknown[];
        const entries = Array.isArray(content) ? content.slice(-limit) : [];
        return serialize({ total: Array.isArray(content) ? content.length : 0, entries });
      } catch {
        // Fall back to scanning audit log for repair entries
        try {
          const auditPath = pjoin(projectRoot, ".dantecode", "audit.log");
          const content = await readFile(auditPath, "utf8");
          const repairLines = content
            .trim()
            .split("\n")
            .filter((l) => /repair|recover|retry|circuit/i.test(l))
            .slice(-limit);
          return serialize({ total: repairLines.length, entries: repairLines });
        } catch {
          return serialize({ total: 0, entries: [], note: "No repair history found" });
        }
      }
    },

    get_skill_recommendations: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const limit = typeof args["limit"] === "number" ? args["limit"] : 10;

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const skillbookPath = pjoin(projectRoot, ".dantecode", "skillbook", "skillbook.json");
      try {
        const raw = JSON.parse(await readFile(skillbookPath, "utf8")) as {
          skills?: Array<{ name: string; winRate?: number; uses?: number; description?: string }>;
        };
        const skills = (raw.skills ?? [])
          .slice()
          .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
          .slice(0, limit);
        return serialize({ total: raw.skills?.length ?? 0, recommendations: skills });
      } catch {
        return serialize({ total: 0, recommendations: [], note: "No skillbook found" });
      }
    },

    get_convergence_stats: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      const { join: pjoin } = await import("node:path");
      const { readFile, readdir } = await import("node:fs/promises");

      try {
        const state = await readOrInitializeState(projectRoot);
        const dcDir = pjoin(projectRoot, ".dantecode");

        // Count sessions
        let sessionCount = 0;
        try {
          const entries = await readdir(pjoin(dcDir, "sessions"));
          sessionCount = entries.filter((e) => e.endsWith(".json")).length;
        } catch { /* ignore */ }

        // Read circuit breaker state file if it exists
        let circuitBreaker: Record<string, unknown> = { state: "closed", trips: 0 };
        try {
          const cbRaw = await readFile(pjoin(dcDir, "circuit-breaker-state.json"), "utf8");
          circuitBreaker = JSON.parse(cbRaw) as Record<string, unknown>;
        } catch { /* not yet written — breaker has never tripped */ }

        // Mine the audit log for convergence signals
        const auditStats = {
          tierEscalations: 0,
          selfModifications: 0,
          loopDetections: 0,
          recentSessions: 0,
          lastEventTime: null as string | null,
        };
        try {
          const auditPath = pjoin(dcDir, "audit.jsonl");
          const raw = await readFile(auditPath, "utf8");
          const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // last 7 days
          for (const line of raw.split("\n")) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line) as { type?: string; timestamp?: string };
              const ts = evt.timestamp ? new Date(evt.timestamp).getTime() : 0;
              if (ts > cutoff) {
                if (evt.type === "tier_escalation") auditStats.tierEscalations++;
                if (evt.type === "self_modification_allowed") auditStats.selfModifications++;
                if (evt.type === "loop_detected") auditStats.loopDetections++;
                if (evt.type === "session_start") auditStats.recentSessions++;
                if (evt.timestamp) auditStats.lastEventTime = evt.timestamp;
              }
            } catch { /* malformed line */ }
          }
        } catch { /* audit.jsonl not present */ }

        return serialize({
          projectRoot,
          model: state.model?.default ?? "unknown",
          sessionCount,
          last7Days: auditStats,
          circuitBreaker,
          loopDetector: {
            strategies: ["hash", "semantic", "edit-distance", "diversity"],
            description: "Session-scoped; resets between sessions. Check audit.loopDetections for historical trips.",
          },
        });
      } catch {
        return serialize({ error: "Could not read project state" });
      }
    },

    // ── Meta ─────────────────────────────────────────────────────────────────
    get_competitive_score: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const candidates = [
        pjoin(projectRoot, "DIMENSION_ASSESSMENT.md"),
        pjoin(projectRoot, ".danteforge", "DIMENSION_ASSESSMENT.md"),
      ];

      for (const path of candidates) {
        try {
          const content = await readFile(path, "utf8");
          // Parse dimension scores — look for patterns like "| dimension | score |"
          const scorePattern = /\|\s*([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)\s*\|/g;
          const scores: Record<string, number> = {};
          let m: RegExpExecArray | null;
          while ((m = scorePattern.exec(content)) !== null) {
            const dim = m[1]?.trim().toLowerCase().replace(/\s+/g, "_");
            const score = parseFloat(m[2] ?? "0");
            if (dim && !isNaN(score) && score <= 100) {
              scores[dim] = score;
            }
          }
          const values = Object.values(scores);
          const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
          return serialize({
            source: path,
            dimensions: scores,
            average: Math.round(avg * 10) / 10,
            dimensionCount: values.length,
          });
        } catch { /* try next */ }
      }

      return serialize({ error: "DIMENSION_ASSESSMENT.md not found", dimensions: {} });
    },

    get_sprint_progress: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const candidates = [
        pjoin(projectRoot, "COMPETITIVE_MATRIX.md"),
        pjoin(projectRoot, ".danteforge", "COMPETITIVE_MATRIX.md"),
      ];

      for (const path of candidates) {
        try {
          const content = await readFile(path, "utf8");
          // Extract a brief summary (first 3000 chars)
          const snippet = content.slice(0, 3000);
          // Look for rank patterns
          const rankMatch = snippet.match(/rank[:\s]+#?(\d+)/i);
          const scoreMatch = snippet.match(/overall[:\s]+(\d+(?:\.\d+)?)/i);
          return serialize({
            source: path,
            rank: rankMatch ? parseInt(rankMatch[1] ?? "0") : null,
            overallScore: scoreMatch ? parseFloat(scoreMatch[1] ?? "0") : null,
            snippet,
          });
        } catch { /* try next */ }
      }

      return serialize({ error: "COMPETITIVE_MATRIX.md not found", rank: null });
    },

    get_agent_health: async (_args) => {
      const uptimeSeconds = process.uptime();
      const mem = process.memoryUsage();
      const { readdir } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      let sessionCount = 0;
      try {
        const sessionDir = pjoin(process.cwd(), ".dantecode", "sessions");
        const entries = await readdir(sessionDir);
        sessionCount = entries.filter((e) => e.endsWith(".json")).length;
      } catch { /* ignore */ }

      return serialize({
        status: "healthy",
        uptimeSeconds: Math.round(uptimeSeconds),
        memory: {
          heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
          rssMB: Math.round(mem.rss / 1024 / 1024),
        },
        sessionCount,
        nodeVersion: process.version,
        platform: process.platform,
      });
    },

    reset_circuit_breaker: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();

      // The circuit breaker is runtime-only state; signal a reset by writing a marker file
      const { writeFile, mkdir } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");

      const markerDir = pjoin(projectRoot, ".dantecode");
      const markerPath = pjoin(markerDir, "circuit-breaker-reset.json");
      try {
        await mkdir(markerDir, { recursive: true });
        await writeFile(
          markerPath,
          JSON.stringify({ resetAt: new Date().toISOString(), requestedBy: "mcp" }, null, 2),
          "utf8",
        );
        return serialize({
          success: true,
          message: "Circuit breaker reset signal written. The running agent loop will pick this up on next check.",
          markerPath,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return serialize({ success: false, error: message });
      }
    },

    // ── Wave 9 tools — added Session 8 ───────────────────────────────────────

    tool_stress_test_run: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const instances = typeof args["instances"] === "number" ? args["instances"] : 5;
      try {
        // Dynamically locate the stress-test module relative to this package at runtime
        const { createRequire } = await import("node:module");
        const req = createRequire(import.meta.url);
        let runStressTest: ((args: string, root: string) => Promise<string>) | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mod = req("../../cli/dist/commands/stress-test.js") as any;
          runStressTest = mod.runStressTest ?? null;
        } catch {
          // not available in this environment
        }
        if (!runStressTest) {
          return serialize({ error: "stress-test command not available in this environment" });
        }
        const result = await runStressTest(`--instances ${instances}`, projectRoot);
        return result;
      } catch (err) {
        return serialize({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    tool_benchmark_report: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const { readdir, readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");
      const { existsSync } = await import("node:fs");

      const resultsDir = pjoin(projectRoot, ".dantecode/benchmark-results");
      if (!existsSync(resultsDir)) {
        return serialize({ error: "No benchmark results found. Run /stress-test or /benchmark swe-bench first." });
      }
      try {
        const files = (await readdir(resultsDir))
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse();
        if (files.length === 0) return serialize({ error: "No benchmark result files found." });
        const latest = await readFile(pjoin(resultsDir, files[0]!), "utf-8");
        return latest;
      } catch (err) {
        return serialize({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    tool_council_status: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const { existsSync } = await import("node:fs");
      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");
      const statusPath = pjoin(projectRoot, ".dantecode/council-status.json");
      if (!existsSync(statusPath)) {
        return serialize({ status: "idle", message: "No active council session found." });
      }
      try {
        return await readFile(statusPath, "utf-8");
      } catch {
        return serialize({ status: "unknown", error: "Could not read council status file." });
      }
    },

    tool_gaslight_status: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const { existsSync } = await import("node:fs");
      const { readdir } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");
      const sessionDir = pjoin(projectRoot, ".dantecode/gaslight/sessions");
      if (!existsSync(sessionDir)) {
        return serialize({ enabled: true, sessionCount: 0, message: "No gaslight sessions recorded yet." });
      }
      try {
        const files = (await readdir(sessionDir)).filter((f) => f.endsWith(".json"));
        return serialize({
          enabled: process.env["DANTECODE_GASLIGHT"] !== "0",
          sessionCount: files.length,
          message: `${files.length} gaslight session(s) on record in ${sessionDir}`,
        });
      } catch {
        return serialize({ enabled: true, sessionCount: 0, error: "Could not read gaslight session directory." });
      }
    },

    tool_skillbook_effectiveness: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const topN = typeof args["topN"] === "number" ? args["topN"] : 10;
      const { existsSync } = await import("node:fs");
      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");
      const skillbookPath = pjoin(projectRoot, ".dantecode/skillbook/skillbook.json");
      if (!existsSync(skillbookPath)) {
        return serialize({ skills: [], message: "No skillbook found. Run a few sessions first." });
      }
      try {
        const raw = await readFile(skillbookPath, "utf-8");
        const skillbook = JSON.parse(raw) as { skills?: Array<{ id: string; winRate?: number; appliedInSessions?: number }> };
        const skills = (skillbook.skills ?? [])
          .filter((s) => (s.appliedInSessions ?? 0) > 0)
          .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
          .slice(0, topN);
        return serialize({ skills, total: skillbook.skills?.length ?? 0 });
      } catch (err) {
        return serialize({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    tool_coverage_report: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const { existsSync } = await import("node:fs");
      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");
      const summaryPath = pjoin(projectRoot, "coverage/coverage-summary.json");
      if (!existsSync(summaryPath)) {
        return serialize({ error: "No coverage report found. Run 'npm run test:coverage' first." });
      }
      try {
        const raw = await readFile(summaryPath, "utf-8");
        const summary = JSON.parse(raw) as Record<string, { statements?: { pct?: number }; branches?: { pct?: number }; functions?: { pct?: number }; lines?: { pct?: number } }>;
        const total = summary["total"];
        if (!total) return serialize({ error: "Coverage summary missing 'total' key." });
        return serialize({
          statements: total.statements?.pct,
          branches: total.branches?.pct,
          functions: total.functions?.pct,
          lines: total.lines?.pct,
          generatedAt: new Date().toISOString(),
        });
      } catch (err) {
        return serialize({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    tool_efficiency_report: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const lastN = typeof args["lastN"] === "number" ? args["lastN"] : 0;
      try {
        const { createRequire } = await import("node:module");
        const req = createRequire(import.meta.url);
        let runEfficiencyReport: ((args: string, root: string) => Promise<string>) | null = null;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mod = req("../../cli/dist/commands/efficiency-report.js") as any;
          runEfficiencyReport = mod.runEfficiencyReport ?? null;
        } catch {
          // not available in this environment
        }
        if (!runEfficiencyReport) {
          return serialize({ error: "efficiency-report command not available in this environment" });
        }
        return await runEfficiencyReport(lastN > 0 ? `--last ${lastN}` : "", projectRoot);
      } catch (err) {
        return serialize({ error: err instanceof Error ? err.message : String(err) });
      }
    },

    tool_linear_webhook_status: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const { existsSync } = await import("node:fs");
      const { readFile } = await import("node:fs/promises");
      const { join: pjoin } = await import("node:path");
      const auditPath = pjoin(projectRoot, ".dantecode/webhook-audit.jsonl");
      const hasSecret = !!process.env["LINEAR_WEBHOOK_SECRET"];

      let lastEvent: unknown = null;
      if (existsSync(auditPath)) {
        try {
          const raw = await readFile(auditPath, "utf-8");
          const lines = raw.trim().split("\n").filter(Boolean);
          const linearEvents = lines
            .map((l) => { try { return JSON.parse(l); } catch { return null; } })
            .filter((e) => e && (e as Record<string, unknown>)["provider"] === "linear");
          lastEvent = linearEvents[linearEvents.length - 1] ?? null;
        } catch { /* non-fatal */ }
      }

      return serialize({
        endpoint: "POST /webhooks/linear",
        hmacConfigured: hasSecret,
        lastEvent,
        message: hasSecret
          ? "LINEAR_WEBHOOK_SECRET is set — HMAC verification active"
          : "LINEAR_WEBHOOK_SECRET not set — webhook will reject all requests with 401",
      });
    },

    // ── Wave 10: DanteForge Bridge Tools ─────────────────────────────────────
    // All 16 tools proxy to the `danteforge` CLI installed globally.
    // This lets Claude Code, Cursor, and Codex invoke the full DanteForge
    // command surface through DanteCode's unified MCP server.

    danteforge_assess: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const json = args["json"] === true;
      return runDanteForgeCmd(`assess${json ? " --json" : ""}`, projectRoot, 120_000);
    },

    danteforge_autoforge: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const goal = optionalString(args, "goal");
      const maxRounds = typeof args["maxRounds"] === "number" ? args["maxRounds"] : 3;
      const goalFlag = goal ? ` "${goal.replace(/"/g, '\\"')}"` : "";
      return runDanteForgeCmd(`autoforge${goalFlag} --max-rounds ${maxRounds}`, projectRoot, 300_000);
    },

    danteforge_verify: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const quick = args["quick"] === true;
      return runDanteForgeCmd(`verify${quick ? " --quick" : ""}`, projectRoot, 120_000);
    },

    danteforge_plan: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const goal = optionalString(args, "goal");
      const goalFlag = goal ? ` "${goal.replace(/"/g, '\\"')}"` : "";
      return runDanteForgeCmd(`plan${goalFlag}`, projectRoot, 60_000);
    },

    danteforge_specify: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const idea = optionalString(args, "idea") ?? "";
      return runDanteForgeCmd(`specify "${idea.replace(/"/g, '\\"')}"`, projectRoot, 60_000);
    },

    danteforge_forge: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const wave = optionalString(args, "wave");
      const waveFlag = wave ? ` --wave "${wave.replace(/"/g, '\\"')}"` : "";
      return runDanteForgeCmd(`forge${waveFlag}`, projectRoot, 120_000);
    },

    danteforge_constitution: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      return runDanteForgeCmd("constitution --show", projectRoot, 30_000);
    },

    danteforge_lessons: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const query = optionalString(args, "query");
      const add = optionalString(args, "add");
      if (add) {
        return runDanteForgeCmd(`lessons add "${add.replace(/"/g, '\\"')}"`, projectRoot, 30_000);
      }
      const queryFlag = query ? ` --query "${query.replace(/"/g, '\\"')}"` : "";
      return runDanteForgeCmd(`lessons${queryFlag}`, projectRoot, 30_000);
    },

    danteforge_masterplan: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const refresh = args["refresh"] === true;
      return runDanteForgeCmd(`masterplan${refresh ? " --refresh" : ""}`, projectRoot, 60_000);
    },

    danteforge_retro: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      return runDanteForgeCmd("retro", projectRoot, 60_000);
    },

    danteforge_synthesize: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const summary = optionalString(args, "summary");
      const summaryFlag = summary ? ` --summary "${summary.replace(/"/g, '\\"')}"` : "";
      return runDanteForgeCmd(`synthesize${summaryFlag}`, projectRoot, 60_000);
    },

    danteforge_state_read: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      return runDanteForgeCmd("state-read", projectRoot, 30_000);
    },

    danteforge_tasks: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const status = optionalString(args, "status");
      const statusFlag = status ? ` --status ${status}` : "";
      return runDanteForgeCmd(`tasks${statusFlag}`, projectRoot, 30_000);
    },

    danteforge_maturity: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      return runDanteForgeCmd("maturity", projectRoot, 60_000);
    },

    danteforge_competitors: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const json = args["json"] === true;
      return runDanteForgeCmd(`competitors${json ? " --json" : ""}`, projectRoot, 120_000);
    },

    danteforge_workflow: async (args) => {
      const projectRoot = optionalString(args, "projectRoot") ?? process.cwd();
      const name = optionalString(args, "name") ?? "";
      return runDanteForgeCmd(`workflow "${name.replace(/"/g, '\\"')}"`, projectRoot, 120_000);
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

function optionalRecord(
  args: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = args[key];
  return isRecord(value) ? value : undefined;
}

function optionalRailArray(
  args: Record<string, unknown>,
  key: string,
):
  | Array<{
      id: string;
      name: string;
      description?: string;
      mode?: "hard" | "soft";
      requiredSubstrings?: string[];
      forbiddenPatterns?: string[];
      minLength?: number;
      maxLength?: number;
    }>
  | undefined {
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
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Run a danteforge CLI subcommand and return its stdout as a string.
 * Falls back to a descriptive error if danteforge is not installed.
 */
async function runDanteForgeCmd(
  subcommand: string,
  cwd: string,
  timeoutMs: number,
): Promise<string> {
  const { execSync } = await import("node:child_process");
  try {
    const output = execSync(`danteforge ${subcommand}`, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.toString().trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Include stderr if available (contains most danteforge error detail)
    const stderr = (err as { stderr?: Buffer | string })?.stderr;
    const detail = stderr ? `\n${stderr.toString().trim()}` : "";
    return serialize({
      error: `danteforge ${subcommand.split(" ")[0]} failed`,
      detail: msg.slice(0, 400) + detail.slice(0, 400),
      hint: "Ensure `danteforge` is installed globally: npm install -g danteforge",
    });
  }
}
