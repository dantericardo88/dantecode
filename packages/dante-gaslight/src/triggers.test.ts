import { describe, it, expect } from "vitest";
import {
  detectExplicitTrigger,
  detectVerificationTrigger,
  detectPolicyTrigger,
  detectAuditTrigger,
  detectTrigger,
} from "./triggers.js";
import { DEFAULT_GASLIGHT_CONFIG } from "./types.js";
import type { GaslightConfig } from "./types.js";

const disabledConfig: GaslightConfig = {
  ...DEFAULT_GASLIGHT_CONFIG,
  enabled: false,
};

const enabledConfig: GaslightConfig = {
  ...DEFAULT_GASLIGHT_CONFIG,
  enabled: true,
  autoTriggerThreshold: 0.6,
  auditRate: 1.0, // always audit
};

describe("detectExplicitTrigger", () => {
  it("returns null when disabled", () => {
    expect(detectExplicitTrigger("go deeper", disabledConfig)).toBeNull();
  });

  it("detects 'go deeper'", () => {
    const t = detectExplicitTrigger("Please go deeper on this.", enabledConfig);
    expect(t?.channel).toBe("explicit-user");
    expect(t?.phrase).toMatch(/go\s+deeper/i);
  });

  it("detects 'again but better'", () => {
    const t = detectExplicitTrigger("Try again but better.", enabledConfig);
    expect(t?.channel).toBe("explicit-user");
  });

  it("detects /gaslight on", () => {
    const t = detectExplicitTrigger("/gaslight on", enabledConfig);
    expect(t?.channel).toBe("explicit-user");
  });

  it("detects 'truth mode'", () => {
    const t = detectExplicitTrigger("enter truth mode", enabledConfig);
    expect(t?.channel).toBe("explicit-user");
  });

  it("returns null for unrelated message", () => {
    expect(detectExplicitTrigger("This looks fine.", enabledConfig)).toBeNull();
  });
});

describe("detectVerificationTrigger", () => {
  it("returns null when disabled", () => {
    expect(detectVerificationTrigger(0.3, disabledConfig)).toBeNull();
  });

  it("returns null when autoTriggerThreshold is 0", () => {
    const cfg = { ...enabledConfig, autoTriggerThreshold: 0 };
    expect(detectVerificationTrigger(0.3, cfg)).toBeNull();
  });

  it("triggers when score is below threshold", () => {
    const t = detectVerificationTrigger(0.4, enabledConfig);
    expect(t?.channel).toBe("verification");
    expect(t?.score).toBe(0.4);
  });

  it("returns null when score meets threshold", () => {
    expect(detectVerificationTrigger(0.6, enabledConfig)).toBeNull();
  });
});

describe("detectPolicyTrigger", () => {
  it("triggers for configured task class", () => {
    const t = detectPolicyTrigger("code-generation", enabledConfig);
    expect(t?.channel).toBe("policy");
    expect(t?.taskClass).toBe("code-generation");
  });

  it("returns null for unknown class", () => {
    expect(detectPolicyTrigger("trivial-task", enabledConfig)).toBeNull();
  });
});

describe("detectAuditTrigger", () => {
  it("always triggers at auditRate=1.0", () => {
    const t = detectAuditTrigger(enabledConfig, undefined, () => 0.0);
    expect(t?.channel).toBe("audit");
  });

  it("never triggers at auditRate=0", () => {
    const cfg = { ...enabledConfig, auditRate: 0 };
    expect(detectAuditTrigger(cfg, undefined, () => 0.0)).toBeNull();
  });
});

describe("detectTrigger (unified)", () => {
  it("explicit wins first", () => {
    const t = detectTrigger({
      message: "go deeper please",
      verificationScore: 0.2,
      taskClass: "code-generation",
      config: enabledConfig,
    });
    expect(t?.channel).toBe("explicit-user");
  });

  it("verification is checked when no explicit trigger", () => {
    const t = detectTrigger({
      verificationScore: 0.2,
      taskClass: "code-generation",
      config: enabledConfig,
    });
    expect(t?.channel).toBe("verification");
  });

  it("returns null when disabled", () => {
    expect(detectTrigger({ message: "go deeper", config: disabledConfig })).toBeNull();
  });
});
