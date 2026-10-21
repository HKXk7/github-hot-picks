import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

export interface SitePick {
  rank: number;
  fullName: string;
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  forks: number;
  category: string | null;
  reason: string | null;
  // AI 生成的小白教程（Markdown），为 null 表示还没生成
  tutorial: string | null;
}

export interface SiteRunStatus {
  status: string;
  startedAt: string;
  endedAt: string | null;
  log: string | null;
}

export interface SiteIssue {
  source: "database" | "snapshot";
  issue: number;
  title: string;
  summary: string;
  content: string;
  dateKey: string;
  dateLabel: string;
  updatedAt: string;
  totalStars: number;
  languageCount: number;
  picks: SitePick[];
  runStatus: SiteRunStatus | null;
}

interface SnapshotPayload {
  issue: number;
  title: string;
  summary: string;
  content: string;
  dateKey: string;
  updatedAt: string;
  totalStars: number;
  languageCount: number;
  picks: SitePick[];
  runStatus?: SiteRunStatus | null;
}

const SNAPSHOT_PATH = path.join(process.cwd(), "public", "data", "latest.json");

function formatZhDate(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function toDayKey(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return date.toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

async function readSnapshot(): Promise<SiteIssue | null> {
  try {
    const raw = await fs.readFile(SNAPSHOT_PATH, "utf8");
    const data = JSON.parse(raw) as SnapshotPayload;

    if (!data?.picks?.length) {
      return null;
    }

    return {
      source: "snapshot",
      issue: data.issue,
      title: data.title,
      summary: data.summary,
      content: data.content,
      dateKey: data.dateKey,
      dateLabel: formatZhDate(data.updatedAt),
      updatedAt: data.updatedAt,
      totalStars: data.totalStars,
      languageCount: data.languageCount,
      picks: data.picks.map((p) => ({ ...p, tutorial: p.tutorial ?? null })),
      runStatus: data.runStatus ?? null,
    };
  } catch {
    return null;
  }
}

// 把数据库里的 Article（含推荐关系）组装成站点用的 SiteIssue
function toSiteIssue(
  article: {
    issue: number;
    title: string;
    content: string;
    weekStart: Date;
    publishedAt: Date | null;
    createdAt: Date;
    recommendations: {
      sortOrder: number;
      category: string | null;
      reason: string | null;
      repository: {
        fullName: string;
        name: string;
        description: string | null;
        url: string;
        language: string | null;
        stars: number;
        forks: number;
        tutorial: string | null;
      };
    }[];
  },
  run: SiteRunStatus | null,
): SiteIssue {
  const picks: SitePick[] = [...article.recommendations]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((rec) => ({
      fullName: rec.repository.fullName,
      name: rec.repository.name,
      description: rec.repository.description,
      url: rec.repository.url,
      language: rec.repository.language,
      stars: rec.repository.stars,
      forks: rec.repository.forks,
      category: rec.category,
      reason: rec.reason,
      tutorial: rec.repository.tutorial,
    }))
    .map((pick, index) => ({ ...pick, rank: index + 1 }));

  return {
    source: "database",
    issue: article.issue,
    title: article.title,
    summary: article.content
      .split("\n")
      .find((line) => line.trim() && !line.startsWith("#"))
      ?.replace(/^>\s*/, "")
      ?? "已生成最新推荐内容。",
    content: article.content,
    dateKey: toDayKey(article.weekStart),
    dateLabel: formatZhDate(article.weekStart),
    updatedAt: (article.publishedAt ?? article.createdAt).toISOString(),
    totalStars: picks.reduce((sum, pick) => sum + pick.stars, 0),
    languageCount: new Set(picks.map((pick) => pick.language).filter(Boolean)).size,
    picks,
    runStatus: run,
  };
}

function toRunStatus(run: {
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  log: string | null;
} | null): SiteRunStatus | null {
  if (!run) return null;
  return {
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    endedAt: run.endedAt?.toISOString() ?? null,
    log: run.log,
  };
}

const ARTICLE_INCLUDE = {
  recommendations: {
    orderBy: { sortOrder: "asc" as const },
    include: { repository: true },
  },
};

export async function getLatestSiteIssue(): Promise<SiteIssue | null> {
  try {
    const [article, run] = await Promise.all([
      prisma.article.findFirst({
        orderBy: { weekStart: "desc" },
        include: ARTICLE_INCLUDE,
      }),
      prisma.jobRun.findFirst({
        where: { jobType: "daily-update" },
        orderBy: { startedAt: "desc" },
      }),
    ]);

    if (article && article.recommendations.length > 0) {
      return toSiteIssue(article, toRunStatus(run));
    }
  } catch {
    // 数据库不存在或尚未初始化时，回退到已提交的快照文件
  }

  return readSnapshot();
}

// ========== 往期推荐 ==========

export interface IssueListItem {
  issue: number;
  dateKey: string;
  dateLabel: string;
  title: string;
  pickCount: number;
  totalStars: number;
  updatedAt: string;
}

/** 所有有推荐内容的期（按日期倒序），用于「往期推荐」列表页 */
export async function getIssueList(): Promise<IssueListItem[]> {
  try {
    const articles = await prisma.article.findMany({
      orderBy: { weekStart: "desc" },
      include: ARTICLE_INCLUDE,
    });
    return articles
      .filter((a) => a.recommendations.length > 0)
      .map((a) => ({
        issue: a.issue,
        dateKey: toDayKey(a.weekStart),
        dateLabel: formatZhDate(a.weekStart),
        title: a.title,
        pickCount: a.recommendations.length,
        totalStars: a.recommendations.reduce((sum, rec) => sum + rec.repository.stars, 0),
        updatedAt: (a.publishedAt ?? a.createdAt).toISOString(),
      }));
  } catch {
    return [];
  }
}

/** 按日期（YYYY-MM-DD）取某一期的完整内容 */
export async function getIssueByDate(dateKey: string): Promise<SiteIssue | null> {
  try {
    const [articles, run] = await Promise.all([
      prisma.article.findMany({
        orderBy: { weekStart: "desc" },
        include: ARTICLE_INCLUDE,
      }),
      prisma.jobRun.findFirst({
        where: { jobType: "daily-update" },
        orderBy: { startedAt: "desc" },
      }),
    ]);
    const article = articles.find((a) => toDayKey(a.weekStart) === dateKey);
    if (article && article.recommendations.length > 0) {
      return toSiteIssue(article, toRunStatus(run));
    }
  } catch {
    // 数据库不可用时返回 null
  }
  return null;
}

export function buildAssistantContext(issue: SiteIssue | null): string {
  if (!issue) {
    return "当前站点还没有生成推荐数据。请优先说明如何配置自动更新、如何初始化数据库、以及如何排查环境问题。";
  }

  const picks = issue.picks
    .slice(0, 8)
    .map(
      (pick) =>
        `${pick.rank}. ${pick.fullName} | ${pick.language ?? "未知语言"} | ${pick.stars} stars | ${pick.category ?? "未分类"} | 推荐理由：${pick.reason ?? "暂无"}`,
    )
    .join("\n");

  return [
    `当前最新一期：第 ${issue.issue} 期`,
    `标题：${issue.title}`,
    `日期：${issue.dateLabel}`,
    `摘要：${issue.summary}`,
    "今日推荐项目：",
    picks,
  ].join("\n");
}
