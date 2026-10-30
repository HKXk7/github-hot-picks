import { generateStructuredTutorial, type GenerationMode, type TutorialMeta } from "../tutorial/generate";
import type { Tutorial } from "../tutorial/schema";
import { checkCommand } from "./scorers";
import { judgeTutorial, summarizeJudge } from "./judge";
import type { CaseMetrics, CaseResult, CommandCheck, EvalCase, RunSummary } from "./types";

export interface EvalOptions {
  mode: GenerationMode;
  maxAttempts?: number;
  /** 是否启用 LLM-as-judge（多一次模型调用，默认关） */
  useJudge?: boolean;
  log?: (msg: string) => void;
}

function toMeta(c: EvalCase): TutorialMeta {
  return {
    fullName: c.fullName,
    description: c.description,
    language: c.language,
    stars: c.stars,
    topics: c.topics,
    homepage: c.homepage,
  };
}

/** 一个 case + 一种模式，跑一次生成并打分 */
async function evaluateOne(c: EvalCase, opts: EvalOptions): Promise<CaseResult> {
  const started = Date.now();
  const res = await generateStructuredTutorial(toMeta(c), {
    mode: opts.mode,
    maxAttempts: opts.maxAttempts ?? 2,
  });
  const ms = Date.now() - started;

  if (!res.tutorial) {
    return {
      fullName: c.fullName,
      mode: opts.mode,
      generated: false,
      attempts: res.attempts,
      ms,
      toolCalls: res.toolCalls?.length ?? 0,
      tutorial: null,
      checks: [],
      error: res.error,
    };
  }

  // 命令验证是并发的：一个仓库常有三四条命令，串行跑会让整轮评测慢好几倍
  const nested = await Promise.all(res.tutorial.installCommands.map((cmd) => checkCommand(cmd)));
  const checks: CommandCheck[] = nested.flat();

  return {
    fullName: c.fullName,
    mode: opts.mode,
    generated: true,
    attempts: res.attempts,
    ms,
    toolCalls: res.toolCalls?.length ?? 0,
    tutorial: res.tutorial,
    checks,
  };
}

function countVerdicts(checks: CommandCheck[]) {
  const tally = { verified: 0, fabricated: 0, unverifiable: 0, errored: 0 };
  for (const c of checks) {
    if (c.verdict === "verified") tally.verified++;
    else if (c.verdict === "fabricated") tally.fabricated++;
    else if (c.verdict === "unverifiable") tally.unverifiable++;
    else tally.errored++;
  }
  return tally;
}

/**
 * 编造率只在「查得出来」的那部分命令里算分母。
 * 拿 git clone / make 这种无法查证的命令去稀释分母，会让指标看起来虚好看。
 */
function rates(t: { verified: number; fabricated: number }) {
  const decidable = t.verified + t.fabricated;
  if (decidable === 0) return { fabricationRate: null, verifiedRate: null };
  return {
    fabricationRate: t.fabricated / decidable,
    verifiedRate: t.verified / decidable,
  };
}

async function toMetrics(result: CaseResult, useJudge: boolean, meta: EvalCase): Promise<CaseMetrics> {
  const t = countVerdicts(result.checks);
  const { fabricationRate, verifiedRate } = rates(t);
  const tutorial: Tutorial | null = result.tutorial;

  return {
    fullName: result.fullName,
    mode: result.mode,
    generated: result.generated,
    attempts: result.attempts,
    ms: result.ms,
    toolCalls: result.toolCalls,
    commands: result.checks.length,
    verified: t.verified,
    fabricated: t.fabricated,
    unverifiable: t.unverifiable,
    errored: t.errored,
    confidence: tutorial?.confidence ?? "-",
    missingInfo: tutorial?.missingInfo.length ?? 0,
    fabricationRate,
    verifiedRate,
    judge: tutorial && useJudge ? (await judgeTutorial(meta, tutorial)) ?? undefined : undefined,
    error: result.error,
  };
}

