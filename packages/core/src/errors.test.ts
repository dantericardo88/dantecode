// Tests for the structured error hierarchy. Verifies each subclass:
//   - Extends DanteCodeError (so `instanceof DanteCodeError` works as a filter)
//   - Sets the correct `code` field (stable machine-readable identifier)
//   - Carries domain-specific structured fields (filePath, provider, toolName, etc.)
//   - Defaults to a sensible recovery strategy
//   - Preserves cause chains via ES2022 Error cause option

import { describe, it, expect } from "vitest";
import {
  DanteCodeError,
  ConfigInvalidError,
  ConfigMissingKeyError,
  ToolExecutionError,
  ToolInputInvalidError,
  ProtectedFileWriteError,
  StaleSnapshotError,
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  ProviderUnavailableError,
  ProviderRateLimitError,
  ProviderAuthError,
  ContextOverflowError,
  ParseError,
  WorkflowGateError,
  ValidationError,
  TimeoutError,
  IntegrityError,
  isDanteCodeError,
  wrapAsDanteCodeError,
} from "./errors.js";

describe("DanteCodeError base", () => {
  it("sets code, message, recovery, and context", () => {
    const err = new DanteCodeError("TOOL_EXECUTION_FAILED", "boom", {
      recovery: "retry",
      context: { foo: 1 },
    });
    expect(err.code).toBe("TOOL_EXECUTION_FAILED");
    expect(err.message).toBe("boom");
    expect(err.recovery).toBe("retry");
    expect(err.context).toEqual({ foo: 1 });
    expect(err.name).toBe("DanteCodeError");
  });

  it("defaults recovery to 'abort'", () => {
    const err = new DanteCodeError("PARSE_FAILED", "x");
    expect(err.recovery).toBe("abort");
  });

  it("preserves cause via ES2022 Error cause option", () => {
    const upstream = new Error("upstream boom");
    const wrapped = new DanteCodeError("FILE_READ_FAILED", "wrapped", { cause: upstream });
    expect(wrapped.cause).toBe(upstream);
  });
});

describe("ConfigInvalidError", () => {
  it("uses CONFIG_INVALID code and user-action recovery", () => {
    const err = new ConfigInvalidError("malformed yaml");
    expect(err).toBeInstanceOf(DanteCodeError);
    expect(err.code).toBe("CONFIG_INVALID");
    expect(err.recovery).toBe("user-action");
  });
});

describe("ConfigMissingKeyError", () => {
  it("captures the missing key in both message and context", () => {
    const err = new ConfigMissingKeyError("ANTHROPIC_API_KEY");
    expect(err.code).toBe("CONFIG_MISSING_KEY");
    expect(err.key).toBe("ANTHROPIC_API_KEY");
    expect(err.context["key"]).toBe("ANTHROPIC_API_KEY");
    expect(err.message).toContain("ANTHROPIC_API_KEY");
  });
});

describe("ToolExecutionError", () => {
  it("prefixes message with tool name and recommends model-correction", () => {
    const err = new ToolExecutionError("Bash", "command not found");
    expect(err.toolName).toBe("Bash");
    expect(err.recovery).toBe("model-correction");
    expect(err.message).toContain("Bash");
    expect(err.message).toContain("command not found");
  });
});

describe("ToolInputInvalidError", () => {
  it("lists the missing fields", () => {
    const err = new ToolInputInvalidError("Edit", ["file_path", "old_string"]);
    expect(err.toolName).toBe("Edit");
    expect(err.missingFields).toEqual(["file_path", "old_string"]);
    expect(err.message).toContain("file_path");
    expect(err.message).toContain("old_string");
  });
});

describe("ProtectedFileWriteError", () => {
  it("captures the protected file path", () => {
    const err = new ProtectedFileWriteError("packages/vscode/src/extension.ts");
    expect(err.code).toBe("PROTECTED_FILE_WRITE");
    expect(err.filePath).toBe("packages/vscode/src/extension.ts");
    expect(err.recovery).toBe("abort");
  });
});

describe("StaleSnapshotError", () => {
  it("recommends retry (re-read then re-edit)", () => {
    const err = new StaleSnapshotError("src/foo.ts");
    expect(err.recovery).toBe("retry");
    expect(err.filePath).toBe("src/foo.ts");
  });
});

