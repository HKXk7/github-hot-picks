/**
 * 一次性回填静态站点数据包。
 *
 * 日更任务从今天起会增量维护 `history.json` 和 `issues/*.json`，
 * 但历史上已经跑过的那些期只存在于数据库里。部署前跑一次本脚本，
 * 把它们导出来，线上才不会只有「今天」一页往期。
 *
 * 用法：npm run data:static
 *
 * 复用 site-data 的读函数而不是自己拼一遍 Prisma 查询：站点展示口径
 * （排序、摘要、教程 Markdown 转换、取证痕迹）只应该有一份实现。
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getIssueList, getIssueByDate } from "../src/lib/site-data";
import { prisma } from "../src/lib/prisma";
import { upsertHistory, formatDateLabel, type HistoryEntry } from "../src/lib/pipeline/static-data";

const OUT = path.join(process.cwd(), "public", "data");

async function main(): Promise<void> {
  await fs.mkdir(path.join(OUT, "issues"), { recursive: true });

  const list = await getIssueList();
  let history: HistoryEntry[] = [];
  let written = 0;

  for (const item of list) {
    const issue = await getIssueByDate(item.dateKey);
    if (!issue) continue;
    await fs.writeFile(
      path.join(OUT, "issues", `${item.dateKey}.json`),
      JSON.stringify({ ...issue, source: "snapshot" }, null, 2) + "\n",
      "utf8",
    );
    history = upsertHistory(history, { ...item, dateLabel: formatDateLabel(item.dateKey) });
    written++;
  }

  // 数据库可能落后于仓库快照（CI 的库是缓存恢复的，不一定每天都有）。
  // 最新一期无论如何都要有：直接从 latest.json 补一份，保证首页和详情页对得上。
  try {
    const latest = JSON.parse(await fs.readFile(path.join(OUT, "latest.json"), "utf8")) as {
      issue: number;
      title: string;
      dateKey: string;
      updatedAt: string;
      totalStars: number;
      picks: unknown[];
    };
    if (latest?.dateKey && latest.picks?.length) {
      await fs.writeFile(
        path.join(OUT, "issues", `${latest.dateKey}.json`),
        JSON.stringify(
          { ...latest, source: "snapshot", dateLabel: formatDateLabel(latest.dateKey) },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      history = upsertHistory(history, {
        issue: latest.issue,
        dateKey: latest.dateKey,
        dateLabel: formatDateLabel(latest.dateKey),
        title: latest.title,
        pickCount: latest.picks.length,
        totalStars: latest.totalStars,
        updatedAt: latest.updatedAt,
      });
    }
  } catch {
    console.warn("⚠️ 没读到 latest.json，只导出了数据库里的期");
  }

  await fs.writeFile(path.join(OUT, "history.json"), JSON.stringify(history, null, 2) + "\n", "utf8");
  console.log(`✅ 静态包就绪：${written} 期来自数据库，history.json 共 ${history.length} 期`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
