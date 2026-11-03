/**
 * 静态站点数据包。
 *
 * 光有 `latest.json` 不够：部署环境没有数据库时，首页能靠它兜底，
 * 但「往期推荐」列表和每一期的详情会全空 —— 站点看起来像坏了。
 * 所以日更再写两份东西：
 *   - `history.json`：所有期的索引（列表页用）
 *   - `issues/<dateKey>.json`：每一期的完整内容（详情页用）
 *
 * 为什么不每次现查数据库：线上那份代码不一定带得进来 SQLite，
 * 而推荐数据本来就是一天一变的静态结果，写成文件最省事也最稳。
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface HistoryEntry {
  issue: number;
  dateKey: string;
  dateLabel: string;
  title: string;
  pickCount: number;
  totalStars: number;
  updatedAt: string;
}

/** 快照的最小形状，够算出列表项就行 */
export interface StaticIssueInput {
  issue: number;
  title: string;
  dateKey: string;
  updatedAt: string;
  totalStars: number;
  picks: unknown[];
}

/** 用 dateKey 直接拼，别依赖服务器时区（CI 跑在 UTC，中国日期会差一天） */
export function formatDateLabel(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/**
 * 把本期并进历史索引：同一天重跑要覆盖而不是追加，整体按日期倒序。
 * 纯函数，专门拎出来单测 —— 索引重复或顺序错了不会报错，只会让往期页 quietly 变别扭。
 */
export function upsertHistory(existing: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  return [entry, ...existing.filter((h) => h.dateKey !== entry.dateKey)].sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey),
  );
}

export async function writeStaticSiteData(
  outDir: string,
  snapshot: StaticIssueInput,
  logger: (msg: string) => void = () => {},
): Promise<{ historyCount: number; dateKey: string }> {
  const historyPath = path.join(outDir, "history.json");
  let history: HistoryEntry[] = [];
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(historyPath, "utf8"));
    if (Array.isArray(parsed)) history = parsed as HistoryEntry[];
  } catch {
    // 第一次跑、或文件坏了：从空索引重新累积，不让一期的索引问题挡住出稿
  }

  const entry: HistoryEntry = {
    issue: snapshot.issue,
    dateKey: snapshot.dateKey,
    dateLabel: formatDateLabel(snapshot.dateKey),
    title: snapshot.title,
    pickCount: snapshot.picks.length,
    totalStars: snapshot.totalStars,
    updatedAt: snapshot.updatedAt,
  };
  const next = upsertHistory(history, entry);

  await fs.mkdir(path.join(outDir, "issues"), { recursive: true });
  await fs.writeFile(historyPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  // 存的就是站点直接消费的形状，读的时候不用再组装一遍
  await fs.writeFile(
    path.join(outDir, "issues", `${snapshot.dateKey}.json`),
    JSON.stringify({ ...snapshot, source: "snapshot", dateLabel: entry.dateLabel }, null, 2) + "\n",
    "utf8",
  );
  logger(`   静态包：history.json（${next.length} 期）+ issues/${snapshot.dateKey}.json`);
  return { historyCount: next.length, dateKey: snapshot.dateKey };
}
