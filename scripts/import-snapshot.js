/**
 * 把 public/data/latest.json 的快照数据同步到本地 SQLite 数据库。
 * 解决：种子数据是占位稿，但 snapshot 里有完整数据，DB 优先读就会看到空稿。
 */
const { PrismaClient } = require("../generated/prisma/client");
const fs = require("fs");
const path = require("path");

const SNAPSHOT = path.join(__dirname, "..", "public", "data", "latest.json");

async function main() {
  const raw = fs.readFileSync(SNAPSHOT, "utf8");
  const snap = JSON.parse(raw);

  if (!snap?.picks?.length) {
    console.error("❌ snapshot 里没有 picks，无法导入");
    process.exit(1);
  }

  const prisma = new PrismaClient();

  // 1. 导入/更新 Repository
  for (const pick of snap.picks) {
    const githubId = hashToInt(pick.fullName); // 快照里没有 githubId，用全名哈希代替
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
        tutorial: pick.tutorial ?? null,
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

  // 2. 导入/更新 Article（覆盖种子数据的占位稿）
  const article = await prisma.article.upsert({
    where: { issue: snap.issue },
    update: {
      title: snap.title,
      content: snap.content,
      status: "published",
      publishedAt: new Date(snap.updatedAt),
      weekStart: new Date(snap.updatedAt),
    },
    create: {
      issue: snap.issue,
      title: snap.title,
      content: snap.content,
      status: "published",
      weekStart: new Date(snap.updatedAt),
      publishedAt: new Date(snap.updatedAt),
    },
  });

  console.log(`  📝 Article #${article.issue}: "${article.title}" status=${article.status}`);

  // 3. 重建推荐关系
  await prisma.recommendation.deleteMany({ where: { articleId: article.id } });
  for (let i = 0; i < snap.picks.length; i++) {
    const pick = snap.picks[i];
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

function hashToInt(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

main().catch((e) => {
  console.error("失败：", e);
  process.exit(1);
});