/**
 * 用量汇总：把一堆 LlmCall 记录算成「花了多少、时间花在哪」。
 *
 * 抽出来是为了让终端报告和网页看板用同一套口径 ——
 * 两边各算一遍的话，迟早会出现「网页说 3 块、命令行说 5 块」这种
 * 谁都没错、但没人知道该信谁的场面。
 *
 * 这里是纯函数：输入行数组，输出统计结果。不碰数据库，所以能单测。
 */

/** LlmCall 里汇总需要的字段（刻意不直接依赖 Prisma 类型，方便测试里造假数据） */
export interface UsageRow {
  traceId: string;
  kind: string;
  label: string | null;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costCny: number | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  createdAt: Date;
}

export interface GroupStat {
  key: string;
  calls: number;
  tokens: number;
  cost: number;
  ms: number;
}

export interface UsageStats {
  calls: number;
  ok: number;
  failed: number;
  successRate: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  /** 有没有配单价表：没配时只报 token，不编造金额 */
  hasCost: boolean;
  totalMs: number;
  p50Ms: number;
  p95Ms: number;
  byKind: GroupStat[];
  byModel: GroupStat[];
  byLabel: GroupStat[];
  byTrace: GroupStat[];
  failures: { at: string; model: string; error: string }[];
}

/** 分位数：样本少的时候不插值，直接取最近的那个 */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

function bump(map: Map<string, GroupStat>, key: string, r: UsageRow): void {
  const cur = map.get(key) ?? { key, calls: 0, tokens: 0, cost: 0, ms: 0 };
  cur.calls += 1;
  cur.tokens += r.totalTokens;
  cur.cost += r.costCny ?? 0;
  cur.ms += r.latencyMs;
  map.set(key, cur);
}

function sortedGroups(map: Map<string, GroupStat>, by: "ms" | "tokens"): GroupStat[] {
  return [...map.values()].sort((a, b) => (by === "ms" ? b.ms - a.ms : b.tokens - a.tokens));
}

export function summarizeUsage(rows: UsageRow[]): UsageStats {
  const byKind = new Map<string, GroupStat>();
  const byModel = new Map<string, GroupStat>();
  const byLabel = new Map<string, GroupStat>();
  const byTrace = new Map<string, GroupStat>();

  for (const r of rows) {
    bump(byKind, r.kind, r);
    bump(byModel, r.model, r);
    bump(byTrace, r.traceId, r);
    // 步骤名只在 tools 模式下有，plain 模式整轮就一次调用，统计它没意义
    if (r.label) bump(byLabel, r.label, r);
  }

  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  const failed = rows.filter((r) => !r.ok);

  return {
    calls: rows.length,
    ok: rows.length - failed.length,
    failed: failed.length,
    // 一次调用都没有时给 1 而不是 0：空数据集显示「成功率 0%」会被误读成全挂了
    successRate: rows.length === 0 ? 1 : (rows.length - failed.length) / rows.length,
    promptTokens: rows.reduce((s, r) => s + r.promptTokens, 0),
    completionTokens: rows.reduce((s, r) => s + r.completionTokens, 0),
    totalTokens: rows.reduce((s, r) => s + r.totalTokens, 0),
    cost: rows.reduce((s, r) => s + (r.costCny ?? 0), 0),
    hasCost: rows.some((r) => r.costCny !== null),
    totalMs: rows.reduce((s, r) => s + r.latencyMs, 0),
    p50Ms: quantile(latencies, 0.5),
    p95Ms: quantile(latencies, 0.95),
    byKind: sortedGroups(byKind, "ms"),
    byModel: sortedGroups(byModel, "tokens"),
    byLabel: sortedGroups(byLabel, "ms"),
    byTrace: sortedGroups(byTrace, "tokens"),
    failures: failed
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 5)
      .map((r) => ({ at: r.createdAt.toISOString().slice(0, 19).replace("T", " "), model: r.model, error: r.error ?? "" })),
  };
}
