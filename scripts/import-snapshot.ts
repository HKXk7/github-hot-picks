/**
 * 把 public/data/latest.json 的快照数据同步进 SQLite。
 *
 * 用法：npm run db:import
 *
 * 两个使用场景：
 * 1. 本机种子数据是占位稿，而快照里有完整内容，DB 优先读就会看到空稿；
 * 2. CI 里数据库是新库（历史库靠缓存恢复），首次运行时把仓库里的快照灌回去，
 *    这样期号能接着走、上一期项目也进得了去重名单。
 *
 * ⚠️ 必须用 tsx 跑，不能用 node：新 prnova 生成器输出的是 generated/prisma/client.ts，
 * 纯 Node 的 require 解析不了 .ts 后缀，会报 Cannot find module。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/prisma/client";

const SNAPSHOT = path.join(process.cwd(), "public", "data", "latest.json");

interface Pick {
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

async function main() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as {
    issue: number;
    title: string;
    content: string;
    updatedAt?: string;
    picks: Pick[];
  };

  if (!snap?.picks?.length) {
    throw new Error("snapshot 里没有 picks，无法导入");
  }

  const prisma = new PrismaClient();

  // 1. 导入 / 更新 Repository
  for (const pick of snap.picks) {
    // 快照里没有 githubId，用全名哈希代替，保证跨次运行稳定
    const githubId = hashToInt(pick.fullName);
    await prisma.repository.upsert({
      where: { githubId },
      update: {
        name: pick.name,
        description: pick.description ?? null,
        url: pick.url,
        language: pick.language ?? null,
        stars: pick.stars,
        forks: pick.forks ?? 0,
        fetchedAt: new Date(),
        ...(pick.tutorial ? { tutorial: pick.tutorial } : {}),
      },
      create: {
        githubId,
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
    console.log(`  ✅ ${pick.fullName} (tutorial: ${pick.tutorial ? "有" : "无"})`);
  }

  // 2. 导入 / 更新 Article（覆盖种子数据的占位稿）
  const at = snap.updatedAt ? new Date(snap.updatedAt) : new Date();
  const article = await prisma.article.upsert({
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
  console.log(`  📝 Article #${article.issue}: "${article.title}" status=${article.status}`);

  // 3. 重建推荐关系
  await prisma.recommendation.deleteMany({ where: { articleId: article.id } });
  for (const pick of snap.picks) {
    const repo = await prisma.repository.findUnique({ where: { fullName: pick.fullName } });
    if (!repo) {
      console.warn(`  ⚠️ 找不到 ${pick.fullName}，跳过推荐关系`);
      continue;
    }
    await prisma.recommendation.create({
      data: {
        articleId: article.id,
        repositoryId: repo.id,
        reason: pick.reason ?? "暂无",
        category: pick.category ?? "其他",
        sortOrder: pick.rank,
      },
    });
  }

  console.log(`\n✅ 数据库已同步 snapshot 数据（第 ${snap.issue} 期，${snap.picks.length} 个项目）`);
  await prisma.$disconnect();
}

function hashToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

main().catch((e) => {
  console.error("失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});
