import { prisma } from "@/lib/prisma";
import { readSiteData } from "@/lib/snapshot-source";
import { parseStructuredTutorial, toTutorialMarkdown } from "@/lib/tutorial/schema";
import { buildIssueSummary } from "@/lib/picks";
import type { ToolEvidence } from "@/lib/tutorial/evidence";

/** 从存库的教程里取出取证痕迹；旧版 Markdown 数据自然返回空 */
function evidenceOf(raw: string | null): ToolEvidence[] {
  return parseStructuredTutorial(raw)?.evidence ?? [];
}

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
  // AI 生成的小白教程。数据库里存的是结构化 JSON，这里统一转成 Markdown 供前端渲染；
  // 老数据本身就是 Markdown，toTutorialMarkdown 会原样返回，因此两种格式可以共存。
  // 为 null 表示还没生成。
  tutorial: string | null;
  /** 这份教程是 AI 查过哪些来源才写出来的；空数组表示当时没联网取证 */
  tutorialEvidence: ToolEvidence[];
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
  // readSiteData 会按 SITE_SNAPSHOT_BASE 决定读远端还是本地文件。
  // 本地开发不配这个变量，行为和以前完全一样；部署版靠它每天自动拿最新一期。
  const data = await readSiteData<SnapshotPayload>("latest.json");
  if (!data?.picks?.length) return null;

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
    picks: data.picks.map((p) => ({
      ...p,
      tutorial: toTutorialMarkdown(p.tutorial ?? null),
      tutorialEvidence: evidenceOf(p.tutorial ?? null),
    })),
    runStatus: data.runStatus ?? null,
  };
}

/**
 * 静态包里的往期详情。
 *
 * 部署环境没有数据库（serverless 上 SQLite 只读、发布沙箱不保证带得进来），
 * 往期页原本会全空。日更任务现在把每一期都写成独立的 JSON，这里直接读。
 * 存的就是 SiteIssue 本身，不需要再组装一遍 —— 组装逻辑只留在 DB 路径里。
 */
async function readStaticIssue(dateKey: string): Promise<SiteIssue | null> {
  const data = await readSiteData<SiteIssue>(`issues/${dateKey}.json`);
  if (!data?.picks?.length || data.dateKey !== dateKey) return null;
  return {
    ...data,
    source: "snapshot",
    picks: data.picks.map((p) => ({
      ...p,
      tutorial: toTutorialMarkdown(p.tutorial ?? null),
      tutorialEvidence: p.tutorialEvidence ?? evidenceOf(p.tutorial ?? null),
    })),
  };
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
        tutorial: toTutorialMarkdown(rec.repository.tutorial),
        tutorialEvidence: evidenceOf(rec.repository.tutorial),
    }))
    .map((pick, index) => ({ ...pick, rank: index + 1 }));

  return {
    source: "database",
    issue: article.issue,
    title: article.title,
    // 摘要从数据里现算（方向分布 + 榜首），不再用推荐稿开头那句每期都一样的套话
    summary: buildIssueSummary(picks),
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

/** 往期列表页只需要 star 数，没必要把仓库每个字段都拉出来 */
const LIST_INCLUDE = {
  recommendations: {
    select: { repository: { select: { stars: true } } },
  },
};

// ========== 缓存 ==========
/**
 * 站点数据一天才变一次（日更管线每天跑一趟），没必要每个访客都查一遍库。
 *
 * 这里刻意用**进程内 TTL 缓存**而不是 Next 的 `use cache`：后者把结果烘焙进
 * 构建产物，适合"内容随代码一起发版"的站点；而本项目的数据是运行时被
 * `update:daily` 改写的（bot 只提交快照、不触发重新构建），构建期缓存会一直
 * 停在发版那一刻。TTL 到期就重查，跟数据的实际更新方式对得上。
 *
 * 单实例自托管足够；多实例部署时每个实例各存一份，最多是缓存命中率下降，
 * 不会读到错数据。
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const cacheStore = new Map<string, { at: number; value: unknown }>();

/**
 * 这里必须用 performance.now() 而不是 Date.now()。
 *
 * 项目开了 cacheComponents，预渲染阶段 Next 会拦截 Date.now() —— 它认为"当前时间"
 * 是个每次渲染都可能变的不稳定值（实测：/history 路由直接构建失败）。而 TTL 要的
 * 其实只是"过去了多久"，本质是计时，用 performance.now() 正好，也正是 Next 建议的做法。
 */
function elapsedMs(): number {
  return performance.now();
}

async function withCache<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cacheStore.get(key);
  if (hit && elapsedMs() - hit.at < CACHE_TTL_MS) return hit.value as T;

  const value = await load();
  cacheStore.set(key, { at: elapsedMs(), value });
  return value;
}

/** 手动刷新用（比如刚跑完日更想立刻看到），测试里也用来隔离用例 */
export function clearSiteCache(): void {
  cacheStore.clear();
}

export async function getLatestSiteIssue(): Promise<SiteIssue | null> {
  return withCache("latest", async () => {
    try {
      const [article, run] = await Promise.all([
        prisma.article.findFirst({
          // 只展示已发布的文章（避免种子数据的草稿出现在首页）
          where: { status: "published" },
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
  });
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
  return withCache("issue-list", async () => {
    // 「查库成功但库是空的」和「连不上库」都要回退：部署沙箱里往往是
    // 一个刚 migrate 完的空 SQLite，查询不抛异常，只是安静地返回 []。
    let fromDb: IssueListItem[] = [];
    try {
      const articles = await prisma.article.findMany({
        where: { status: "published" },
        orderBy: { weekStart: "desc" },
        include: LIST_INCLUDE,
      });
      fromDb = articles
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
      // 数据库不可用 → 走静态包
    }
    if (fromDb.length > 0) return fromDb;

    return (await readSiteData<IssueListItem[]>("history.json")) ?? [];
  });
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 把 "2026-11-02" 换成当天 00:00 到次日 00:00 的 UTC 区间。
 *
 * 站点所有日期都按中国时区算（日更脚本也是），所以这里固定 +08:00；
 * 中国不实行夏令时，+08:00 全年成立。返回 null 表示 dateKey 不合法
 * ——用户可以直接改 URL，不能信任。
 */
function dayRange(dateKey: string): { start: Date; end: Date } | null {
  if (!DATE_KEY_RE.test(dateKey)) return null;
  const start = new Date(`${dateKey}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/** 按日期（YYYY-MM-DD）取某一期的完整内容 */
export async function getIssueByDate(dateKey: string): Promise<SiteIssue | null> {
  const range = dayRange(dateKey);
  if (!range) return null;

  return withCache(`issue:${dateKey}`, async () => {
    try {
      const [article, run] = await Promise.all([
        // 直接按日期区间查这一期。以前是 findMany 把全部期数+推荐+仓库都拉出来
        // 再在内存里比对日期，期数一多就是白扔一堆数据。
        prisma.article.findFirst({
          where: { status: "published", weekStart: { gte: range.start, lt: range.end } },
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
      // 数据库不可用时落到静态包
    }
    return readStaticIssue(dateKey);
  });
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
