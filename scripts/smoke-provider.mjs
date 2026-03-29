import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ensureBuildArtifacts, getCatalogPackageById } from "./release/catalog.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const coreEntry = join(repoRoot, "packages", "core", "dist", "index.js");

const PROVIDER_SPECS = {
  grok: {
    envVars: ["GROK_API_KEY", "XAI_API_KEY"],
    modelId: "grok-3",
    contextWindow: 131072,
    supportsVision: false,
    supportsToolCalls: true,
  },
  anthropic: {
    envVars: ["ANTHROPIC_API_KEY"],
    modelId: "claude-sonnet-4-20250514",
    contextWindow: 200000,
    supportsVision: true,
    supportsToolCalls: true,
  },
  openai: {
    envVars: ["OPENAI_API_KEY"],
    modelId: "gpt-4.1",
    contextWindow: 128000,
    supportsVision: true,
    supportsToolCalls: true,
  },
  ollama: {
    envVars: [],
    modelId: "llama3.1",
    contextWindow: 128000,
    supportsVision: false,
    supportsToolCalls: false,
  },
};

function parseArgs(argv) {
  const result = {
    provider: undefined,
    modelId: undefined,
    requireProvider: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === "--provider" || arg === "-p") && argv[index + 1]) {
      result.provider = argv[index + 1];
      index += 1;
      continue;
    }

    if ((arg === "--model" || arg === "-m") && argv[index + 1]) {
      result.modelId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--require-provider") {
      result.requireProvider = true;
    }
  }

  return result;
}

function findAvailableProvider(requestedProvider) {
  if (requestedProvider) {
    return requestedProvider in PROVIDER_SPECS ? requestedProvider : null;
  }

  for (const [provider, spec] of Object.entries(PROVIDER_SPECS)) {
    if (provider === "ollama") {
      continue;
    }
    if (spec.envVars.some((envVar) => Boolean(process.env[envVar]))) {
      return provider;
    }
  }

  return null;
}

function normalizeOutput(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

ensureBuildArtifacts(repoRoot, [getCatalogPackageById(repoRoot, "core")]);

const args = parseArgs(process.argv);
const provider = findAvailableProvider(args.provider);

if (!provider) {
  const message =
    "Provider smoke skipped: no supported provider credentials detected. " +
    "Set GROK_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY, " +
    "or run with --provider ollama against a local server.";

  if (args.requireProvider) {
    throw new Error(message);
  }

  console.log(message);
  process.exit(0);
}

const providerSpec = PROVIDER_SPECS[provider];
const modelId = args.modelId ?? providerSpec.modelId;

const { ModelRouterImpl, initializeState } = await import(pathToFileURL(coreEntry).href);

const tempProject = mkdtempSync(join(tmpdir(), "dantecode-provider-smoke-"));

try {
  await initializeState(tempProject);

  const router = new ModelRouterImpl(
    {
      default: {
        provider,
        modelId,
        maxTokens: 64,
        temperature: 0,
        contextWindow: providerSpec.contextWindow,
        supportsVision: providerSpec.supportsVision,
        supportsToolCalls: providerSpec.supportsToolCalls,
      },
      fallback: [],
      overrides: {},
    },
    tempProject,
    `provider-smoke-${Date.now()}`,
  );

  const text = await router.generate(
    [
      {
        role: "user",
        content: "Reply with exactly: DanteCode provider smoke passed",
      },
    ],
    {
      system: "Return the requested sentence exactly and do not add any other words.",
    },
  );

  if (!normalizeOutput(text).includes("dantecode provider smoke passed")) {
    throw new Error(`Unexpected provider smoke output: ${text}`);
  }

  const logs = router.getLogs();
  const successEntry = logs.find((entry) => entry.action === "success");
  if (!successEntry) {
    throw new Error("Model router did not record a successful provider attempt.");
  }

  console.log(`Provider smoke check passed using ${provider}/${modelId}.`);
  console.log(`Temporary project: ${tempProject}`);
} finally {
  rmSync(tempProject, { recursive: true, force: true });
}
