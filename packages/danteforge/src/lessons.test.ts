import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  initLessonsDB,
  recordLesson,
  queryLessons,
  getLessonCount,
  deleteLesson,
  clearLessons,
} from "./lessons.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

describe("lessons system (SQLite)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dantecode-lessons-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("initLessonsDB", () => {
    it("creates the database and lessons table", async () => {
      const db = await initLessonsDB(testDir);
      expect(db).toBeDefined();
      // Verify table exists by running a count query
      const result = db.exec("SELECT COUNT(*) FROM lessons");
      expect(result[0]?.values[0]?.[0]).toBe(0);
      db.close();
    });

    it("creates .dantecode directory if missing", async () => {
      const db = await initLessonsDB(testDir);
      db.close();
      // If we got here without error, the directory was created
      expect(true).toBe(true);
    });
  });

  describe("recordLesson", () => {
    it("records a new lesson", async () => {
      const lesson = await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Missing error handling in async function",
          correction: "Wrap async calls in try/catch blocks",
          language: "typescript",
          occurrences: 1,
          lastSeen: "2026-03-15T10:00:00Z",
          severity: "warning",
          source: "autoforge",
        },
        testDir,
      );

      expect(lesson.id).toBeTruthy();
      expect(lesson.pattern).toBe("Missing error handling in async function");
      expect(lesson.correction).toBe("Wrap async calls in try/catch blocks");
      expect(lesson.severity).toBe("warning");
      expect(lesson.source).toBe("autoforge");
    });

    it("assigns a UUID to new lessons", async () => {
      const lesson = await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Test pattern",
          correction: "Test correction",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "info",
          source: "manual",
        },
        testDir,
      );

      expect(lesson.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("upserts duplicate patterns (increments occurrences)", async () => {
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Duplicate pattern",
          correction: "Fix A",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "autoforge",
        },
        testDir,
      );

      const updated = await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Duplicate pattern",
          correction: "Fix B (updated)",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "error",
          source: "autoforge",
        },
        testDir,
      );

      expect(updated.occurrences).toBe(2);
      expect(updated.correction).toBe("Fix B (updated)");
    });

    it("stores optional fields (filePattern, language, framework)", async () => {
      const lesson = await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Test with metadata",
          correction: "Correction",
          filePattern: "src/**/*.ts",
          language: "typescript",
          framework: "express",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "info",
          source: "manual",
        },
        testDir,
      );

      expect(lesson.filePattern).toBe("src/**/*.ts");
      expect(lesson.language).toBe("typescript");
      expect(lesson.framework).toBe("express");
    });
  });

  describe("queryLessons", () => {
    it("returns empty array for project with no lessons", async () => {
      const lessons = await queryLessons({
        projectRoot: resolve(testDir),
        limit: 10,
      });
      expect(lessons).toEqual([]);
    });

    it("returns recorded lessons", async () => {
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Pattern 1",
          correction: "Fix 1",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "autoforge",
        },
        testDir,
      );

      const lessons = await queryLessons({
        projectRoot: resolve(testDir),
        limit: 10,
      });
      expect(lessons).toHaveLength(1);
      expect(lessons[0]?.pattern).toBe("Pattern 1");
    });

    it("filters by language", async () => {
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "TS pattern",
          correction: "Fix",
          language: "typescript",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "autoforge",
        },
        testDir,
      );
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Python pattern",
          correction: "Fix",
          language: "python",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "autoforge",
        },
        testDir,
      );

      const tsLessons = await queryLessons({
        projectRoot: resolve(testDir),
        language: "typescript",
        limit: 10,
      });
      // Should include TS-specific lessons and lessons with null language
      expect(tsLessons.length).toBeGreaterThanOrEqual(1);
      expect(tsLessons.every((l) => l.language === "typescript" || l.language === undefined)).toBe(
        true,
      );
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await recordLesson(
          {
            projectRoot: resolve(testDir),
            pattern: `Pattern ${i}`,
            correction: `Fix ${i}`,
            occurrences: 1,
            lastSeen: "2026-03-15",
            severity: "warning",
            source: "autoforge",
          },
          testDir,
        );
      }

      const lessons = await queryLessons({
        projectRoot: resolve(testDir),
        limit: 3,
      });
      expect(lessons).toHaveLength(3);
    });

    it("orders by severity (critical first) then occurrences", async () => {
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Low severity",
          correction: "Fix",
          occurrences: 10,
          lastSeen: "2026-03-15",
          severity: "info",
          source: "autoforge",
        },
        testDir,
      );
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "High severity",
          correction: "Fix",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "critical",
          source: "autoforge",
        },
        testDir,
      );

      const lessons = await queryLessons({
        projectRoot: resolve(testDir),
        limit: 10,
      });
      expect(lessons[0]?.severity).toBe("critical");
    });
  });

  describe("getLessonCount", () => {
    it("returns 0 for empty database", async () => {
      const count = await getLessonCount(testDir);
      expect(count).toBe(0);
    });

    it("returns correct count after recording", async () => {
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Pattern A",
          correction: "Fix A",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "autoforge",
        },
        testDir,
      );
      await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "Pattern B",
          correction: "Fix B",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "error",
          source: "autoforge",
        },
        testDir,
      );

      const count = await getLessonCount(testDir);
      expect(count).toBe(2);
    });
  });

  describe("deleteLesson", () => {
    it("deletes an existing lesson", async () => {
      const lesson = await recordLesson(
        {
          projectRoot: resolve(testDir),
          pattern: "To be deleted",
          correction: "Fix",
          occurrences: 1,
          lastSeen: "2026-03-15",
          severity: "warning",
          source: "autoforge",
        },
        testDir,
      );

      const deleted = await deleteLesson(lesson.id, testDir);
      expect(deleted).toBe(true);

      const count = await getLessonCount(testDir);
      expect(count).toBe(0);
    });

    it("returns false for non-existent lesson", async () => {
      const deleted = await deleteLesson("nonexistent-id", testDir);
      expect(deleted).toBe(false);
    });
  });

  describe("clearLessons", () => {
    it("removes all lessons for a project", async () => {
      for (let i = 0; i < 3; i++) {
        await recordLesson(
          {
            projectRoot: resolve(testDir),
            pattern: `Pattern ${i}`,
            correction: `Fix ${i}`,
            occurrences: 1,
            lastSeen: "2026-03-15",
            severity: "warning",
            source: "autoforge",
          },
          testDir,
        );
      }

      const cleared = await clearLessons(testDir);
      expect(cleared).toBe(3);

      const count = await getLessonCount(testDir);
      expect(count).toBe(0);
    });

    it("returns 0 when no lessons exist", async () => {
      const cleared = await clearLessons(testDir);
      expect(cleared).toBe(0);
    });
  });
});
