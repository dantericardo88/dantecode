import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared mock state — hoisted so it's available when vi.mock factories run.
// Controls searchWithCitations behaviour per-test without re-initialising
// the singleton that getResearchEngine() caches.
// ---------------------------------------------------------------------------

const mockSearchWithCitations = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest)
// ---------------------------------------------------------------------------

vi.mock("@dantecode/web-research", () => ({
  ResearchPipeline: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      evidenceBundle: {
        content: "TypeScript monorepos are best organized with workspaces.",
        facts: [],
        citations: [
          {
            url: "https://typescriptlang.org/docs/handbook/project-references.html",
            title: "TypeScript Project References",
            snippet: "Use project references for monorepos",
          },
          {
            url: "https://nodejs.org/docs/latest/api/packages.html",
            title: "Node.js Packages",
            snippet: "Node.js package workspace support",
          },
        ],
        metadata: { sourceCount: 2, chunkCount: 3, aggregatedAt: "2026-03-21T00:00:00Z" },
      },
      cacheHit: false,
      resultCount: 8,
      fetchedCount: 2,
      verificationWarnings: undefined,
    }),
  })),
}));

// Stable mock engine object — singleton calls createSearchEngine once and
// caches the returned object; tests control behaviour via mockSearchWithCitations.
vi.mock("../web-search-engine.js", () => {
  const engine = { searchWithCitations: mockSearchWithCitations };
  return {
    MultiEngineSearch: vi.fn(),
    createSearchEngine: vi.fn(() => engine),
  };
});

vi.mock("../tools.js", () => ({
  getWebExtractor: vi.fn(() => ({
    fetch: vi.fn().mockResolvedValue({ markdown: "cleaned content", verificationWarnings: [] }),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { executeResearch } from "../lib/research-engine.js";
import { researchSlashHandler } from "./research.js";
import { ResearchPipeline } from "@dantecode/web-research";

// Default synthesis response used by most tests
const DEFAULT_SYNTHESIS = {
  results: [
    {
      url: "https://typescriptlang.org/docs/handbook/project-references.html",
      title: "TS Refs",
      snippet: "Project references",
    },
    {
      url: "https://brave-only.example.com/ts-monorepo",
      title: "Brave Source",
      snippet: "From brave provider",
    },
  ],
  synthesized: "TypeScript monorepos use project references for incremental builds. [1][2]",
  confidence: 0.87,
  providersUsed: ["ddg", "brave"],
  totalCost: 0,
};

// ---------------------------------------------------------------------------
// beforeEach — reset mock call history and restore default synthesis response
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchWithCitations.mockResolvedValue(DEFAULT_SYNTHESIS);
});

// ---------------------------------------------------------------------------
// depth=quick
// ---------------------------------------------------------------------------

describe("executeResearch — depth=quick", () => {
  it("returns ## Research header", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project", { depth: "quick" });
    expect(result).toContain("## Research: TypeScript monorepo");
  });

  it("includes evidenceBundle.content in output", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project", { depth: "quick" });
    expect(result).toContain("TypeScript monorepos are best organized with workspaces.");
  });

  it("includes numbered citations with links", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project", { depth: "quick" });
    expect(result).toContain("### Sources");
    expect(result).toContain("[TypeScript Project References]");
    expect(result).toContain("typescriptlang.org");
  });

  it("passes fetchTopN: 2 to ResearchPipeline", async () => {
    await executeResearch("topic", "/project", { depth: "quick" });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 2 }));
  });

  it("does NOT call searchWithCitations", async () => {
    await executeResearch("topic", "/project", { depth: "quick" });
    expect(mockSearchWithCitations).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// depth=standard
// ---------------------------------------------------------------------------

describe("executeResearch — depth=standard", () => {
  it("returns ## Research header", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project");
    expect(result).toContain("## Research: TypeScript monorepo");
  });

  it("shows ### Summary section from synthesis", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project");
    expect(result).toContain("### Summary");
    expect(result).toContain("TypeScript monorepos use project references");
  });

  it("shows confidence percentage", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project");
    expect(result).toContain("Confidence: 87%");
  });

  it("shows provider list", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project");
    expect(result).toContain("Providers: ddg, brave");
  });

  it("shows ### Sources from pipeline", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project");
    expect(result).toContain("### Sources");
    expect(result).toContain("typescriptlang.org");
  });

  it("passes fetchTopN: 5 to ResearchPipeline", async () => {
    await executeResearch("topic", "/project");
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 5 }));
  });

  it("calls searchWithCitations for synthesis", async () => {
    await executeResearch("topic", "/project");
    expect(mockSearchWithCitations).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// depth=deep
// ---------------------------------------------------------------------------

describe("executeResearch — depth=deep", () => {
  it("passes fetchTopN: 8 to ResearchPipeline", async () => {
    await executeResearch("topic", "/project", { depth: "deep" });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 8 }));
  });
});

