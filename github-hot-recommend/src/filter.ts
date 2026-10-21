import type { GithubRepo, ScoredRepo } from "./types";

const TOP_N = 10;

// 距今多少天（无日期视为很久以前）
function daysSince(dateStr: string | null): number {
  if (!dateStr) return 999;
  return (Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000);
}

// 给单个仓库打分：分数越高越值得推荐
export function scoreRepo(repo: GithubRepo): ScoredRepo {
  const reasons: string[] = [];
  let score = 0;

  // 核心指标：star 数（取对数，避免被头部项目碾压）
  score += Math.log10(repo.stargazers_count + 1) * 4;

  // 最近仍在更新 → 说明活跃
  if (daysSince(repo.pushed_at) <= 14) {
    score += 2;
    reasons.push("最近仍在活跃更新");
  }

  // 有完整简介（质量信号）
  if (repo.description && repo.description.length > 10) {
    score += 1.5;
  } else {
    score -= 1;
  }

  // 有官网
  if (repo.homepage) {
    score += 1;
    reasons.push("有完整官网");
  }

  // 标签完善
  if (repo.topics.length >= 3) {
    score += 1;
  }

  // 有主语言
  if (repo.language) {
    score += 0.5;
  }

  // 越新越有「黑马」感
  const age = daysSince(repo.created_at);
  if (age <= 7) score += 2;
  else if (age <= 30) score += 1;

  // 新项目但 star 很多 = 爆发式增长
  if (repo.stargazers_count >= 500) {
    score += 2;
    reasons.push("短时间收获大量 star");
  }

  return { ...repo, score: Math.round(score * 10) / 10, reasons };
}

// 过滤 + 打分 + 排序 + 作者去重 + 历史去重，返回 top N
export function filterTop(
  repos: GithubRepo[],
  n = TOP_N,
  exclude: Set<string> = new Set(),
): ScoredRepo[] {
  const seenOwner = new Set<string>();
  return repos
    .filter((r) => !r.fork && !r.archived)
    .filter((r) => !exclude.has(r.full_name)) // 历史去重：排除往期已推荐的项目
    .map(scoreRepo)
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      // 每位作者最多推荐一个项目，避免同一作者的系列项目霸榜
      if (seenOwner.has(r.owner)) return false;
      seenOwner.add(r.owner);
      return true;
    })
    .slice(0, n);
}
