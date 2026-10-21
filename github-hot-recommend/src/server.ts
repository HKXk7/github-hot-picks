import express from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, initSchema } from "./db";
import { runPipeline } from "./pipeline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.use(express.json());
initSchema();

// 健康检查
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// 期次列表（默认按最新在前）
app.get("/api/issues", (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const rows = db
    .prepare("SELECT * FROM issues ORDER BY id DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as unknown[];
  const total = (db.prepare("SELECT COUNT(*) AS c FROM issues").get() as { c: number }).c;
  res.json({ data: rows, total, page, limit });
});

// 单期详情（含本期推荐的项目）
app.get("/api/issues/:week", (req, res) => {
  const issue = db.prepare("SELECT * FROM issues WHERE week = ?").get(req.params.week) as
    | Record<string, unknown>
    | undefined;
  if (!issue) return res.status(404).json({ error: "not found" });
  const items = db
    .prepare(
      `SELECT ri.rank, ri.score, ri.highlight, p.*
       FROM recommendation_items ri
       JOIN projects p ON p.id = ri.project_id
       WHERE ri.issue_id = ?
       ORDER BY ri.rank ASC`,
    )
    .all(issue.id);
  res.json({ issue, items });
});

// 项目库（支持关键词 / 语言筛选）
app.get("/api/projects", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const language = typeof req.query.language === "string" ? req.query.language : "";
  const sort = req.query.sort === "stars" ? "stars DESC" : "id DESC";
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push("(full_name LIKE ? OR description LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (language) {
    where.push("language = ?");
    params.push(language);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db
    .prepare(`SELECT * FROM projects ${whereSql} ORDER BY ${sort} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown[];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM projects ${whereSql}`).get(
    ...params,
  ) as { c: number }).c;
  res.json({ data: rows, total, page, limit });
});

// 项目详情
app.get("/api/projects/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.json(row);
});

// 站点统计
app.get("/api/stats", (_req, res) => {
  const issues = (db.prepare("SELECT COUNT(*) AS c FROM issues").get() as { c: number }).c;
  const projects = (db.prepare("SELECT COUNT(*) AS c FROM projects").get() as { c: number }).c;
  const languages = db
    .prepare(
      "SELECT language, COUNT(*) AS c FROM projects WHERE language IS NOT NULL GROUP BY language ORDER BY c DESC LIMIT 10",
    )
    .all();
  res.json({ issues, projects, languages });
});

// 手动触发一次抓取生成（可选 API_KEY 做最简保护）
app.post("/api/refresh", async (req, res) => {
  const key = process.env.API_KEY;
  if (key && req.headers["x-api-key"] !== key) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const result = await runPipeline("manual", 10);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// 静态前端
app.use(express.static(join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`服务已启动：http://localhost:${PORT}`);
});
