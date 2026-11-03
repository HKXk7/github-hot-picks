/**
 * 评测门禁：把「质量指标够不够好」变成一个是/非的判断，供 CI 用。
 *
 * 为什么要绝对阈值，而不只是「比上次差就红」：
 * 基线对比有个致命漏洞 —— 第一次跑的时候没有基线，跑得再烂也是绿的；
 * 而且只要基线被更新，质量就会一路棘轮下滑（每次都只比"上一次"，
 * 上一次已经变差了）。所以门禁以绝对阈值为主，基线对比只作为附加信号。
 *
 * 阈值刻意留了余量。样本量小的时候指标波动很大（8 个样本时
 * verifiedRate 抽风就能差 20 个点），阈值贴着实测值定只会制造噪音，
 * 而一个经常假红的门禁比没有门禁更糟 —— 它会训练你忽略红色。
 */
import type { GenerationMode } from "../tutorial/generate";
import type { RunSummary } from "./types";

export interface GateThresholds {
  /** 生成成功率下限：教程连 schema 校验都过不了就是硬失败 */
  minSuccessRate: number;
  /** 编造率上限（分母只算可查证的命令） */
  maxFabricationRate: number;
  /** 可验证率下限 */
  minVerifiedRate: number;
  /** 至少给出一条可验证命令的样本占比下限 */
  minCasesWithVerifiedCommand: number;
}

/**
 * 按模式分别设阈值。
 *
 * tools 是日更管线用的模式（会真的去查 README 和包管理器），标准定得高；
 * plain 是前端点一下马上出结果的模式，命令更多来自模型记忆，
 * 本来就更容易核验失败，用同一套阈值等于逼它去跟取证过的版本比，不合理。
 */
export const DEFAULT_THRESHOLDS: Record<GenerationMode, GateThresholds> = {
  tools: {
    minSuccessRate: 0.7,
    maxFabricationRate: 0.25,
    minVerifiedRate: 0.4,
    minCasesWithVerifiedCommand: 0.35,
  },
  plain: {
    minSuccessRate: 0.7,
    maxFabricationRate: 0.4,
    minVerifiedRate: 0.2,
    minCasesWithVerifiedCommand: 0.2,
  },
};

export interface GateCheck {
  mode: GenerationMode;
  metric: string;
  actual: number | null;
  threshold: number;
  /** 比较方向，打印时用（"≥" / "≤"） */
  op: ">=" | "<=";
  ok: boolean;
  /**
   * 小样本容差（比例型指标才有）。判定实际用的是 `threshold - tolerance`，
   * 阈值本身没被改低，只是承认「20 个样本估出来的比例本来就有 ±10 个点的误差」。
   */
  tolerance?: number;
  /**
   * 本次没有可查证的命令（全是 git clone / docker run），算不出比率。
   * 这种情况既不能说好也不能说坏，跳过而不是判红 —— 否则 registry
   * 网络一抽风就会误报。
   */
  skipped?: boolean;
}

