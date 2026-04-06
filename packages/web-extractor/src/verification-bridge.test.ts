/**
 * VerificationBridge — Depth Pass Tests (Wave 5C)
 *
 * Covers all 4 PDSE gates (Provenance, Depth, Specificity, Evidence)
 * with pass, warn, and fail scenarios. Includes edge cases for:
 * - Missing sources / empty content
 * - Stub marker detection
 * - Circular/non-serializable structured data
 * - Score normalization
 */

import { describe, expect, it } from "vitest";
import { VerificationBridge } from "./verification-bridge.js";
import type { WebFetchResult } from "./types.js";

function makeResult(overrides: Partial<WebFetchResult> = {}): WebFetchResult {
  return {
    url: "https://example.com/article",
    markdown: "# Title\n\nThis is a rich article with substantial content about the topic.".padEnd(300, " more content"),
    sources: [{ url: "https://example.com/article", title: "Example Article", snippet: "Snippet" }],
    metadata: {
      provider: "basic-fetch",
      finalUrl: "https://example.com/article",
      status: 200,
      renderMode: "http",
      cacheHit: false,
      extractedAt: new Date().toISOString(),
      preActionsApplied: false,
      title: "Example Article",
    },
    ...overrides,
  } as WebFetchResult;
}

describe("VerificationBridge — Gate P (Provenance)", () => {
  it("passes when at least one source has an http URL", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult());
    const gateP = result.gates.find((g) => g.name === "provenance")!;
    expect(gateP.status).toBe("pass");
    expect(gateP.score).toBe(1);
  });

  it("fails when sources array is empty", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({ sources: [] }));
    const gateP = result.gates.find((g) => g.name === "provenance")!;
    expect(gateP.status).toBe("fail");
    expect(gateP.score).toBe(0);
  });

  it("fails when source URLs do not start with http", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      sources: [{ url: "ftp://example.com/file", title: "FTP resource", snippet: "" }],
    }));
    const gateP = result.gates.find((g) => g.name === "provenance")!;
    expect(gateP.status).toBe("fail");
  });

  it("overall passed is false when provenance fails", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({ sources: [] }));
    expect(result.passed).toBe(false);
  });
});

describe("VerificationBridge — Gate D (Depth)", () => {
  it("passes when content is >= 200 chars", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      markdown: "A".repeat(201),
    }));
    const gateD = result.gates.find((g) => g.name === "depth")!;
    expect(gateD.status).toBe("pass");
  });

  it("warns when content is < 200 chars", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      markdown: "Short content",
    }));
    const gateD = result.gates.find((g) => g.name === "depth")!;
    expect(gateD.status).toBe("warn");
  });

  it("depth score scales with content length up to 1000 chars", async () => {
    const bridge = new VerificationBridge();
    const r500 = await bridge.verify(makeResult({ markdown: "X".repeat(500) }));
    const r1000 = await bridge.verify(makeResult({ markdown: "X".repeat(1000) }));
    const r2000 = await bridge.verify(makeResult({ markdown: "X".repeat(2000) }));

    const score500 = r500.gates.find((g) => g.name === "depth")!.score!;
    const score1000 = r1000.gates.find((g) => g.name === "depth")!.score!;
    const score2000 = r2000.gates.find((g) => g.name === "depth")!.score!;

    expect(score500).toBeCloseTo(0.5, 1);
    expect(score1000).toBeCloseTo(1, 5);
    expect(score2000).toBeCloseTo(1, 5); // capped at 1
  });

  it("depth score is 0 for empty markdown", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({ markdown: "" }));
    const gateD = result.gates.find((g) => g.name === "depth")!;
    expect(gateD.score).toBe(0);
  });
});

