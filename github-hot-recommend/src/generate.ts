import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ScoredRepo } from "./types";
import { db, initSchema } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 计算今天的日期作为期号，例如 2026-10-21（每天一期）
export function dayLabel(): { day: string; title: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const title = `${now.getMonth() + 1} 月 ${now.getDate()} 日 · GitHub 热门项目推荐`;
  return { day, title };
}

// 项目写入（存在则更新，不存在则插入），返回 projects.id
function upsertProject(repo: ScoredRepo): number {
  const values = {
    github_id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner,
    description: repo.description,
    homepage: repo.homepage,
    html_url: repo.html_url,
    language: repo.language,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    topics: JSON.stringify(repo.topics ?? []),
    is_archived: repo.archived ? 1 : 0,
    created_at: repo.created_at,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
  };

  const existing = db
    .prepare("SELECT id FROM projects WHERE github_id = ?")
    .get(repo.id) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE projects SET
        full_name=@full_name, name=@name, owner=@owner, description=@description,
        homepage=@homepage, html_url=@html_url, language=@language, stars=@stars,
        forks=@forks, topics=@topics, is_archived=@is_archived, created_at=@created_at,
        updated_at=@updated_at, pushed_at=@pushed_at
      WHERE github_id=@github_id`,
    ).run(values);
    return existing.id;
  }

  const info = db
    .prepare(
      `INSERT INTO projects
        (github_id, full_name, name, owner, description, homepage, html_url, language,
         stars, forks, topics, is_archived, created_at, updated_at, pushed_at)
      VALUES
        (@github_id, @full_name, @name, @owner, @description, @homepage, @html_url, @language,
         @stars, @forks, @topics, @is_archived, @created_at, @updated_at, @pushed_at)`,
    )
    .run(values);
  return Number(info.lastInsertRowid);
}

// 拼接推荐理由
function highlight(repo: ScoredRepo): string {
  const bits: string[] = [];
  if (repo.stargazers_count >= 500) bits.push(`已收获 ${repo.stargazers_count}+ star`);
  bits.push(...repo.reasons);
  return bits.join("；");
}

export interface GenerateResult {
  issueId: number;
  day: string;
  title: string;
  markdownPath: string;
}

// 生成一期推荐稿：写入数据库 + 输出 Markdown 文件
export function generate(repos: ScoredRepo[]): GenerateResult {
  initSchema();
  const { day, title } = dayLabel();
  const summary = `今天从 GitHub 新项目中挑选出 ${repos.length} 个值得关注的项目，涵盖不同领域，供你快速浏览。`;

  // 期次：今天已存在则复用（幂等）。注意：issues.week 列名保留（历史原因），实际存「日期期号」
  db.prepare(
    "INSERT OR IGNORE INTO issues (week, title, summary, status, published_at) VALUES (?, ?, ?, 'published', ?)",
  ).run(day, title, summary, new Date().toISOString());
  const issue = db.prepare("SELECT id FROM issues WHERE week = ?").get(day) as {
    id: number;
  };
  const issueId = issue.id;

  // 先清空本期的旧条目，再按最新结果重建
  db.prepare("DELETE FROM recommendation_items WHERE issue_id = ?").run(issueId);
  const insertItem = db.prepare(
    "INSERT INTO recommendation_items (issue_id, project_id, rank, score, highlight) VALUES (?, ?, ?, ?, ?)",
  );

  let markdown = `# ${title}\n\n> ${summary}\n\n`;
  repos.forEach((repo, i) => {
    const projectId = upsertProject(repo);
    const rank = i + 1;
    insertItem.run(issueId, projectId, rank, repo.score, highlight(repo));

    markdown += `## ${rank}. ${repo.full_name}\n\n`;
    if (repo.description) markdown += `${repo.description}\n\n`;
    markdown += `- Stars：${repo.stargazers_count}　|　语言：${repo.language ?? "—"}\n`;
    markdown += `- 仓库：${repo.html_url}\n`;
    if (repo.homepage) markdown += `- 官网：${repo.homepage}\n`;
    markdown += `- 推荐理由：${highlight(repo)}\n\n`;
  });

  const dataDir = join(__dirname, "..", "data");
  mkdirSync(dataDir, { recursive: true });
  const markdownPath = join(dataDir, `${day}.md`);
  writeFileSync(markdownPath, markdown, "utf8");

  return { issueId, day, title, markdownPath };
}
