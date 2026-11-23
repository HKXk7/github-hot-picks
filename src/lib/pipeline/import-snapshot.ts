/**
 * 把一份「静态数据包快照」写进数据库。
 *
 * 快照有两种形状，字段是一样的：`public/data/latest.json`（最新一期）和
 * `public/data/issues/<date>.json`（某一期）。两个入口都用这个函数：
 *   - `scripts/import-snapshot.ts`：手工导入单个文件（CI 首次跑也用它灌上一期）
 *   - `scripts/sync-cloud.ts`：把云端整包拉下来后逐期导入（本机追平线上）
 *
 * 为什么抽出来：这段逻辑以前直接写在脚本里，想「按文件导入」就得复制一遍 upsert，
 * 两边一旦走偏（比如一处忘了重建推荐关系），页面会静默少几个项目而不是报错。
 *
 * 注意 githubId：快照里没有真实 id，只能用全名哈希顶上（该字段非空且唯一）。
 * 所以**匹配一律用 fullName**，拿哈希值当主键会和 GitHub 真实 id 错位。
 */
import type { PrismaClient } from "../../../generated/prisma/client";

export interface SnapshotPick {
  rank: number;
  fullName: string;
  name: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  forks?: number;
  category?: string;
  reason?: string;
  tutorial?: string | null;
}

export interface SnapshotLike {
  issue: number;
  title: string;
  content: string;
  /** YYYY-MM-DD（北京时间）。老快照可能没这个字段，导入时会忽略它 */
  dateKey?: string;
  updatedAt?: string;
  picks: SnapshotPick[];
}

export interface ImportResult {
  issue: number;
  title: string;
  picks: number;
  /** 快照里有、但库里建不出推荐关系的项目（正常不该有） */
  missing: string[];
}

export function hashToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export async function importSnapshot(
  db: PrismaClient,
  snap: SnapshotLike,
  log: (msg: string) => void = () => {},
): Promise<ImportResult> {
  if (!snap?.picks?.length) {
    throw new Error(`第 ${snap?.issue ?? "?"} 期快照里没有 picks，无法导入`);
  }

  // 1. Repository：更新 / 新建
  for (const pick of snap.picks) {
    await db.repository.upsert({
      where: { fullName: pick.fullName },
      update: {
        name: pick.name,
        description: pick.description ?? null,
        url: pick.url,
        language: pick.language ?? null,
        stars: pick.stars,
        forks: pick.forks ?? 0,
        fetchedAt: new Date(),
        // 快照里没教程就别把库里已有的教程清掉
        ...(pick.tutorial ? { tutorial: pick.tutorial } : {}),
      },
      create: {
        githubId: hashToInt(pick.fullName),
        name: pick.name,
        fullName: pick.fullName,
        description: pick.description ?? null,
        url: pick.url,
        language: pick.language ?? null,
        stars: pick.stars,
        forks: pick.forks ?? 0,
        fetchedAt: new Date(),
        tutorial: pick.tutorial ?? null,
      },
    });
  }
  log(`  ✅ ${snap.picks.length} 个项目`);

  // 2. Article：按 issue upsert（同一天重跑覆盖而不是追加）
  const at = snap.updatedAt ? new Date(snap.updatedAt) : new Date();
  const article = await db.article.upsert({
    where: { issue: snap.issue },
    update: {
      title: snap.title,
      content: snap.content,
      status: "published",
      publishedAt: at,
      weekStart: at,
    },
    create: {
      issue: snap.issue,
      title: snap.title,
      content: snap.content,
      status: "published",
      weekStart: at,
      publishedAt: at,
    },
  });
  log(`  📝 Article #${article.issue}「${article.title}」`);

  // 3. 推荐关系：整期重建，避免改稿后残留旧关系
  await db.recommendation.deleteMany({ where: { articleId: article.id } });
  const missing: string[] = [];
  for (const pick of snap.picks) {
    const repo = await db.repository.findUnique({ where: { fullName: pick.fullName } });
    if (!repo) {
      missing.push(pick.fullName);
      continue;
    }
    await db.recommendation.create({
      data: {
        articleId: article.id,
        repositoryId: repo.id,
        reason: pick.reason ?? "暂无",
        category: pick.category ?? "其他",
        sortOrder: pick.rank,
      },
    });
  }
  if (missing.length) log(`  ⚠️ 找不到这些项目，跳过推荐关系：${missing.join("、")}`);

  return { issue: snap.issue, title: snap.title, picks: snap.picks.length, missing };
}