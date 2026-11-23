/**
 * 把一份快照写进 SQLite。逻辑在 src/lib/pipeline/import-snapshot.ts，
 * 这里只负责「读哪个文件 + 连库 + 打印」。
 *
 * 用法：
 *   npm run db:import                                  # 默认读 public/data/latest.json
 *   npx tsx scripts/import-snapshot.ts <快照路径>       # 指定文件（如 issues/2026-11-09.json）
 *
 * 三个使用场景：
 * 1. 本机种子数据是占位稿，而快照里有完整内容，DB 优先读就会看到空稿；
 * 2. 本机库和云端不是同一条历史（期号、去重名单都不一样），把云端那套快照拉下来
 *    逐个导入，本地页面才和线上对得上（整包同步用 `npm run sync:cloud`）；
 * 3. CI 里数据库是新库（历史库靠缓存恢复），首次运行时把仓库里的快照灌回去，
 *    这样期号能接着走、上一期项目也进得了去重名单。
 *
 * ⚠️ 必须用 tsx 跑，不能用 node：Prisma 生成器输出的是 generated/prisma/client.ts，
 * 纯 Node 的 require 解析不了 .ts 后缀，会报 Cannot find module。
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/prisma/client";
import { importSnapshot, type SnapshotLike } from "../src/lib/pipeline/import-snapshot";

const SNAPSHOT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), "public", "data", "latest.json");

async function main() {
  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as SnapshotLike;
  console.log(`📄 ${path.relative(process.cwd(), SNAPSHOT)}`);

  const prisma = new PrismaClient();
  try {
    const result = await importSnapshot(prisma, snap, (m) => console.log(m));
    console.log(
      `\n✅ 数据库已同步快照（第 ${result.issue} 期，${result.picks} 个项目${result.missing.length ? `，${result.missing.length} 个缺库记录` : ""}）`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("失败：", e instanceof Error ? e.message : e);
  process.exit(1);
});