/**
 * 跑一轮教程质量评测。
 *
 * 用法：
 *   npm run eval                          # 默认 8 个样本，tools / plain 两版对照
 *   npm run eval -- --limit 6 --mode tools
 *   npm run eval -- --judge                # 额外让另一个模型给质量打分
 *   npm run eval -- --gate                 # 出现指标退化时以非零码退出（CI 用）
 *
 * 和早期那版 eval-compare 的区别：不再只看「生成成功 / 命令条数」这种表面数字，
 * 而是把每条安装命令拿去真实的 npm / PyPI / crates.io 上核包名，
 * 从而得出「有多少命令是模型编的」这个硬指标。
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { runEvaluation, summarize, diffAgainstBaseline } from "../src/lib/eval/run";
import type { EvalCase, EvalRun, RunSummary } from "../src/lib/eval/types";
import type { GenerationMode } from "../src/lib/tutorial/generate";

/** both = 一次跑两版做对照；也可以只跑其中一种 */
type Mode = GenerationMode;

// ================= 参数 =================
function readArgs() {
  const args = process.argv.slice(2);
  const value = (key: string, fallback: string) => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit ? hit.slice(key.length + 3) : fallback;
  };
  return {
    limit: Number(value("limit", "8")),
    mode: value("mode", "both") as Mode | "both",
    judge: args.includes("--judge"),
    gate: args.includes("--gate"),
    seed: Number(value("seed", "42")),
  };
}

// ================= 取样 =================
/**
 * 固定种子的洗牌。
 * 没这个的话每次评测抽到的项目都不一样，两次结果就没法对比，
 * 退化检测也就无从谈起。
 */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const out = [...arr];
  let s = seed >>> 0;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 分层抽样：每个语言层内部**随机**抽。
 *
 * 一开始是按 star 降序取头部，结果全是 React / Linux / VS Code 这种
 * 模型闭着眼都能写出来、也确实发布到 npm 的项目，两版编造率都是 0%，
 * 评测等于没测。真实场景推的是「最近 30 天新建」的项目，模型根本没见过，
 * 所以样本必须包含小众项目才有鉴别力。
 */
async function pickSamples(limit: number, seed: number): Promise<EvalCase[]> {
  const repos = await prisma.repository.findMany({
    select: { fullName: true, description: true, language: true, stars: true },
    orderBy: { stars: "desc" },
  });
  if (repos.length === 0) throw new Error("数据库里没有项目，先跑一次 npm run update:daily 或 npm run db:import");

  const byLang = new Map<string, typeof repos>();
  for (const r of repos) {
    const key = r.language ?? "unknown";
    if (!byLang.has(key)) byLang.set(key, []);
    byLang.get(key)!.push(r);
  }

  const layers = [...byLang.values()].map((list) => seededShuffle(list, seed));
  const out: EvalCase[] = [];

  // 逐层轮转，保证不偏科；层里抽干了就跳过
  let i = 0;
  while (out.length < limit) {
    let progressed = false;
    for (const layer of layers) {
      if (out.length >= limit) break;
      if (i < layer.length) {
        const r = layer[i];
        out.push({
          fullName: r.fullName,
          description: r.description,
          language: r.language,
          stars: r.stars,
          topics: [],
          homepage: null,
        });
        progressed = true;
      }
    }
    if (!progressed) break;
    i++;
  }
  return out;
}

// ================= 报告 =================
const EVAL_DIR = path.join(process.cwd(), "data", "eval");
const RUNS_DIR = path.join(EVAL_DIR, "runs");
const LATEST = path.join(EVAL_DIR, "latest.json");

async function readBaseline(): Promise<RunSummary[] | undefined> {
  try {
    const raw = await fs.readFile(LATEST, "utf8");
    return (JSON.parse(raw) as EvalRun).summary;
  } catch {
    return undefined;
  }
}

function pct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(0)}%`;
}

function printSummary(s: RunSummary): void {
  console.log(
    [
      `[${s.mode}]`,
      `成功率 ${pct(s.successRate)} (${s.generated}/${s.cases})`,
      `命令可验证 ${pct(s.verifiedRate)}`,
      `编造 ${pct(s.fabricationRate)}`,
      `不可查证 ${s.totalUnverifiable}`,
      `有可验证命令的样本 ${pct(s.casesWithVerifiedCommand)}`,
      `平均未知 ${s.avgMissingInfo.toFixed(1)}`,
      `工具调用 ${s.avgToolCalls.toFixed(1)}`,
      `耗时 ${(s.avgMs / 1000).toFixed(1)}s`,
    ].join(" | "),
  );
  if (s.avgJudgeGroundedness !== undefined && s.avgJudgeUsefulness !== undefined) {
    console.log(
      `       LLM 评审：言之有据 ${s.avgJudgeGroundedness.toFixed(2)}/5，新手可用 ${s.avgJudgeUsefulness.toFixed(2)}/5`,
    );
  }
}

// ================= 主流程 =================
(async () => {
  const opts = readArgs();
  const modes: Mode[] = opts.mode === "both" ? ["tools", "plain"] : [opts.mode];

  console.log(
    `抽取 ${opts.limit} 个样本（分层随机，seed=${opts.seed}），模式 ${modes.join(" / ")}${opts.judge ? "，启用 LLM 评审" : ""}\n`,
  );

  const cases = await pickSamples(opts.limit, opts.seed);
  const baseline = opts.gate ? await readBaseline() : undefined;
  const metrics = [];
  const summaries: RunSummary[] = [];

  for (const mode of modes) {
    console.log(`──── ${mode} 模式 ────`);
    const batch = await runEvaluation(cases, { mode, useJudge: opts.judge, log: (m) => console.log(m) });
    metrics.push(...batch);
    summaries.push(summarize(mode, batch));
  }

  console.log("\n══════ 汇总 ══════");
  for (const s of summaries) printSummary(s);

  const regressions: string[] = [];
  if (baseline) {
    for (const s of summaries) {
      const base = baseline.find((b) => b.mode === s.mode);
      regressions.push(...diffAgainstBaseline(s, base).map((r) => `[${s.mode}] ${r}`));
    }
  }

  await fs.mkdir(RUNS_DIR, { recursive: true });
  const at = new Date();
  const report: EvalRun = {
    at: at.toISOString(),
    cases,
    metrics,
    summary: summaries,
    ...(regressions.length ? { regressions } : {}),
  };
  const stamp = at.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  await fs.writeFile(path.join(RUNS_DIR, `${stamp}.json`), JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(LATEST, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n报告已写入 data/eval/runs/${stamp}.json`);

  if (regressions.length) {
    console.log("\n⚠️ 检测到指标退化：");
    for (const r of regressions) console.log(`  - ${r}`);
  }

  await prisma.$disconnect();

  if (opts.gate && regressions.length > 0) {
    console.log("\n❌ 门禁未通过");
    process.exit(1);
  }
})().catch((err) => {
  console.error("评测失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