export interface GateResult {
  passed: boolean;
  checks: GateCheck[];
  failures: string[];
}

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(0)}%`;
}

/**
 * 小样本容差：一个比例用 n 个样本估出来，标准误约 `sqrt(p(1-p)/n)`。
 *
 * 实测踩过：20 个样本时「有可验证命令的样本占比」35%，阈值也设的 35%，
 * 刚好压线通过；下一轮抽到 30% 就是纯抽样波动，却会让门禁变红。
 * 一个经常假红的门禁比没有门禁更糟 —— 它会训练人忽略红色。
 *
 * 所以判定改成 `实测 >= 阈值 - 1 个标准误`，配置里的阈值不动。
 * 样本越多容差越小（n=200 时约 3 个点），p 接近 0 或 1 时容差也趋近 0，
 * 于是「真正烂掉」和「一个可验证命令都给不出来」依然会被拦住。
 */
function sampleTolerance(observed: number, cases: number): number {
  if (cases <= 0) return 0;
  const p = Math.min(1, Math.max(0, observed));
  return Math.sqrt((p * (1 - p)) / cases);
}

/**
 * 从环境变量读阈值覆盖，形如
 * `{"tools":{"minVerifiedRate":0.5},"plain":{"maxFabricationRate":0.3}}`。
 *
 * 没有内置单价表是同一个道理：这些数字会随样本量、prompt、模型版本变，
 * 写死在代码里改一次就要动一次代码，配置驱动才能在不发版的情况下调。
 */
export function readThresholds(envValue: string | undefined): Record<GenerationMode, GateThresholds> {
  if (!envValue) return DEFAULT_THRESHOLDS;
  try {
    const parsed = JSON.parse(envValue) as Partial<Record<GenerationMode, Partial<GateThresholds>>>;
    const out = { ...DEFAULT_THRESHOLDS };
    for (const mode of Object.keys(out) as GenerationMode[]) {
      const patch = parsed[mode];
      if (patch) out[mode] = { ...out[mode], ...patch };
    }
    return out;
  } catch {
    // 配错了就用默认值，但必须让人看见：静默回退会让"我明明调了阈值"变成谜题
    console.warn(`⚠️ EVAL_GATE_JSON 不是合法 JSON，回退到默认阈值`);
    return DEFAULT_THRESHOLDS;
  }
}

/**
 * 对一轮评测的汇总结果套用门禁。
 *
 * 只看汇总而不看单条：单个项目失败是数据问题（比如某个仓库 README 是空的），
 * 一批里失败多少才是质量问题。
 */
export function applyGate(
  summaries: RunSummary[],
  thresholds: Record<GenerationMode, GateThresholds> = DEFAULT_THRESHOLDS,
): GateResult {
  const checks: GateCheck[] = [];

  for (const s of summaries) {
    const t = thresholds[s.mode] ?? DEFAULT_THRESHOLDS[s.mode];

    // 成功率 / 覆盖率的分母都是「样本数」，小样本波动大，按标准误留余量。
    // 编造率 / 可验证率的分母是「命令数」（通常几十上百），不需要这层容差。
    const successTol = sampleTolerance(s.successRate, s.cases);
    checks.push({
      mode: s.mode,
      metric: "生成成功率",
      actual: s.successRate,
      threshold: t.minSuccessRate,
      op: ">=",
      ok: s.successRate >= t.minSuccessRate - successTol,
      ...(successTol > 0 ? { tolerance: successTol } : {}),
    });

    // 编造率 / 可验证率在"没有可查证命令"时为 null —— 跳过，不判红也不判绿
    const noDecidable = s.fabricationRate === null || s.verifiedRate === null;

    checks.push({
      mode: s.mode,
      metric: "命令编造率",
      actual: s.fabricationRate,
      threshold: t.maxFabricationRate,
      op: "<=",
      ok: s.fabricationRate === null ? true : s.fabricationRate <= t.maxFabricationRate,
      ...(s.fabricationRate === null ? { skipped: true } : {}),
    });

    checks.push({
      mode: s.mode,
      metric: "命令可验证率",
      actual: s.verifiedRate,
      threshold: t.minVerifiedRate,
      op: ">=",
      ok: s.verifiedRate === null ? true : s.verifiedRate >= t.minVerifiedRate,
      ...(s.verifiedRate === null ? { skipped: true } : {}),
    });

    const coverageTol = sampleTolerance(s.casesWithVerifiedCommand, s.cases);
    checks.push({
      mode: s.mode,
      metric: "有可验证命令的样本占比",
      actual: s.casesWithVerifiedCommand,
      threshold: t.minCasesWithVerifiedCommand,
      op: ">=",
      ok: s.casesWithVerifiedCommand >= t.minCasesWithVerifiedCommand - coverageTol,
      ...(coverageTol > 0 ? { tolerance: coverageTol } : {}),
    });

    if (noDecidable) {
      console.log(`ℹ️ [${s.mode}] 本次没有任何可查证的安装命令，编造率/可验证率两项跳过判定`);
    }
  }

  const failures = checks
    .filter((c) => !c.ok)
    .map((c) => {
      const floor = c.tolerance ? pct(c.threshold - c.tolerance) : pct(c.threshold);
      return `[${c.mode}] ${c.metric} ${pct(c.actual)} ${c.op === ">=" ? "低于" : "高于"} 阈值 ${floor}${c.tolerance ? `（配置 ${pct(c.threshold)}，已含 ${pct(c.tolerance)} 小样本容差）` : ""}`;
    });

  return { passed: failures.length === 0, checks, failures };
}

/** 把门禁结果打印成表格，终端和 CI 摘要都用它 */
export function formatGate(gate: GateResult): string {
  const lines = ["| 模式 | 指标 | 实测 | 阈值 | 结果 |", "|------|------|------|------|------|"];
  for (const c of gate.checks) {
    const verdict = c.skipped ? "跳过（无可查证命令）" : c.ok ? "✅" : "❌";
    const threshold = c.tolerance
      ? `${c.op} ${pct(c.threshold - c.tolerance)}（容差 ${pct(c.tolerance)}）`
      : `${c.op} ${pct(c.threshold)}`;
    lines.push(`| ${c.mode} | ${c.metric} | ${pct(c.actual)} | ${threshold} | ${verdict} |`);
  }
  return lines.join("\n");
}
