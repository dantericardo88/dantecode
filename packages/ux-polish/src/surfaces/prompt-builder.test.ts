/**
 * prompt-builder.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect } from "vitest";
import { buildPrompt } from "./prompt-builder.js";
import type { PromptBuilderState } from "./prompt-builder.js";
import { ThemeEngine } from "../theme-engine.js";

const THEME = new ThemeEngine({ theme: "default", colors: false });

const BASE_STATE: PromptBuilderState = {
  sessionName: "my-session",
  modelShort: "grok-3",
  sandboxMode: "workspace-write",
  roundCount: 12,
  lastPdse: 92,
  theme: THEME,
};

describe("buildPrompt", () => {
  it("full state includes all parts in output", () => {
    const prompt = buildPrompt(BASE_STATE);
    expect(prompt).toContain("my-session");
    expect(prompt).toContain("grok-3");
    expect(prompt).toContain("🛡️");
    expect(prompt).toContain("r12");
    expect(prompt).toContain("P:92");
    expect(prompt).toContain("❯");
  });

  it("omits session name when undefined", () => {
    const prompt = buildPrompt({ ...BASE_STATE, sessionName: undefined });
    expect(prompt).not.toContain("my-session");
    expect(prompt).toContain("grok-3");
  });

  it("PDSE color: >=85 → success, 70-84 → warning, <70 → error", () => {
    const theme = new ThemeEngine({ theme: "default", colors: true });
    const c = theme.resolve().colors;

    const high = buildPrompt({ ...BASE_STATE, lastPdse: 90, theme });
    expect(high).toContain(`${c.success}P:90`);

    const mid = buildPrompt({ ...BASE_STATE, lastPdse: 75, theme });
    expect(mid).toContain(`${c.warning}P:75`);

    const low = buildPrompt({ ...BASE_STATE, lastPdse: 50, theme });
    expect(low).toContain(`${c.error}P:50`);
  });

  it("omits round count when 0", () => {
    const prompt = buildPrompt({ ...BASE_STATE, roundCount: 0 });
    expect(prompt).not.toContain("r0");
  });

  it("sandbox icons: read-only 🔒, workspace-write 🛡️, full-access ⚡", () => {
    expect(buildPrompt({ ...BASE_STATE, sandboxMode: "read-only" })).toContain("🔒");
    expect(buildPrompt({ ...BASE_STATE, sandboxMode: "workspace-write" })).toContain("🛡️");
    expect(buildPrompt({ ...BASE_STATE, sandboxMode: "full-access" })).toContain("⚡");
  });
});
