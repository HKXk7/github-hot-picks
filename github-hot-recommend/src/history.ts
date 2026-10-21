import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getRecommendedFullNames } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const historyPath = join(dataDir, "recommended.json");

// 读取「历史已推荐」的全部 full_name，供跨期去重用。
// 两个来源取并集：已提交的 recommended.json（CI 跨周存档）+ 本地 DB（兼容既有历史）。
export function readRecommendedNames(excludeWeek: string): Set<string> {
  const names = new Set<string>();

  // 1) 从 JSON 历史读（跳过本周自身，保证重复跑同一周时结果幂等）
  if (existsSync(historyPath)) {
    try {
      const data = JSON.parse(readFileSync(historyPath, "utf8")) as Record<
        string,
        string[]
      >;
      for (const [week, list] of Object.entries(data)) {
        if (week === excludeWeek) continue;
        for (const n of list) names.add(n);
      }
    } catch {
      // JSON 损坏时忽略，继续用 DB 兜底
    }
  }

  // 2) 从本地 DB 读（兼容 JSON 尚未生成、但 DB 已有历史的情况）
  for (const n of getRecommendedFullNames(excludeWeek)) names.add(n);

  return names;
}

// 把本周推荐写回 JSON（既是存档，也是下次去重的依据）
export function recordRecommended(week: string, fullNames: string[]): void {
  mkdirSync(dataDir, { recursive: true });
  const data = existsSync(historyPath)
    ? (JSON.parse(readFileSync(historyPath, "utf8")) as Record<string, string[]>)
    : {};
  data[week] = fullNames;
  writeFileSync(historyPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
