/**
 * 对照实验：plain（模型凭记忆作答） vs tools（先工具取证再作答）。
 *
 * 用法：npm run eval:compare [样本数]
 *
 * 为什么值得做：没有这个脚本，「加了工具调用到底有没有变好」就只是一句主观感受。
 * 这里把两版输出放到同一批项目上跑，用可量化的指标说话：
 *   - confidence 分布（AI 自评把握度，越高说明它越敢下结论）
 *   - installCommands 条数（能不能真的给出可执行命令）
 *   - missingInfo 条数（它承认了多少自己不知道的东西）
 * 生成结果不写库，只留下报告，避免污染正式数据。
 */
import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { generateStructuredTutorial, type TutorialMeta } from "../src/lib/tutorial/generate";
import type { Tutorial } from "../src/lib/tutorial/schema";

interface Sample extends TutorialMeta {}

interface Row {
  fullName: string;
  language: string | null;
  mode: "plain" | "tools";
  confidence: Tutorial["confidence"] | "-";
  commands: number;
  missing: number;
  attempts: number;
  toolCalls: number;
  ms: number;
  error?: string;
}

/** 尽量让样本覆盖不同语言，避免全是同一类项目导致结论偏斜 */
async function pickSamples(limit: number): Promise<Sample[]> {
  const repos = await prisma.repository.findMany({
    select: { fullName: true, description: true, language: true, stars: true },
    orderBy: { stars: "desc" },
    take: 200,
  });

  const byLang = new Map<string, typeof repos>();
  for (const r of repos) {
    const key = r.language ?? "unknown";
    if (!byLang.has(key)) byLang.set(key, []);
    byLang.get(key)!.push(r);
  }

  const out: Sample[] = [];
  const langs = [...byLang.keys()];
  // 轮转取样：先每个语言各拿一个，不够再回头补
  let i = 0;
  while (out.length < limit && i < Math.max(...langs.map((l) => byLang.get(l)!.length))) {
    for (const lang of langs) {
      const list = byLang.get(lang)!;
      if (i < list.length && out.length < limit) {
        const r = list[i];
        out.push({
          fullName: r.fullName,
          description: r.description,
          language: r.language,
          stars: r.stars,
          topics: [],
          homepage: null,
        });
      }
    }
    i++;
  }
  return out;
}

async function runOne(sample: Sample, mode: "plain" | "tools"): Promise<Row> {
  const started = Date.now();
  const res = await generateStructuredTutorial(sample, { mode, maxAttempts: 2 });
  const ms = Date.now() - started;

  if (!res.tutorial) {
    return {
      fullName: sample.fullName,
      language: sample.language,
      mode,
      confidence: "-",
      commands: 0,
      missing: 0,
      attempts: res.attempts,
      toolCalls: res.toolCalls?.length ?? 0,
      ms,
      error: res.error,
    };
  }

  const t = res.tutorial;
  return {
    fullName: sample.fullName,
    language: sample.language,
    mode,
    confidence: t.confidence,
    commands: t.installCommands.length,
    missing: t.missingInfo.length,
    attempts: res.attempts,
    toolCalls: res.toolCalls?.length ?? 0,
    ms,
  };
}

function summarize(rows: Row[], mode: "plain" | "tools") {
  const mine = rows.filter((r) => r.mode === mode && !r.error);
  const conf = { high: 0, medium: 0, low: 0 };
  for (const r of mine) if (r.confidence !== "-") conf[r.confidence]++;
  const avg = (f: (r: Row) => number) =>
    mine.length ? (mine.reduce((a, r) => a + f(r), 0) / mine.length).toFixed(2) : "-";

  return {
    mode,
    success: `${mine.length}/${rows.filter((r) => r.mode === mode).length}`,
    confidence: `high ${conf.high} / medium ${conf.medium} / low ${conf.low}`,
    avgCommands: avg((r) => r.commands),
    avgMissing: avg((r) => r.missing),
    avgToolCalls: avg((r) => r.toolCalls),
    avgMs: avg((r) => r.ms),
  };
}

(async () => {
  const limit = Number(process.argv[2] ?? 6);
  console.log(`抽取 ${limit} 个样本，分别用 plain / tools 两版生成…\n`);

  const samples = await pickSamples(limit);
  const rows: Row[] = [];

  for (const s of samples) {
    console.log(`▶ ${s.fullName}（${s.language ?? "?"}）`);
    for (const mode of ["plain", "tools"] as const) {
      const row = await runOne(s, mode);
      rows.push(row);
      console.log(
        `    ${mode.padEnd(5)} conf=${row.confidence} 命令 ${row.commands} 条，未知 ${row.missing} 条，` +
          `工具 ${row.toolCalls} 次，${(row.ms / 1000).toFixed(1)}s${row.error ? ` ❌ ${row.error}` : ""}`,
      );
    }
  }

  console.log("\n========== 汇总 ==========");
  const table = [summarize(rows, "plain"), summarize(rows, "tools")];
  for (const t of table) {
    console.log(
      `${t.mode.padEnd(6)} 成功 ${t.success} | confidence ${t.confidence} | 平均命令 ${t.avgCommands} | ` +
        `平均未知 ${t.avgMissing} | 平均工具调用 ${t.avgToolCalls} | 平均耗时 ${t.avgMs}ms`,
    );
  }

  const outDir = path.join(process.cwd(), "data", "eval");
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, `mode-compare-${new Date().toISOString().slice(0, 10)}.json`);
  await fs.writeFile(file, JSON.stringify({ at: new Date().toISOString(), rows, summary: table }, null, 2), "utf8");
  console.log(`\n报告已写入 ${path.relative(process.cwd(), file)}`);
})();
