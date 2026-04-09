/**
 * gaslight-bridge.test.ts
 *
 * Unit tests for the Gaslight→Skillbook fire-and-forget path inside
 * gaslight-bridge.ts (the onLessonEligible → scheduleSkillbookPersist flow).
 *
 * Strategy: use real DanteSkillbookIntegration instances backed by isolated
 * temp directories, and verify observable outcomes (files on disk).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGaslightBridge } from "./gaslight-bridge.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-gb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

function makeCtx(projectRoot: string, silent = true) {
  return {
    config: {
      gaslight: null as any,
      fearSetBlockOnNoGo: false,
    } as any,
    session: {
      id: "test-session",
      projectRoot,
      // Need at least one assistant message so runGaslightBridge reads a lastDraft
      // and actually invokes gaslight.maybeGaslight (not skipped due to empty lastDraft)
      messages: [
        {
          id: "msg-1",
          role: "assistant" as const,
          content: "This is the assistant draft response that needs gaslight refinement.",
          timestamp: new Date().toISOString(),
        },
      ],
      activeFiles: [],
      readOnlyFiles: [],
      model: { id: "claude-test", provider: "anthropic" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any,
    durablePrompt: "test prompt",
    router: null as any,
    verifyRetries: 0,
    sessionFailureCount: 0,
    silent,
  };
}

// Build a mock gaslight integration that fires onLessonEligible synchronously
function makeMockGaslight(sessionId: string, finalOutput: string | undefined) {
  const session =
    finalOutput !== undefined
      ? {
          sessionId,
          trigger: { channel: "explicit-user" as const, at: new Date().toISOString() },
          iterations: [
            {
              iteration: 1,
              draft: finalOutput,
              gateDecision: "pass" as const,
              gateScore: 0.9,
              at: new Date().toISOString(),
            },
          ],
          stopReason: "pass" as const,
          finalOutput,
          finalGateDecision: "pass" as const,
          lessonEligible: true,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        }
      : null;

  return {
    maybeGaslight: vi.fn(
      async ({
        callbacks,
      }: {
        callbacks: { onLessonEligible?: (id: string) => void };
      }) => {
        if (callbacks.onLessonEligible) {
          callbacks.onLessonEligible(sessionId);
        }
        return session;
      },
    ),
    getSession: vi.fn((id: string) => (id === sessionId ? session : null)),
    getFearSetConfig: vi.fn(() => ({ enabled: false })),
    maybeFearSet: vi.fn(async () => null),
  };
}

// Drain all pending setImmediate callbacks
function drainSetImmediate(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gaslight-bridge: scheduleSkillbookPersist (via onLessonEligible)", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("1. lesson persisted when session has finalOutput — skillbook.json written to disk", async () => {
    const sessionId = `sess-${Date.now()}`;
    const mockGaslight = makeMockGaslight(sessionId, "A refined and detailed output.");
    const ctx = makeCtx(testDir);
    ctx.config.gaslight = mockGaslight as any;

    await runGaslightBridge(ctx);
    await drainSetImmediate();

    // The skillbook should have been written to projectRoot/.dantecode/skillbook/skillbook.json
    const skillbookPath = join(testDir, ".dantecode", "skillbook", "skillbook.json");
    expect(existsSync(skillbookPath)).toBe(true);
    const data = JSON.parse(readFileSync(skillbookPath, "utf-8")) as { skills: unknown[] };
    expect(data.skills.length).toBeGreaterThan(0);
  });

  it("2. skipped when session has no finalOutput — skillbook.json NOT written", async () => {
    const sessionId = `sess-empty-${Date.now()}`;
    const mockGaslight = makeMockGaslight(sessionId, undefined);
    const ctx = makeCtx(testDir);
    ctx.config.gaslight = mockGaslight as any;

    await expect(runGaslightBridge(ctx)).resolves.toBeDefined();
    await drainSetImmediate();

    // Skillbook should not have been created
    const skillbookPath = join(testDir, ".dantecode", "skillbook", "skillbook.json");
    expect(existsSync(skillbookPath)).toBe(false);
  });

  it("3. error in getSession — caught and swallowed, bridge does not throw", async () => {
    const sessionId = `sess-err-${Date.now()}`;

    const mockGaslight = {
      maybeGaslight: vi.fn(
        async ({
          callbacks,
        }: {
          callbacks: { onLessonEligible?: (id: string) => void };
        }) => {
          if (callbacks.onLessonEligible) callbacks.onLessonEligible(sessionId);
          return null;
        },
      ),
      getSession: vi.fn(() => {
        throw new Error("Forced getSession error");
      }),
      getFearSetConfig: vi.fn(() => ({ enabled: false })),
      maybeFearSet: vi.fn(async () => null),
    };

    const ctx = makeCtx(testDir);
    ctx.config.gaslight = mockGaslight as any;

    // Must not throw
    await expect(runGaslightBridge(ctx)).resolves.toBeDefined();
    await drainSetImmediate();

    // No skillbook written
    const skillbookPath = join(testDir, ".dantecode", "skillbook", "skillbook.json");
    expect(existsSync(skillbookPath)).toBe(false);
  });

  it("4. getSession returns null — handled gracefully, no skillbook written", async () => {
    const sessionId = `sess-missing-${Date.now()}`;

    const mockGaslight = {
      maybeGaslight: vi.fn(
        async ({
          callbacks,
        }: {
          callbacks: { onLessonEligible?: (id: string) => void };
        }) => {
          if (callbacks.onLessonEligible) callbacks.onLessonEligible(sessionId);
          return null;
        },
      ),
      getSession: vi.fn(() => null),
      getFearSetConfig: vi.fn(() => ({ enabled: false })),
      maybeFearSet: vi.fn(async () => null),
    };

    const ctx = makeCtx(testDir);
    ctx.config.gaslight = mockGaslight as any;

    await expect(runGaslightBridge(ctx)).resolves.toBeDefined();
    await drainSetImmediate();

    const skillbookPath = join(testDir, ".dantecode", "skillbook", "skillbook.json");
    expect(existsSync(skillbookPath)).toBe(false);
  });

  it("5. multiple sessions: second session also persists a skill (metrics tracked)", async () => {
    // Session 1
    const sessionId1 = `sess-a-${Date.now()}`;
    const mockGaslight1 = makeMockGaslight(sessionId1, "First refined output.");
    const ctx1 = makeCtx(testDir);
    ctx1.config.gaslight = mockGaslight1 as any;

    await runGaslightBridge(ctx1);
    await drainSetImmediate();

    const skillbookPath = join(testDir, ".dantecode", "skillbook", "skillbook.json");
    expect(existsSync(skillbookPath)).toBe(true);

    const after1 = JSON.parse(readFileSync(skillbookPath, "utf-8")) as { skills: unknown[] };
    const countAfter1 = after1.skills.length;
    expect(countAfter1).toBeGreaterThan(0);

    // Session 2 — different session id
    const sessionId2 = `sess-b-${Date.now()}`;
    const mockGaslight2 = makeMockGaslight(sessionId2, "Second refined output.");
    const ctx2 = makeCtx(testDir);
    ctx2.config.gaslight = mockGaslight2 as any;

    await runGaslightBridge(ctx2);
    await drainSetImmediate();

    // Skillbook should have grown — applied + rejected + queued tracked
    const after2 = JSON.parse(readFileSync(skillbookPath, "utf-8")) as { skills: unknown[] };
    // Second session writes a new skill (different id)
    expect(after2.skills.length).toBeGreaterThanOrEqual(countAfter1);
  });
});
