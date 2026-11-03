/**
 * 用量报告：回答「这套东西到底花了多少钱、时间都去哪了」。
 *
 * 用法：
 *   npm run usage                 # 默认最近 7 天
 *   npm run usage -- --days 1     # 只看今天（日更跑完立刻看成本）
 *   npm run usage -- --trace tutorial-xxx   # 展开某一次生成的每一步
 *
 * 金额只有在 .env 里配了 LLM_PRICING_JSON 才会出现，否则只报 token
 * ——不内置单价表是刻意的，模型定价几个月一变，写死的数字迟早是错的。
 *
 * 汇总口径来自 src/lib/ai/usage-stats.ts，和网页上的成本看板是同一份：
 * 两边各算一遍的话，迟早会出现「网页说 3 块、命令行说 5 块」的场面。
 */

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { formatCost, formatTokens } from "../src/lib/ai/usage";
import { summarizeUsage } from "../src/lib/ai/usage-stats";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

function pad(s: string, n: number): string {
  // 中文占两格，按显示宽度补空格，否则表格会歪
  const width = [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, n - width));
}

function table(title: string, head: string[], lines: string[][]): void {
  console.log(`\n${title}`);
  console.log("  " + head.map((h, i) => pad(h, [22, 10, 14, 14][i] ?? 12)).join(""));
  for (const l of lines) console.log("  " + l.map((c, i) => pad(c, [22, 10, 14, 14][i] ?? 12)).join(""));
}

async function main() {
  const days = Number(arg("days") ?? 7);
  const traceId = arg("trace");
  const since = new Date(Date.now() - (Number.isFinite(days) ? days : 7) * 86_400_000);

  const rows = await prisma.llmCall.findMany({
    where: { createdAt: { gte: since }, ...(traceId ? { traceId } : {}) },
    orderBy: { createdAt: "desc" },
  });

  if (rows.length === 0) {
    console.log(`最近 ${days} 天没有 LLM 调用记录。`);
    return;
  }

  const s = summarizeUsage(rows);

  console.log(`\n最近 ${days} 天 · ${s.calls} 次调用`);
  console.log(`成功率     ${pct(s.successRate)}（失败 ${s.failed} 次）`);
  console.log(`token      ${formatTokens(s.totalTokens)}（入 ${formatTokens(s.promptTokens)} / 出 ${formatTokens(s.completionTokens)}）`);
  console.log(`成本       ${s.hasCost ? formatCost(s.cost) : formatCost(null)}`);
  console.log(`耗时       p50 ${ms(s.p50Ms)} · p95 ${ms(s.p95Ms)} · 合计 ${ms(s.totalMs)}`);

  table(
    "按用途",
    ["用途", "次数", "token", "耗时"],
    s.byKind.map((g) => [g.key, String(g.calls), formatTokens(g.tokens), ms(g.ms)]),
  );

  table(
    "按模型",
    ["模型", "次数", "token", s.hasCost ? "成本" : "耗时"],
    s.byModel.map((g) => [g.key, String(g.calls), formatTokens(g.tokens), s.hasCost ? formatCost(g.cost) : ms(g.ms)]),
  );

  if (s.byLabel.length > 0) {
    table(
      "哪一步最慢",
      ["步骤", "次数", "token", "总耗时"],
      s.byLabel.slice(0, 6).map((g) => [g.key, String(g.calls), formatTokens(g.tokens), ms(g.ms)]),
    );
  }

  // ---- 最贵的几次生成 ----
  if (!traceId) {
    table(
      "最贵的几次生成",
      ["traceId", "调用数", "token", s.hasCost ? "成本" : "耗时"],
      s.byTrace
        .slice(0, 5)
        .map((g) => [g.key.slice(0, 22), String(g.calls), formatTokens(g.tokens), s.hasCost ? formatCost(g.cost) : ms(g.ms)]),
    );
    console.log("\n  想看某一次的每一步：npm run usage -- --trace <traceId>");
  } else {
    console.log(`\ntrace ${traceId} 的每一步：`);
    console.log("  " + ["步骤", "模型", "token", "耗时"].map((h, i) => pad(h, [22, 30, 12, 10][i])).join(""));
    for (const r of [...rows].reverse()) {
      console.log(
        "  " +
          [r.label ?? r.kind, r.model, formatTokens(r.totalTokens), ms(r.latencyMs)]
            .map((c, i) => pad(String(c), [22, 30, 12, 10][i]))
            .join(""),
      );
    }
  }

  // ---- 失败 ----
  if (s.failures.length > 0) {
    console.log(`\n最近 ${s.failures.length} 次失败：`);
    for (const f of s.failures) console.log(`  ${f.at} ${f.model} ${f.error.slice(0, 90)}`);
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("生成用量报告失败：", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
