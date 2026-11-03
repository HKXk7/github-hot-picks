import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { formatCost, formatTokens } from "@/lib/ai/usage";
import { summarizeUsage, type GroupStat } from "@/lib/ai/usage-stats";

/**
 * 成本看板。
 *
 * 终端里的 npm run usage 只有自己看得到；放到页面上才能把「花了多少、
 * 时间花在哪」这件事变成能展示出来的东西。数据口径和终端报告共用
 * src/lib/ai/usage-stats.ts，不会出现两边数字对不上。
 */

export const metadata = {
  title: "成本看板",
  // 内部页面，别进搜索结果（robots.txt 和访问令牌另外还有两道）
  robots: { index: false, follow: false },
};

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

function ms(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

/**
 * 取 N 天前的那个时刻。
 *
 * 两个坑都要绕开：
 * - 组件里直接写 Date.now() 会被 React 的纯度规则判为「渲染中调用了不纯函数」；
 * - 挪到普通函数里之后，Next 在预渲染（PPR 生成静态外壳）时还是会扫到它，
 *   报 "encountered the unstable value Date.now()"。
 * 真正的解法是调用方先 await connection() 声明「这段必须按请求渲染」，
 * 之后读当前时间才是合法的（见 UsageBoard）。
 */
function sinceDaysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

/** 纯 CSS 条形图：就几个分组，为了它引一个图表库不值得 */
function BarList({
  title,
  hint,
  items,
  renderValue,
}: {
  title: string;
  hint: string;
  items: GroupStat[];
  renderValue: (g: GroupStat) => string;
}) {
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => i.ms), 1);

  return (
    <section className="panel-card p-5">
      <h2 className="text-sm font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      <ul className="mt-4 space-y-3">
        {items.slice(0, 8).map((g) => (
          <li key={g.key}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-medium text-slate-700">{g.key}</span>
              <span className="shrink-0 text-slate-500">
                {renderValue(g)} · {g.calls} 次
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400"
                style={{ width: `${Math.max(3, (g.ms / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel-card p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-extrabold text-slate-900">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

async function UsageBoard({ searchParams }: PageProps) {
  // 明确声明「这段内容必须按请求渲染」。
  // 不声明的话 Next 会试图把它烘进静态外壳，而读「当前时间」在预渲染期是非法的 ——
  // 而且烘出来的看板会永远停在构建那一刻，第一天之后就没用了。
  await connection();

  const sp = await searchParams;
  const parsed = Number(sp.days ?? 7);
  const days = Number.isFinite(parsed) && parsed > 0 && parsed <= 90 ? parsed : 7;

  const since = sinceDaysAgo(days);
  const rows = await prisma.llmCall.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
  });
  const s = summarizeUsage(rows);

  return (
    <>
      <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="调用次数" value={String(s.calls)} sub={`最近 ${days} 天`} />
        <Stat label="成功率" value={`${(s.successRate * 100).toFixed(1)}%`} sub={`失败 ${s.failed} 次`} />
        <Stat
          label="token"
          value={formatTokens(s.totalTokens)}
          sub={`入 ${formatTokens(s.promptTokens)} / 出 ${formatTokens(s.completionTokens)}`}
        />
        <Stat label="成本" value={s.hasCost ? formatCost(s.cost) : formatCost(null)} sub={s.hasCost ? "按 .env 单价折算" : "未配单价表"} />
        <Stat label="耗时" value={`p50 ${ms(s.p50Ms)}`} sub={`p95 ${ms(s.p95Ms)} · 合计 ${ms(s.totalMs)}`} />
      </div>

      {s.calls === 0 ? (
        <p className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          最近 {days} 天没有调用记录。跑一次 <code className="font-mono">npm run update:daily</code> 就有了。
        </p>
      ) : (
        <div className="mt-8 grid gap-5 lg:grid-cols-2">
          <BarList title="时间花在哪（按用途）" hint="条长 = 这一类调用的总耗时" items={s.byKind} renderValue={(g) => ms(g.ms)} />
          <BarList
            title="token 花在哪（按模型）"
            hint="条长 = 该模型的总耗时，右侧是 token"
            items={s.byModel}
            renderValue={(g) => formatTokens(g.tokens)}
          />
          <BarList title="哪一步最慢" hint="只在 tools 模式（先取证再写）下才有分步数据" items={s.byLabel} renderValue={(g) => ms(g.ms)} />
          <section className="panel-card p-5">
            <h2 className="text-sm font-bold text-slate-900">最贵的几次生成</h2>
            <p className="mt-1 text-xs text-slate-500">一次生成 = 一个 traceId，通常包含取证、写作、修复好几轮调用</p>
            <ul className="mt-4 space-y-2">
              {s.byTrace.slice(0, 5).map((g) => (
                <li key={g.key} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate font-mono text-slate-600">{g.key}</span>
                  <span className="shrink-0 text-slate-500">
                    {g.calls} 次 · {formatTokens(g.tokens)} · {ms(g.ms)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {s.failures.length > 0 ? (
        <section className="panel-card mt-5 p-5">
          <h2 className="text-sm font-bold text-slate-900">最近的失败</h2>
          <ul className="mt-3 space-y-2">
            {s.failures.map((f, i) => (
              <li key={i} className="text-xs text-slate-600">
                <span className="font-mono text-slate-400">{f.at}</span> {f.model} —— {f.error.slice(0, 120)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export default function UsagePage({ searchParams }: PageProps) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-cyan-500">
          ← 返回今日推荐
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.28em] text-cyan-500">Cost &amp; Latency</p>
        <h1 className="mt-2 text-4xl font-extrabold text-slate-900">成本看板</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          每一次模型调用的 token、耗时、成功与否都记在库里。这一页是它们的汇总，和终端里的{" "}
          <code className="font-mono text-xs">npm run usage</code> 是同一份口径。
        </p>
        <div className="mt-4 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
      </header>

      <Suspense fallback={<div className="panel-card mt-8 p-10 text-center text-sm text-slate-500">正在统计用量…</div>}>
        <UsageBoard searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