describe("FileNotFoundError, FileReadError, FileWriteError", () => {
  it("FileNotFoundError aborts (no point retrying a missing file)", () => {
    const err = new FileNotFoundError("nope.ts");
    expect(err.recovery).toBe("abort");
    expect(err.filePath).toBe("nope.ts");
  });

  it("FileReadError retries (transient I/O)", () => {
    const err = new FileReadError("locked.ts", "EBUSY");
    expect(err.recovery).toBe("retry");
    expect(err.message).toContain("EBUSY");
  });

  it("FileWriteError retries", () => {
    const err = new FileWriteError("readonly.ts", "EACCES");
    expect(err.recovery).toBe("retry");
  });
});

describe("Provider errors", () => {
  it("ProviderUnavailableError retries", () => {
    const err = new ProviderUnavailableError("anthropic", "503 service unavailable");
    expect(err.recovery).toBe("retry");
    expect(err.provider).toBe("anthropic");
  });

  it("ProviderRateLimitError carries optional retryAfterMs", () => {
    const err = new ProviderRateLimitError("openai", 5000);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toContain("5000ms");
  });

  it("ProviderRateLimitError works without retryAfterMs", () => {
    const err = new ProviderRateLimitError("openai");
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("ProviderAuthError requires user action (API key)", () => {
    const err = new ProviderAuthError("grok");
    expect(err.recovery).toBe("user-action");
    expect(err.provider).toBe("grok");
  });
});

describe("ContextOverflowError", () => {
  it("captures token count and limit, recommends model-correction", () => {
    const err = new ContextOverflowError(150_000, 128_000);
    expect(err.tokenCount).toBe(150_000);
    expect(err.limit).toBe(128_000);
    expect(err.recovery).toBe("model-correction");
  });
});

describe("ParseError", () => {
  it("identifies the format that failed", () => {
    const err = new ParseError("JSON", "unexpected token at position 45");
    expect(err.format).toBe("JSON");
    expect(err.recovery).toBe("model-correction");
  });
});

describe("WorkflowGateError", () => {
  it("records both the from-stage and to-stage", () => {
    const err = new WorkflowGateError("verify", "forge");
    expect(err.fromStage).toBe("verify");
    expect(err.toStage).toBe("forge");
    expect(err.message).toContain("verify");
    expect(err.message).toContain("forge");
  });
});

describe("ValidationError", () => {
  it("identifies the failed field", () => {
    const err = new ValidationError("email", "must be valid format");
    expect(err.field).toBe("email");
    expect(err.recovery).toBe("model-correction");
  });
});

describe("TimeoutError", () => {
  it("captures operation name and timeout", () => {
    const err = new TimeoutError("danteforge score", 30_000);
    expect(err.operationName).toBe("danteforge score");
    expect(err.timeoutMs).toBe(30_000);
    expect(err.recovery).toBe("retry");
  });
});

describe("IntegrityError", () => {
  it("aborts on integrity failure (security-critical)", () => {
    const err = new IntegrityError("checksum mismatch on lock file");
    expect(err.recovery).toBe("abort");
    expect(err.code).toBe("INTEGRITY_FAILED");
  });
});

describe("isDanteCodeError type guard", () => {
  it("returns true for DanteCodeError instances", () => {
    expect(isDanteCodeError(new DanteCodeError("PARSE_FAILED", "x"))).toBe(true);
    expect(isDanteCodeError(new ToolExecutionError("Bash", "y"))).toBe(true);
  });

  it("returns false for regular errors and non-errors", () => {
    expect(isDanteCodeError(new Error("plain"))).toBe(false);
    expect(isDanteCodeError("string")).toBe(false);
    expect(isDanteCodeError(null)).toBe(false);
    expect(isDanteCodeError(undefined)).toBe(false);
  });
});

describe("wrapAsDanteCodeError", () => {
  it("returns DanteCodeErrors unchanged (idempotent)", () => {
    const orig = new ToolExecutionError("Bash", "x");
    const wrapped = wrapAsDanteCodeError(orig);
    expect(wrapped).toBe(orig);
  });

  it("wraps a plain Error preserving cause chain", () => {
    const orig = new Error("upstream");
    const wrapped = wrapAsDanteCodeError(orig);
    expect(wrapped).toBeInstanceOf(DanteCodeError);
    expect(wrapped.cause).toBe(orig);
    expect(wrapped.message).toBe("upstream");
  });

  it("wraps non-Error values (strings, numbers) as messages", () => {
    const wrapped = wrapAsDanteCodeError("string failure");
    expect(wrapped.message).toBe("string failure");
  });

  it("uses the supplied fallback code", () => {
    const wrapped = wrapAsDanteCodeError(new Error("x"), "PROVIDER_UNAVAILABLE");
    expect(wrapped.code).toBe("PROVIDER_UNAVAILABLE");
  });
});
