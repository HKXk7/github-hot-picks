import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 数据库文件放在项目根目录的 data/ 下，可用环境变量 DB_PATH 覆盖
const dbPath = process.env.DB_PATH ?? join(__dirname, "..", "data", "app.db");
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// 建表（幂等，可重复执行）
export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      github_id   INTEGER NOT NULL UNIQUE,
      full_name   TEXT NOT NULL,
      name        TEXT NOT NULL,
      owner       TEXT NOT NULL,
      description TEXT,
      homepage    TEXT,
      html_url    TEXT NOT NULL,
      language    TEXT,
      stars       INTEGER NOT NULL DEFAULT 0,
      forks       INTEGER NOT NULL DEFAULT 0,
      topics      TEXT NOT NULL DEFAULT '[]',
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT,
      updated_at  TEXT,
      pushed_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS issues (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      -- 列名保留 week（历史原因），实际存「日期期号」，如 2026-10-21，每天一期
      week         TEXT NOT NULL UNIQUE,
      title        TEXT NOT NULL,
      summary      TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'published',
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS recommendation_items (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id   INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      rank       INTEGER NOT NULL,
      score      REAL NOT NULL,
      highlight  TEXT NOT NULL DEFAULT '',
      UNIQUE(issue_id, project_id),
      FOREIGN KEY (issue_id)   REFERENCES issues(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger       TEXT NOT NULL,
      status        TEXT NOT NULL,
      project_count INTEGER NOT NULL DEFAULT 0,
      error         TEXT,
      started_at    TEXT,
      finished_at   TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_issue ON recommendation_items(issue_id);
    CREATE INDEX IF NOT EXISTS idx_projects_lang ON projects(language);
    CREATE INDEX IF NOT EXISTS idx_issues_week ON issues(week);
  `);
}

// 查询历史上已推荐过的 full_name（排除指定周），用于跨期去重
export function getRecommendedFullNames(excludeWeek: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.full_name AS full_name
       FROM recommendation_items ri
       JOIN projects p ON p.id = ri.project_id
       JOIN issues i ON i.id = ri.issue_id
       WHERE i.week != ?`,
    )
    .all(excludeWeek) as { full_name: string }[];
  return rows.map((r) => r.full_name);
}
