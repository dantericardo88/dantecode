import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { CodeIndex, createEmbeddingProvider } from "@dantecode/core";
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
    semantic_search: handleSemanticSearch,
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
    autoforge_verify: handleAutoforgeVerify,
  };
}

const handleSemanticSearch: ToolHandler = async (args) => {
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
};

const handleAutoforgeVerify: ToolHandler = async (args) => {
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
};

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

function serialize(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
