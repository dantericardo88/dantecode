// ============================================================================
// Lazy initialization helpers for deferred subsystems.
// Gaslight and Memory are constructed on first use, not at REPL startup.
// Auto-init allows `dantecode "prompt"` without prior `dantecode init`.
// ============================================================================

import { DanteGaslightIntegration } from "@dantecode/dante-gaslight";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import { createMemoryOrchestrator } from "@dantecode/memory-engine";
import type { MemoryOrchestrator } from "@dantecode/memory-engine";
import { initializeState } from "@dantecode/core";
import type { DanteCodeState } from "@dantecode/config-types";
import { scanForApiKeys, isOllamaAvailable, PROVIDER_DEFAULTS } from "./commands/init.js";
import type { ReplState } from "./slash-commands.js";

/**
 * Lazily creates the DanteGaslightIntegration singleton on first access.
 * Construction is synchronous — no startup delay.
 */
export function getOrInitGaslight(state: ReplState): DanteGaslightIntegration {
  if (state.gaslight) return state.gaslight;

  state.gaslight = new DanteGaslightIntegration(
    { enabled: process.env["DANTECODE_GASLIGHT"] !== "0" },
    { cwd: state.projectRoot },
    {
      priorLessonProvider: (draft: string) => {
        try {
          const skillbook = new DanteSkillbookIntegration({ cwd: state.projectRoot });
          const keywords = draft
            .split(/\s+/)
            .filter((w) => w.length > 4)
            .slice(0, 10);
          return skillbook.getRelevantSkills({ keywords }).map((s) => s.title ?? s.id);
        } catch {
          return [];
        }
      },
    },
  );
  return state.gaslight;
}

// Promise cache to prevent concurrent double-init
let _memoryInitPromise: Promise<MemoryOrchestrator | null> | null = null;

/**
 * Lazily creates and initializes the MemoryOrchestrator on first access.
 * Promise-cached to prevent race conditions from concurrent calls.
 * Returns null on failure (non-fatal — same as current behavior).
 */
export async function getOrInitMemory(state: ReplState): Promise<MemoryOrchestrator | null> {
  if (state.memoryOrchestrator) return state.memoryOrchestrator;
  if (_memoryInitPromise) return _memoryInitPromise;

  _memoryInitPromise = (async () => {
    try {
      const mo = createMemoryOrchestrator(state.projectRoot);
      await mo.initialize();
      state.memoryOrchestrator = mo;
      return mo;
    } catch {
      return null;
    } finally {
      _memoryInitPromise = null;
    }
  })();
  return _memoryInitPromise;
}

/**
 * Attempts auto-initialization when no STATE.yaml exists.
 * Scans environment for API keys, auto-creates .dantecode/ with sane defaults.
 * Returns the new state if successful, or null if no provider can be detected.
 */
export async function tryAutoInit(projectRoot: string): Promise<DanteCodeState | null> {
  const detectedKeys = scanForApiKeys();
  let provider: string;
  let defaults: { modelId: string; contextWindow: number };

  if (detectedKeys.length >= 1) {
    const first = detectedKeys[0]!;
    provider = first[0];
    defaults = PROVIDER_DEFAULTS[provider]!;
  } else if (isOllamaAvailable()) {
    provider = "ollama";
    defaults = PROVIDER_DEFAULTS["ollama"]!;
  } else {
    return null;
  }

  try {
    return await initializeState(projectRoot, {
      provider: provider as "grok" | "anthropic" | "openai" | "google" | "groq" | "ollama",
      modelId: defaults.modelId,
      contextWindow: defaults.contextWindow,
    });
  } catch {
    return null;
  }
}
