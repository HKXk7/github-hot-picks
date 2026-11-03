/**
 * 比例的 Wilson 置信区间。
 *
 * 评测报告只写一个「35%」是不够的：20 个样本和 200 个样本给出的 35%，
 * 可信程度差了一个数量级。把区间一起打出来，读者才知道这个数字能不能
 * 拿去下结论 —— 也正好解释门禁为什么要按样本量留容差。
 *
 * 用 Wilson 而不是「p ± 1.96√(p(1-p)/n)」：后者在 p 接近 0 或 1、
 * 样本又少时会算出负数或大于 1 的区间，Wilson 不会。
 */
export interface ConfidenceInterval {
  low: number;
  high: number;
}

/** z 默认 1.96（双侧 95%）； successes / total 都要是合法非负数 */
export function wilsonInterval(successes: number, total: number, z = 1.96): ConfidenceInterval {
  if (total <= 0) return { low: 0, high: 0 };
  const p = successes / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

export function formatInterval(ci: ConfidenceInterval): string {
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  return `[${pct(ci.low)}, ${pct(ci.high)}]`;
}

/**
 * 从一轮汇总算出三个关键比例的置信区间。
 *
 * 编造率 / 可验证率的分母是「可查证命令数」（verified + fabricated），
 * 没查证到任何命令时返回 null —— 和汇总里的口径保持一致，别自己另算一套。
 */
export function summaryIntervals(s: {
  cases: number;
  generated: number;
  totalVerified: number;
  totalFabricated: number;
}): { successRate: ConfidenceInterval; verifiedRate: ConfidenceInterval | null; fabricationRate: ConfidenceInterval | null } {
  const decidable = s.totalVerified + s.totalFabricated;
  return {
    successRate: wilsonInterval(s.generated, s.cases),
    verifiedRate: decidable > 0 ? wilsonInterval(s.totalVerified, decidable) : null,
    fabricationRate: decidable > 0 ? wilsonInterval(s.totalFabricated, decidable) : null,
  };
}
