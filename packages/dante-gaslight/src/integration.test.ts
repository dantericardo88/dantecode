import { describe, it, expect } from "vitest";
import { DanteGaslightIntegration } from "./integration.js";

const enabledConfig = { enabled: true, maxIterations: 1, maxTokens: 100_000, maxSeconds: 60 };

describe("DanteGaslightIntegration", () => {
  it("starts disabled by default", () => {
    const engine = new DanteGaslightIntegration();
    expect(engine.getConfig().enabled).toBe(false);
  });

  it("cmdOn enables engine", () => {
    const engine = new DanteGaslightIntegration();
    const msg = engine.cmdOn();
    expect(engine.getConfig().enabled).toBe(true);
    expect(msg).toContain("enabled");
  });

  it("cmdOff disables engine", () => {
    const engine = new DanteGaslightIntegration({ enabled: true });
    engine.cmdOff();
    expect(engine.getConfig().enabled).toBe(false);
  });

  it("maybeGaslight returns null when disabled", async () => {
    const engine = new DanteGaslightIntegration();
    const result = await engine.maybeGaslight({ message: "go deeper", draft: "Some draft." });
    expect(result).toBeNull();
  });

  it("maybeGaslight returns null when no trigger matches", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig);
    const result = await engine.maybeGaslight({ message: "This is fine.", draft: "Some draft." });
    expect(result).toBeNull();
  });

  it("maybeGaslight runs session on trigger match", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig);
    const session = await engine.maybeGaslight({ message: "go deeper", draft: "Initial draft." });
    expect(session).not.toBeNull();
    expect(session?.trigger.channel).toBe("explicit-user");
  });

  it("stats returns zeros initially", () => {
    const engine = new DanteGaslightIntegration();
    const s = engine.stats();
    expect(s.totalSessions).toBe(0);
  });

  it("stats updates after sessions", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig);
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    const s = engine.stats();
    expect(s.totalSessions).toBe(1);
  });

  it("cmdStats returns readable string", () => {
    const engine = new DanteGaslightIntegration();
    const s = engine.cmdStats();
    expect(s).toContain("Total sessions");
    expect(s).toContain("Engine enabled");
  });

  it("cmdReview returns no sessions message when empty", () => {
    const engine = new DanteGaslightIntegration();
    expect(engine.cmdReview()).toContain("No Gaslight sessions");
  });

  it("cmdReview shows last session after run", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig);
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    const review = engine.cmdReview();
    expect(review).toContain("explicit-user");
  });

  it("getSession returns session by ID", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig);
    const session = await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    expect(session).not.toBeNull();
    const found = engine.getSession(session!.sessionId);
    expect(found?.sessionId).toBe(session!.sessionId);
  });
});