describe("VerificationBridge — Gate S (Specificity)", () => {
  it("passes when title is present and no stub markers", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult());
    const gateS = result.gates.find((g) => g.name === "specificity")!;
    expect(gateS.status).toBe("pass");
    expect(gateS.score).toBe(1);
  });

  it("warns when title is missing", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      metadata: {
        provider: "basic-fetch",
        finalUrl: "https://example.com",
        status: 200,
        renderMode: "http" as const,
        cacheHit: false,
        extractedAt: new Date().toISOString(),
        preActionsApplied: false,
        title: "",
      },
    }));
    const gateS = result.gates.find((g) => g.name === "specificity")!;
    expect(gateS.status).toBe("warn");
    expect(gateS.score).toBe(0.3);
  });

  it("warns when content contains TODO stub marker", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      markdown: "This content has a TODO item to fill in later. " + "X".repeat(300),
    }));
    const gateS = result.gates.find((g) => g.name === "specificity")!;
    expect(gateS.status).toBe("warn");
    expect(gateS.findings.some((f) => f.toLowerCase().includes("todo"))).toBe(true);
  });

  it("warns when content contains 'placeholder' stub marker", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      markdown: "This is placeholder content. " + "X".repeat(300),
    }));
    const gateS = result.gates.find((g) => g.name === "specificity")!;
    expect(gateS.status).toBe("warn");
    expect(gateS.message).toContain("placeholder");
  });

  it("warns when content contains 'lorem ipsum'", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      markdown: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. " + "X".repeat(300),
    }));
    const gateS = result.gates.find((g) => g.name === "specificity")!;
    expect(gateS.status).toBe("warn");
  });

  it("is case-insensitive for stub markers", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      markdown: "FIXME: this needs to be updated. " + "X".repeat(300),
    }));
    const gateS = result.gates.find((g) => g.name === "specificity")!;
    expect(gateS.status).toBe("warn");
  });
});

describe("VerificationBridge — Gate E (Evidence integrity)", () => {
  it("passes with 'no structured data' message when structuredData is undefined", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({ structuredData: undefined }));
    const gateE = result.gates.find((g) => g.name === "evidence")!;
    expect(gateE.status).toBe("pass");
    expect(gateE.message).toContain("No structured data");
  });

  it("passes when structuredData is a valid serializable object", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult({
      structuredData: { key: "value", nested: { a: 1 } },
    }));
    const gateE = result.gates.find((g) => g.name === "evidence")!;
    expect(gateE.status).toBe("pass");
    expect(gateE.message).toContain("valid JSON");
  });

  it("fails when structuredData contains a circular reference", async () => {
    const bridge = new VerificationBridge();
    const circular: Record<string, unknown> = { a: 1 };
    circular["self"] = circular; // circular reference — JSON.stringify throws

    const result = await bridge.verify(makeResult({ structuredData: circular }));
    const gateE = result.gates.find((g) => g.name === "evidence")!;
    expect(gateE.status).toBe("fail");
    expect(gateE.score).toBe(0);
  });
});

describe("VerificationBridge — overall scoring", () => {
  it("returns 4 gates in the result", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult());
    expect(result.gates).toHaveLength(4);
    expect(result.gates.map((g) => g.name)).toEqual([
      "provenance",
      "depth",
      "specificity",
      "evidence",
    ]);
  });

  it("overallScore is average of all gate scores", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult());
    const expectedAvg =
      result.gates.reduce((s, g) => s + (g.score ?? 0), 0) / result.gates.length;
    expect(result.overallScore).toBeCloseTo(expectedAvg, 10);
  });

  it("pdse.passedGate is true when overallScore >= 0.6", async () => {
    const bridge = new VerificationBridge();
    const result = await bridge.verify(makeResult());
    if (result.overallScore >= 0.6) {
      expect(result.pdse?.passedGate).toBe(true);
    } else {
      expect(result.pdse?.passedGate).toBe(false);
    }
  });

  it("evidenceCount matches sources length", async () => {
    const bridge = new VerificationBridge();
    const sources = [
      { url: "https://a.com", title: "A", snippet: "a" },
      { url: "https://b.com", title: "B", snippet: "b" },
      { url: "https://c.com", title: "C", snippet: "c" },
    ];
    const result = await bridge.verify(makeResult({ sources }));
    expect(result.evidenceCount).toBe(3);
    expect(result.sources).toHaveLength(3);
  });

  it("throws when result is not an object", async () => {
    const bridge = new VerificationBridge();
    await expect(
      bridge.verify(null as unknown as WebFetchResult),
    ).rejects.toThrow("WebFetchResult must be a valid object");
  });

  it("result has a unique taskId string", async () => {
    const bridge = new VerificationBridge();
    const r1 = await bridge.verify(makeResult());
    const r2 = await bridge.verify(makeResult());
    expect(typeof r1.taskId).toBe("string");
    expect(r1.taskId.length).toBeGreaterThan(0);
    expect(r1.taskId).not.toBe(r2.taskId);
  });
});
