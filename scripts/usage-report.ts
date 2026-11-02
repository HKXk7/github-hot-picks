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
 */

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { formatCost, formatTokens } from "../src/lib/ai/usage";

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

/** 分位数：样本少的时候不插值，直接取最近的那个 */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)));
  return sorted[idx];
}

function pad(s: string, n: number): string {
  // 中文占两格，按显示宽度补空格，否则表格会歪
  const width = [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, n - width));
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

  const ok = rows.filter((r) => r.ok);
  const failed = rows.filter((r) => !r.ok);
  const tokens = rows.reduce((s, r) => s + r.totalTokens, 0);
  const prompt = rows.reduce((s, r) => s + r.promptTokens, 0);
  const completion = rows.reduce((s, r) => s + r.completionTokens, 0);
  const cost = rows.reduce((s, r) => s + (r.costCny ?? 0), 0);
  const hasCost = rows.some((r) => r.costCny !== null);
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);

  console.log(`\n最近 ${days} 天 · ${rows.length} 次调用`);
  console.log(`成功率     ${pct(ok.length / rows.length)}（失败 ${failed.length} 次）`);
  console.log(`token      ${formatTokens(tokens)}（入 ${formatTokens(prompt)} / 出 ${formatTokens(completion)}）`);
  console.log(`成本       ${hasCost ? formatCost(cost) : formatCost(null)}`);
  console.log(`耗时       p50 ${ms(quantile(latencies, 0.5))} · p95 ${ms(quantile(latencies, 0.95))} · 合计 ${ms(rows.reduce((s, r) => s + r.latencyMs, 0))}`);

  // ---- 按类型 ----
  const byKind = new Map<string, { n: number; tokens: number; cost: number; ms: number }>();
  const byModel = new Map<string, { n: number; tokens: number; cost: number; ms: number }>();
  const byLabel = new Map<string, { n: number; tokens: number; ms: number }>();
  for (const r of rows) {
    const bump = (m: Map<string, { n: number; tokens: number; cost: number; ms: number }>, key: string) => {
      const cur = m.get(key) ?? { n: 0, tokens: 0, cost: 0, ms: 0 };
      cur.n += 1; cur.tokens += r.totalTokens; cur.cost += r.costCny ?? 0; cur.ms += r.latencyMs;
      m.set(key, cur);
    };
    bump(byKind, r.kind);
    bump(byModel, r.model);
    if (r.label) {
      const cur = byLabel.get(r.label) ?? { n: 0, tokens: 0, ms: 0 };
      cur.n += 1; cur.tokens += r.totalTokens; cur.ms += r.latencyMs;
      byLabel.set(r.label, cur);
    }
  }

  const table = (title: string, head: string[], lines: string[][]) => {
    console.log(`\n${title}`);
    console.log("  " + head.map((h, i) => pad(h, [22, 10, 14, 14][i] ?? 12)).join(""));
    for (const l of lines) console.log("  " + l.map((c, i) => pad(c, [22, 10, 14, 14][i] ?? 12)).join(""));
  };

  table(
    "按用途",
    ["用途", "次数", "token", "耗时"],
    [...byKind.entries()]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([k, v]) => [k, String(v.n), formatTokens(v.tokens), ms(v.ms)]),
  );

  table(
    "按模型",
    ["模型", "次数", "token", hasCost ? "成本" : "耗时"],
    [...byModel.entries()]
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .map(([k, v]) => [k, String(v.n), formatTokens(v.tokens), hasCost ? formatCost(v.cost) : ms(v.ms)]),
  );

  if (byLabel.size > 0) {
    table(
      "哪一步最慢",
      ["步骤", "次数", "token", "总耗时"],
      [...byLabel.entries()]
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 6)
        .map(([k, v]) => [k, String(v.n), formatTokens(v.tokens), ms(v.ms)]),
    );
  }

  // ---- 最贵的几次生成 ----
  if (!traceId) {
    const byTrace = new Map<string, { n: number; tokens: number; cost: number; ms: number; kind: string }>();
    for (const r of rows) {
      const cur = byTrace.get(r.traceId) ?? { n: 0, tokens: 0, cost: 0, ms: 0, kind: r.kind };
      cur.n += 1; cur.tokens += r.totalTokens; cur.cost += r.costCny ?? 0; cur.ms += r.latencyMs;
      byTrace.set(r.traceId, cur);
    }
    table(
      "最贵的几次生成",
      ["traceId", "调用数", "token", hasCost ? "成本" : "耗时"],
      [...byTrace.entries()]
        .sort((a, b) => b[1].tokens - a[1].tokens)
        .slice(0, 5)
        .map(([k, v]) => [k.slice(0, 22), String(v.n), formatTokens(v.tokens), hasCost ? formatCost(v.cost) : ms(v.ms)]),
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
  if (failed.length > 0) {
    console.log(`\n最近 ${Math.min(5, failed.length)} 次失败：`);
    for (const r of failed.slice(0, 5)) {
      console.log(`  ${r.createdAt.toISOString().slice(0, 19)} ${r.model} ${(r.error ?? "").slice(0, 90)}`);
    }
  }
  console.log("");
}

main()
  .catch((err) => {
    console.error("生成用量报告失败：", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
