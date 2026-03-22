import { describe, it, expect, vi, afterEach } from "vitest";
import { checkForUpdate } from "./auto-update.js";

describe("auto-update", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------- isNewer logic (tested via checkForUpdate behaviour) ----------

  describe("checkForUpdate — no update available", () => {
    it("does not write to stderr when versions are identical", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      } as unknown as Response);

      await checkForUpdate("1.0.0");

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("does not write to stderr when current version is newer", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "0.9.0" }),
      } as unknown as Response);

      await checkForUpdate("1.0.0");

      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe("checkForUpdate — update available", () => {
    it("writes a notification to stderr when a newer version exists", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "2.0.0" }),
      } as unknown as Response);

      await checkForUpdate("1.0.0");

      expect(stderrSpy).toHaveBeenCalled();
      // The notification must mention both versions
      const callArgs = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(callArgs).toContain("1.0.0");
      expect(callArgs).toContain("2.0.0");
    });

    it("mentions the npm install command in the notification", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "3.0.0" }),
      } as unknown as Response);

      await checkForUpdate("1.0.0");

      const output = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("npm install");
    });

    it("detects a minor version bump as an update", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.1.0" }),
      } as unknown as Response);

      await checkForUpdate("1.0.0");

      expect(stderrSpy).toHaveBeenCalled();
    });

    it("detects a patch version bump as an update", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.1" }),
      } as unknown as Response);

      await checkForUpdate("1.0.0");

      expect(stderrSpy).toHaveBeenCalled();
    });
  });

  describe("checkForUpdate — error handling", () => {
    it("silently ignores a network error without throwing", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("network failure"));

      await expect(checkForUpdate("1.0.0")).resolves.toBeUndefined();
    });

    it("silently ignores a non-ok HTTP response", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      } as unknown as Response);

      await checkForUpdate("1.0.0");

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("silently ignores a malformed JSON response without throwing", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ unexpected: "shape" }),
      } as unknown as Response);

      await expect(checkForUpdate("1.0.0")).resolves.toBeUndefined();
    });

    it("silently ignores an AbortError (timeout) without throwing", async () => {
      const abortError = new DOMException("The user aborted a request.", "AbortError");
      global.fetch = vi.fn().mockRejectedValueOnce(abortError);

      await expect(checkForUpdate("1.0.0")).resolves.toBeUndefined();
    });

    it("does not write to stderr on any error", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      global.fetch = vi.fn().mockRejectedValueOnce(new Error("connection refused"));

      await checkForUpdate("1.0.0");

      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });
});
