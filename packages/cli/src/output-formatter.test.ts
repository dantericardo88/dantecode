import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ANSI_BOLD,
  ANSI_CYAN,
  ANSI_DIM,
  ANSI_GREEN,
  ANSI_RED,
  ANSI_RESET,
  ANSI_YELLOW,
  bold,
  cleanForStructured,
  cyan,
  dim,
  green,
  isColorEnabled,
  red,
  stripAnsi,
  yellow,
} from "./output-formatter.js";

describe("stripAnsi", () => {
  it("removes DIM + RESET codes", () => {
    expect(stripAnsi("\x1b[2m15\x1b[0m")).toBe("15");
  });

  it("removes GREEN + RESET", () => {
    expect(stripAnsi("\x1b[32mDone\x1b[0m")).toBe("Done");
  });

  it("removes RED + RESET", () => {
    expect(stripAnsi("\x1b[31mError\x1b[0m")).toBe("Error");
  });

  it("removes YELLOW + RESET", () => {
    expect(stripAnsi("\x1b[33mWarning\x1b[0m")).toBe("Warning");
  });

  it("removes CYAN + RESET", () => {
    expect(stripAnsi("\x1b[36mInfo\x1b[0m")).toBe("Info");
  });

  it("removes BOLD + RESET", () => {
    expect(stripAnsi("\x1b[1mTitle\x1b[0m")).toBe("Title");
  });

  it("handles mixed ANSI codes in a single string", () => {
    expect(
      stripAnsi(`  Step: ${ANSI_DIM}42${ANSI_RESET} status: ${ANSI_GREEN}ok${ANSI_RESET}`),
    ).toBe("  Step: 42 status: ok");
  });

  it("passes through strings with no ANSI codes unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("handles empty string", () => {
    expect(stripAnsi("")).toBe("");
  });

  it("removes codes with semicolon parameters (e.g. bold+color combined)", () => {
    // ESC[1;32m = bold green
    expect(stripAnsi("\x1b[1;32mBold Green\x1b[0m")).toBe("Bold Green");
  });

  it("handles cursor movement codes (A, B, C, D)", () => {
    expect(stripAnsi("\x1b[1A\x1b[2Btext\x1b[0m")).toBe("text");
  });
});

describe("cleanForStructured", () => {
  it("strips ANSI and trims whitespace", () => {
    expect(cleanForStructured(`  ${ANSI_DIM}value${ANSI_RESET}  `)).toBe("value");
  });

  it("handles strings without codes", () => {
    expect(cleanForStructured("  hello  ")).toBe("hello");
  });
});

describe("isColorEnabled", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;
  const originalForceColor = process.env.FORCE_COLOR;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
  });

  afterEach(() => {
    if (originalNoColor !== undefined) {
      process.env.NO_COLOR = originalNoColor;
    } else {
      delete process.env.NO_COLOR;
    }
    if (originalForceColor !== undefined) {
      process.env.FORCE_COLOR = originalForceColor;
    } else {
      delete process.env.FORCE_COLOR;
    }
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it("returns false in test environment (not a TTY)", () => {
    // Vitest runs in a non-TTY context
    Object.defineProperty(process.stdout, "isTTY", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(isColorEnabled()).toBe(false);
  });

  it("returns false when NO_COLOR is set", () => {
    process.env.NO_COLOR = "";
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    expect(isColorEnabled()).toBe(false);
  });

  it("returns false when FORCE_COLOR=0", () => {
    process.env.FORCE_COLOR = "0";
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    expect(isColorEnabled()).toBe(false);
  });

  it("returns true when isTTY and no suppression env vars", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
    expect(isColorEnabled()).toBe(true);
  });

  it("returns false when isTTY=false even without suppression env vars", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      writable: true,
      configurable: true,
    });
    expect(isColorEnabled()).toBe(false);
  });
});

describe("conditional color formatters (non-TTY / test env)", () => {
  // In test env, isTTY is not true, so formatters return plain text
  it("dim() returns plain string", () => {
    expect(dim(42)).toBe("42");
    expect(dim("hello")).toBe("hello");
  });

  it("green() returns plain string", () => {
    expect(green("ok")).toBe("ok");
  });

  it("red() returns plain string", () => {
    expect(red("fail")).toBe("fail");
  });

  it("yellow() returns plain string", () => {
    expect(yellow("warn")).toBe("warn");
  });

  it("cyan() returns plain string", () => {
    expect(cyan("info")).toBe("info");
  });

  it("bold() returns plain string", () => {
    expect(bold("title")).toBe("title");
  });
});

describe("conditional color formatters (TTY env)", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (originalNoColor !== undefined) {
      process.env.NO_COLOR = originalNoColor;
    } else {
      delete process.env.NO_COLOR;
    }
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  it("dim() wraps with DIM + RESET", () => {
    expect(dim("value")).toBe(`${ANSI_DIM}value${ANSI_RESET}`);
  });

  it("green() wraps with GREEN + RESET", () => {
    expect(green("ok")).toBe(`${ANSI_GREEN}ok${ANSI_RESET}`);
  });

  it("red() wraps with RED + RESET", () => {
    expect(red("fail")).toBe(`${ANSI_RED}fail${ANSI_RESET}`);
  });

  it("yellow() wraps with YELLOW + RESET", () => {
    expect(yellow("warn")).toBe(`${ANSI_YELLOW}warn${ANSI_RESET}`);
  });

  it("cyan() wraps with CYAN + RESET", () => {
    expect(cyan("info")).toBe(`${ANSI_CYAN}info${ANSI_RESET}`);
  });

  it("bold() wraps with BOLD + RESET", () => {
    expect(bold("title")).toBe(`${ANSI_BOLD}title${ANSI_RESET}`);
  });

  it("dim() converts non-string values to string", () => {
    expect(dim(0)).toBe(`${ANSI_DIM}0${ANSI_RESET}`);
    expect(dim(null)).toBe(`${ANSI_DIM}null${ANSI_RESET}`);
  });
});
