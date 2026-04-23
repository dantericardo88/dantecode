// ============================================================================
// @dantecode/core — Context Mention Resolver Tests
// All tests use injected opts — no real HTTP, git, or filesystem I/O.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import {
  classifyMention,
  resolveMention,
} from "../context-mention-resolver.js";

// ─── classifyMention ─────────────────────────────────────────────────────────

describe("classifyMention", () => {
  it("classifies https URL as 'url'", () => {
    expect(classifyMention("https://example.com")).toBe("url");
  });

  it("classifies http URL as 'url'", () => {
    expect(classifyMention("http://example.com/page")).toBe("url");
  });

  it("classifies .png path as 'image'", () => {
    expect(classifyMention("screenshot.png")).toBe("image");
  });

  it("classifies .jpg path as 'image'", () => {
    expect(classifyMention("photo.jpg")).toBe("image");
  });

  it("classifies short hex string as 'git-ref'", () => {
    expect(classifyMention("abc1234")).toBe("git-ref");
  });

  it("classifies branch name as 'git-ref'", () => {
    expect(classifyMention("main")).toBe("git-ref");
  });

  it("classifies feature branch with slashes as 'git-ref'", () => {
    expect(classifyMention("feat/my-feature")).toBe("git-ref");
  });

  it("classifies unknown token as 'unknown'", () => {
    expect(classifyMention("???")).toBe("unknown");
  });
});

// ─── resolveMention — url ────────────────────────────────────────────────────

describe("resolveMention — url", () => {
  it("strips HTML and truncates content to 3000 chars", async () => {
    const html = `<html><body>${"<p>hello world</p>".repeat(500)}</body></html>`;
    const fetchUrl = vi.fn().mockResolvedValue(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

    const chunk = await resolveMention("https://example.com", { fetchUrl });

    expect(chunk.type).toBe("url");
    expect(chunk.label).toBe("example.com");
    expect(chunk.content.length).toBeLessThanOrEqual(3000);
    expect(fetchUrl).toHaveBeenCalledWith("https://example.com");
  });

  it("uses hostname as label", async () => {
    const fetchUrl = vi.fn().mockResolvedValue("page content");
    const chunk = await resolveMention("https://docs.example.org/guide", { fetchUrl });
    expect(chunk.label).toBe("docs.example.org");
  });

  it("returns unknown chunk gracefully when fetch throws", async () => {
    const fetchUrl = vi.fn().mockRejectedValue(new Error("network timeout"));
    const chunk = await resolveMention("https://example.com", { fetchUrl });
    expect(chunk.type).toBe("unknown");
    expect(chunk.content).toBe("");
  });
});

// ─── resolveMention — git-ref ────────────────────────────────────────────────

describe("resolveMention — git-ref", () => {
  it("returns git-ref chunk with execGit output", async () => {
    const execGit = vi.fn().mockResolvedValue("commit abc1234\nAuthor: Alice\n 1 file changed");
    const chunk = await resolveMention("abc1234", { execGit });

    expect(chunk.type).toBe("git-ref");
    expect(chunk.label).toBe("abc1234");
    expect(chunk.content).toContain("commit abc1234");
    expect(execGit).toHaveBeenCalledWith(["show", "--stat", "abc1234"]);
  });

  it("falls back to git log when show fails", async () => {
    const execGit = vi
      .fn()
      .mockRejectedValueOnce(new Error("bad revision"))
      .mockResolvedValueOnce("abc1234 fix the bug\ndef5678 add feature");

    const chunk = await resolveMention("main", { execGit });

    expect(chunk.type).toBe("git-ref");
    expect(chunk.content).toContain("abc1234 fix the bug");
  });

  it("truncates output to 2000 chars", async () => {
    const longOutput = "x".repeat(5000);
    const execGit = vi.fn().mockResolvedValue(longOutput);
    const chunk = await resolveMention("main", { execGit });
    expect(chunk.content.length).toBeLessThanOrEqual(2000);
  });

  it("returns unknown chunk gracefully when both git calls fail", async () => {
    const execGit = vi.fn().mockRejectedValue(new Error("not a git repo"));
    const chunk = await resolveMention("abc1234", { execGit });
    expect(chunk.type).toBe("unknown");
    expect(chunk.content).toBe("");
  });
});

// ─── resolveMention — image ──────────────────────────────────────────────────

describe("resolveMention — image", () => {
  it("returns base64 and mimeType for PNG", async () => {
    const fakeBuffer = Buffer.from("fake-image-data");
    const readFile = vi.fn().mockResolvedValue(fakeBuffer);

    const chunk = await resolveMention("img.png", { readFile });

    expect(chunk.type).toBe("image");
    expect(chunk.label).toBe("img.png");
    expect(chunk.content).toBe("[image attached]");
    expect(chunk.base64).toBe(fakeBuffer.toString("base64"));
    expect(chunk.mimeType).toBe("image/png");
  });

  it("assigns correct mimeType for JPEG", async () => {
    const readFile = vi.fn().mockResolvedValue(Buffer.from("data"));
    const chunk = await resolveMention("photo.jpg", { readFile });
    expect(chunk.mimeType).toBe("image/jpeg");
  });

  it("returns unknown chunk when readFile throws", async () => {
    const readFile = vi.fn().mockRejectedValue(new Error("file not found"));
    const chunk = await resolveMention("missing.png", { readFile });
    expect(chunk.type).toBe("unknown");
    expect(chunk.content).toBe("");
  });
});

// ─── resolveMention — unknown ────────────────────────────────────────────────

describe("resolveMention — unknown", () => {
  it("returns unknown chunk without throwing for unclassifiable input", async () => {
    const fetchUrl = vi.fn();
    const chunk = await resolveMention("???", { fetchUrl });
    expect(chunk.type).toBe("unknown");
    expect(chunk.label).toBe("???");
    expect(chunk.content).toBe("");
    expect(fetchUrl).not.toHaveBeenCalled();
  });
});