export function summarize(mode: GenerationMode, metrics: CaseMetrics[]): RunSummary {
  const n = metrics.length || 1;
  const generated = metrics.filter((m) => m.generated).length;
  const totals = metrics.reduce(
    (a, m) => ({
      verified: a.verified + m.verified,
      fabricated: a.fabricated + m.fabricated,
      unverifiable: a.unverifiable + m.unverifiable,
      commands: a.commands + m.commands,
      missing: a.missing + m.missingInfo,
      attempts: a.attempts + m.attempts,
      tools: a.tools + m.toolCalls,
      ms: a.ms + m.ms,
    }),
    { verified: 0, fabricated: 0, unverifiable: 0, commands: 0, missing: 0, attempts: 0, tools: 0, ms: 0 },
  );
  const { fabricationRate, verifiedRate } = rates(totals);
  const judgeSummary = summarizeJudge(metrics);

  return {
    mode,
    cases: metrics.length,
    generated,
    successRate: generated / n,
    avgCommands: totals.commands / n,
    totalVerified: totals.verified,
    totalFabricated: totals.fabricated,
    totalUnverifiable: totals.unverifiable,
    fabricationRate,
    verifiedRate,
    casesWithVerifiedCommand: metrics.filter((m) => m.verified > 0).length / n,
    avgMissingInfo: totals.missing / n,
    avgAttempts: totals.attempts / n,
    avgToolCalls: totals.tools / n,
    avgMs: totals.ms / n,
    avgJudgeGroundedness: judgeSummary.groundedness,
    avgJudgeUsefulness: judgeSummary.usefulness,
  };
}

export async function runEvaluation(cases: EvalCase[], opts: EvalOptions): Promise<CaseMetrics[]> {
  const log = opts.log ?? (() => {});
  const out: CaseMetrics[] = [];

  for (const c of cases) {
    log(`▶ ${c.fullName}（${c.language ?? "?"}）`);
    const result = await evaluateOne(c, opts);
    const m = await toMetrics(result, opts.useJudge ?? false, c);

    if (!m.generated) {
      log(`   ❌ 生成失败：${m.error ?? "未知"}`);
    } else {
      const flags = [
        `命令 ${m.commands}`,
        `可验证 ${m.verified}`,
        `编造 ${m.fabricated}`,
        `不可查证 ${m.unverifiable}`,
        `conf=${m.confidence}`,
        `${(m.ms / 1000).toFixed(1)}s`,
      ];
      log(`   ${flags.join(" | ")}`);
      for (const chk of result.checks.filter((x) => x.verdict === "fabricated")) {
        log(`      ⚠️ 编造命令：${chk.command} —— ${chk.detail}`);
      }
    }
    out.push(m);
  }

  return out;
}

/**
 * 与基线对比，找出退化项。
 * 只挑会真正伤害用户的指标：生成成功率、编造率、可用性。
 */
export function diffAgainstBaseline(current: RunSummary, baseline: RunSummary | undefined): string[] {
  if (!baseline) return [];
  const regressions: string[] = [];

  if (current.successRate < baseline.successRate - 0.001) {
    regressions.push(
      `生成成功率下降：${(baseline.successRate * 100).toFixed(0)}% → ${(current.successRate * 100).toFixed(0)}%`,
    );
  }
  if (current.fabricationRate !== null && baseline.fabricationRate !== null && current.fabricationRate > baseline.fabricationRate + 0.001) {
    regressions.push(
      `命令编造率上升：${(baseline.fabricationRate * 100).toFixed(0)}% → ${(current.fabricationRate * 100).toFixed(0)}%`,
    );
  }
  if (current.casesWithVerifiedCommand < baseline.casesWithVerifiedCommand - 0.001) {
    regressions.push(
      `给出可验证命令的样本占比下降：${(baseline.casesWithVerifiedCommand * 100).toFixed(0)}% → ${(current.casesWithVerifiedCommand * 100).toFixed(0)}%`,
    );
  }
  if (current.verifiedRate !== null && baseline.verifiedRate !== null && current.verifiedRate < baseline.verifiedRate - 0.001) {
    regressions.push(
      `命令可验证率下降：${(baseline.verifiedRate * 100).toFixed(0)}% → ${(current.verifiedRate * 100).toFixed(0)}%`,
    );
  }

  return regressions;
}