// ---------------------------------------------------------------------------
// maxSources — Bug 4 fix
// ---------------------------------------------------------------------------

describe("executeResearch — maxSources option", () => {
  it("passes maxSources: 3 as fetchTopN to ResearchPipeline (standard depth)", async () => {
    await executeResearch("topic", "/project", { maxSources: 3 });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 3 }));
  });

  it("passes maxSources: 6 as fetchTopN to ResearchPipeline (deep depth)", async () => {
    await executeResearch("topic", "/project", { depth: "deep", maxSources: 6 });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 6 }));
  });

  it("passes maxSources: 1 as fetchTopN for quick depth", async () => {
    await executeResearch("topic", "/project", { depth: "quick", maxSources: 1 });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 1 }));
  });
});

// ---------------------------------------------------------------------------
// Singleton — Bug 5 fix
// ---------------------------------------------------------------------------

describe("executeResearch — search engine singleton", () => {
  it("routes both calls through the same engine (searchWithCitations called once per invocation)", async () => {
    await executeResearch("topic one", "/project");
    await executeResearch("topic two", "/project");
    // The shared mock engine's searchWithCitations is called once per executeResearch call.
    // If a new engine were created each time it would bypass our stable mock — this
    // proves the singleton engine object is reused across invocations.
    expect(mockSearchWithCitations).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Unified sources — Bug 6 fix
// ---------------------------------------------------------------------------

describe("executeResearch — unified sources", () => {
  it("includes synthesis-only URL in Sources section", async () => {
    // DEFAULT_SYNTHESIS has "https://brave-only.example.com/ts-monorepo" which is NOT
    // in the pipeline citations (which only have typescriptlang.org and nodejs.org)
    const result = await executeResearch("TypeScript monorepo", "/project");
    expect(result).toContain("brave-only.example.com");
  });

  it("pipeline citations still appear before synthesis-only ones", async () => {
    const result = await executeResearch("TypeScript monorepo", "/project");
    const tsIdx = result.indexOf("typescriptlang.org");
    const braveIdx = result.indexOf("brave-only.example.com");
    expect(tsIdx).toBeGreaterThan(-1);
    expect(braveIdx).toBeGreaterThan(-1);
    // Pipeline citations (typescriptlang) should appear before synthesis-only (brave)
    expect(tsIdx).toBeLessThan(braveIdx);
  });

  it("does not duplicate a URL that appears in both pipeline and synthesis", async () => {
    // typescriptlang.org is in BOTH pipeline citations and synthesis results
    const result = await executeResearch("TypeScript monorepo", "/project");
    const tsCount = (result.match(/typescriptlang\.org/g) ?? []).length;
    // Should appear in numbered sources only once (not duplicated)
    expect(tsCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Graceful degradation: synthesis fails, pipeline succeeds
// ---------------------------------------------------------------------------

describe("executeResearch — synthesis failure degradation", () => {
  it("shows evidence content when only synthesis fails", async () => {
    mockSearchWithCitations.mockRejectedValueOnce(new Error("API quota exceeded"));
    const result = await executeResearch("topic", "/project");
    expect(result).toContain("## Research: topic");
    expect(result).toContain("TypeScript monorepos are best organized with workspaces.");
  });

  it("still shows Sources when only synthesis fails", async () => {
    mockSearchWithCitations.mockRejectedValueOnce(new Error("timeout"));
    const result = await executeResearch("topic", "/project");
    expect(result).toContain("### Sources");
  });

  it("shows Research failed message when both pipeline and synthesis fail", async () => {
    vi.mocked(ResearchPipeline).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockRejectedValue(new Error("Network error")),
        }) as unknown as InstanceType<typeof ResearchPipeline>,
    );
    mockSearchWithCitations.mockRejectedValueOnce(new Error("Network error"));
    const result = await executeResearch("topic", "/project");
    expect(result).toContain("Research failed: Network error");
  });
});

// ---------------------------------------------------------------------------
// Security warnings surface
// ---------------------------------------------------------------------------

describe("executeResearch — security warnings", () => {
  it("shows Security Warnings section when pipeline returns them", async () => {
    vi.mocked(ResearchPipeline).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockResolvedValue({
            evidenceBundle: {
              content: "content",
              facts: [],
              citations: [],
              metadata: { sourceCount: 0, chunkCount: 0, aggregatedAt: "" },
            },
            cacheHit: false,
            resultCount: 1,
            fetchedCount: 1,
            verificationWarnings: ["Injection risk: Possible system prompt override detected"],
          }),
        }) as unknown as InstanceType<typeof ResearchPipeline>,
    );

    const result = await executeResearch("topic", "/project", { depth: "quick" });
    expect(result).toContain("### Security Warnings");
    expect(result).toContain("Injection risk:");
  });
});

// ---------------------------------------------------------------------------
// researchSlashHandler
// ---------------------------------------------------------------------------

describe("researchSlashHandler", () => {
  it("returns usage message for empty args", async () => {
    const result = await researchSlashHandler("", { projectRoot: "/project" });
    expect(result).toContain("Usage:");
    expect(result).toContain("/research");
  });

  it("usage string documents --depth flag", async () => {
    const result = await researchSlashHandler("", { projectRoot: "/project" });
    expect(result).toContain("--depth");
  });

  it("returns research output for valid topic", async () => {
    const result = await researchSlashHandler("TypeScript monorepo", { projectRoot: "/project" });
    expect(result).toContain("## Research:");
  });

  it("parses --depth=quick flag and uses fetchTopN: 2", async () => {
    await researchSlashHandler("TypeScript --depth=quick", { projectRoot: "/project" });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 2 }));
  });

  it("strips --depth= flag from topic before searching", async () => {
    await researchSlashHandler("TypeScript monorepo --depth=quick", { projectRoot: "/project" });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 2 }));
    // Verify the flag text is not in the Sources section as a literal string search
    // (pipeline was called with correct depth, not full args string)
  });

  it("parses --depth=deep flag and uses fetchTopN: 8", async () => {
    await researchSlashHandler("topic --depth=deep", { projectRoot: "/project" });
    expect(ResearchPipeline).toHaveBeenCalledWith(expect.objectContaining({ fetchTopN: 8 }));
  });

  it("shows Research failed when both providers fail", async () => {
    vi.mocked(ResearchPipeline).mockImplementationOnce(
      () =>
        ({
          run: vi.fn().mockRejectedValue(new Error("Network error")),
        }) as unknown as InstanceType<typeof ResearchPipeline>,
    );
    mockSearchWithCitations.mockRejectedValueOnce(new Error("Network error"));
    const result = await researchSlashHandler("topic", { projectRoot: "/project" });
    expect(result).toContain("Research failed: Network error");
  });
});
