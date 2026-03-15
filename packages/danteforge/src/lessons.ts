// ============================================================================
// @dantecode/danteforge — Lessons System (SQLite-backed via sql.js)
// Records, queries, and manages learned patterns from autoforge iterations,
// PDSE failures, constitution violations, and user feedback.
// Uses sql.js (pure JavaScript SQLite) to avoid native compilation dependencies.
// ============================================================================

import type { Lesson, LessonsQuery, LessonSeverity } from "@dantecode/config-types";
import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Database Path Resolution
// ----------------------------------------------------------------------------

function getLessonsDbPath(projectRoot: string): string {
  return join(resolve(projectRoot), ".dantecode", "lessons.db");
}

// ----------------------------------------------------------------------------
// Database Initialization
// ----------------------------------------------------------------------------

let sqlJsInitPromise: ReturnType<typeof initSqlJs> | null = null;

async function getSqlJs(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (sqlJsInitPromise === null) {
    sqlJsInitPromise = initSqlJs();
  }
  return sqlJsInitPromise;
}

/**
 * Opens or creates the lessons SQLite database.
 * Loads from disk if exists, otherwise creates fresh.
 */
export async function initLessonsDB(projectRoot: string): Promise<SqlJsDatabase> {
  const SQL = await getSqlJs();
  const dbPath = getLessonsDbPath(projectRoot);
  const dbDir = join(resolve(projectRoot), ".dantecode");

  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  let db: SqlJsDatabase;
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS lessons (
      id TEXT PRIMARY KEY,
      project_root TEXT NOT NULL,
      pattern TEXT NOT NULL,
      correction TEXT NOT NULL,
      file_pattern TEXT,
      language TEXT,
      framework TEXT,
      occurrences INTEGER NOT NULL DEFAULT 1,
      last_seen TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'warning',
      source TEXT NOT NULL DEFAULT 'autoforge'
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_project_root ON lessons(project_root)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_severity ON lessons(severity)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_pattern ON lessons(pattern)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_language ON lessons(language)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_lessons_file_pattern ON lessons(file_pattern)`);

  return db;
}

/**
 * Persists the database to disk.
 */
function saveDB(db: SqlJsDatabase, projectRoot: string): void {
  const dbPath = getLessonsDbPath(projectRoot);
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

// ----------------------------------------------------------------------------
// Severity Ordering
// ----------------------------------------------------------------------------

const SEVERITY_ORDER: Record<LessonSeverity, number> = {
  critical: 4,
  error: 3,
  warning: 2,
  info: 1,
};

function severityRank(severity: LessonSeverity): number {
  return SEVERITY_ORDER[severity] ?? 0;
}

// ----------------------------------------------------------------------------
// Row-to-Lesson mapping
// ----------------------------------------------------------------------------

interface LessonRow {
  id: string;
  project_root: string;
  pattern: string;
  correction: string;
  file_pattern: string | null;
  language: string | null;
  framework: string | null;
  occurrences: number;
  last_seen: string;
  severity: string;
  source: string;
}

function resultToRows(result: ReturnType<SqlJsDatabase["exec"]>): LessonRow[] {
  if (result.length === 0) return [];
  const first = result[0];
  if (!first) return [];
  const columns = first.columns;
  return first.values.map((values) => {
    const row: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      row[col] = values[i] ?? null;
    });
    return row as unknown as LessonRow;
  });
}

function rowToLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    projectRoot: row.project_root,
    pattern: row.pattern,
    correction: row.correction,
    filePattern: row.file_pattern ?? undefined,
    language: row.language ?? undefined,
    framework: row.framework ?? undefined,
    occurrences: row.occurrences,
    lastSeen: row.last_seen,
    severity: row.severity as LessonSeverity,
    source: row.source as Lesson["source"],
  };
}

// ----------------------------------------------------------------------------
// Record (Upsert) a Lesson
// ----------------------------------------------------------------------------

export async function recordLesson(
  lesson: Omit<Lesson, "id"> & { id?: string },
  projectRoot: string,
): Promise<Lesson> {
  const db = await initLessonsDB(projectRoot);

  try {
    const id = lesson.id ?? randomUUID();
    const now = new Date().toISOString();

    const existing = resultToRows(
      db.exec(
        `SELECT id, occurrences FROM lessons WHERE pattern = $pattern AND project_root = $root LIMIT 1`,
        { $pattern: lesson.pattern, $root: lesson.projectRoot },
      ),
    );

    if (existing.length > 0) {
      const ex = existing[0]!;
      db.run(
        `UPDATE lessons SET correction = $correction, file_pattern = $fp, language = $lang,
         framework = $fw, occurrences = occurrences + 1, last_seen = $now,
         severity = $sev, source = $src WHERE id = $id`,
        {
          $correction: lesson.correction,
          $fp: lesson.filePattern ?? null,
          $lang: lesson.language ?? null,
          $fw: lesson.framework ?? null,
          $now: now,
          $sev: lesson.severity,
          $src: lesson.source,
          $id: ex.id,
        },
      );
      saveDB(db, projectRoot);
      return {
        id: ex.id,
        projectRoot: lesson.projectRoot,
        pattern: lesson.pattern,
        correction: lesson.correction,
        filePattern: lesson.filePattern,
        language: lesson.language,
        framework: lesson.framework,
        occurrences: ex.occurrences + 1,
        lastSeen: now,
        severity: lesson.severity,
        source: lesson.source,
      };
    } else {
      db.run(
        `INSERT INTO lessons (id, project_root, pattern, correction, file_pattern, language,
         framework, occurrences, last_seen, severity, source)
         VALUES ($id, $root, $pattern, $correction, $fp, $lang, $fw, $occ, $seen, $sev, $src)`,
        {
          $id: id,
          $root: lesson.projectRoot,
          $pattern: lesson.pattern,
          $correction: lesson.correction,
          $fp: lesson.filePattern ?? null,
          $lang: lesson.language ?? null,
          $fw: lesson.framework ?? null,
          $occ: lesson.occurrences ?? 1,
          $seen: lesson.lastSeen ?? now,
          $sev: lesson.severity,
          $src: lesson.source,
        },
      );
      saveDB(db, projectRoot);
      return {
        id,
        projectRoot: lesson.projectRoot,
        pattern: lesson.pattern,
        correction: lesson.correction,
        filePattern: lesson.filePattern,
        language: lesson.language,
        framework: lesson.framework,
        occurrences: lesson.occurrences ?? 1,
        lastSeen: lesson.lastSeen ?? now,
        severity: lesson.severity,
        source: lesson.source,
      };
    }
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// Query Lessons
// ----------------------------------------------------------------------------

export async function queryLessons(query: LessonsQuery): Promise<Lesson[]> {
  const db = await initLessonsDB(query.projectRoot);

  try {
    const conditions: string[] = ["project_root = $root"];
    const params: Record<string, string | number | null> = { $root: query.projectRoot };

    if (query.filePattern) {
      conditions.push("(file_pattern IS NULL OR file_pattern LIKE $fp)");
      params["$fp"] = `%${query.filePattern}%`;
    }

    if (query.language) {
      conditions.push("(language IS NULL OR language = $lang)");
      params["$lang"] = query.language;
    }

    if (query.minSeverity) {
      const minRank = severityRank(query.minSeverity);
      conditions.push(`
        CASE severity
          WHEN 'critical' THEN 4
          WHEN 'error' THEN 3
          WHEN 'warning' THEN 2
          WHEN 'info' THEN 1
          ELSE 0
        END >= $minRank
      `);
      params["$minRank"] = minRank;
    }

    const whereClause = conditions.join(" AND ");
    const sql = `
      SELECT * FROM lessons
      WHERE ${whereClause}
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 4
          WHEN 'error' THEN 3
          WHEN 'warning' THEN 2
          WHEN 'info' THEN 1
          ELSE 0
        END DESC,
        occurrences DESC
      LIMIT $limit
    `;
    params["$limit"] = query.limit;

    const rows = resultToRows(db.exec(sql, params));
    return rows.map(rowToLesson);
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// Get Lesson Count
// ----------------------------------------------------------------------------

export async function getLessonCount(projectRoot: string): Promise<number> {
  const db = await initLessonsDB(projectRoot);

  try {
    const result = db.exec(`SELECT COUNT(*) as count FROM lessons WHERE project_root = $root`, {
      $root: resolve(projectRoot),
    });
    if (result.length === 0 || !result[0] || result[0].values.length === 0) return 0;
    const firstRow = result[0].values[0];
    if (!firstRow || firstRow.length === 0) return 0;
    return Number(firstRow[0]) || 0;
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// Delete Lesson
// ----------------------------------------------------------------------------

export async function deleteLesson(lessonId: string, projectRoot: string): Promise<boolean> {
  const db = await initLessonsDB(projectRoot);

  try {
    const before = db.exec(`SELECT COUNT(*) FROM lessons WHERE id = $id`, { $id: lessonId });
    const beforeCount =
      before.length > 0 && before[0] && before[0].values.length > 0 && before[0].values[0]
        ? Number(before[0].values[0][0])
        : 0;

    if (beforeCount === 0) return false;

    db.run(`DELETE FROM lessons WHERE id = $id`, { $id: lessonId });
    saveDB(db, projectRoot);
    return true;
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// Clear All Lessons
// ----------------------------------------------------------------------------

export async function clearLessons(projectRoot: string): Promise<number> {
  const db = await initLessonsDB(projectRoot);

  try {
    const before = db.exec(`SELECT COUNT(*) FROM lessons WHERE project_root = $root`, {
      $root: resolve(projectRoot),
    });
    const count =
      before.length > 0 && before[0] && before[0].values.length > 0 && before[0].values[0]
        ? Number(before[0].values[0][0])
        : 0;

    db.run(`DELETE FROM lessons WHERE project_root = $root`, { $root: resolve(projectRoot) });
    saveDB(db, projectRoot);
    return count;
  } finally {
    db.close();
  }
}

// ----------------------------------------------------------------------------
// Format Lessons for Prompt Injection
// ----------------------------------------------------------------------------

export function formatLessonsForPrompt(lessons: Lesson[]): string {
  if (lessons.length === 0) {
    return "";
  }

  const header = `## Previously Learned Lessons (${lessons.length} relevant)\n\n`;
  const entries = lessons.map((lesson, index) => {
    const parts: string[] = [
      `### Lesson ${index + 1} [${lesson.severity.toUpperCase()}] (seen ${lesson.occurrences}x)`,
      `**Pattern:** ${lesson.pattern}`,
      `**Correction:** ${lesson.correction}`,
    ];

    if (lesson.filePattern) {
      parts.push(`**Applies to files:** ${lesson.filePattern}`);
    }
    if (lesson.language) {
      parts.push(`**Language:** ${lesson.language}`);
    }
    if (lesson.framework) {
      parts.push(`**Framework:** ${lesson.framework}`);
    }

    return parts.join("\n");
  });

  return header + entries.join("\n\n");
}
