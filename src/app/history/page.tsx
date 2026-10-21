import { Suspense } from "react";
import Link from "next/link";
import { getIssueList } from "@/lib/site-data";
import { formatStars, formatTime } from "@/lib/format";

export const metadata = {
  title: "往期推荐 · GitHub 热门项目推荐",
  description: "浏览历史每一期的 GitHub 热门项目推荐",
};

export default function HistoryPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
      <header className="mb-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-cyan-300"
        >
          ← 返回今日推荐
        </Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.28em] text-cyan-400">
          Archive
        </p>
        <h1 className="mt-2 text-4xl font-bold text-zinc-50">往期推荐</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-400">
          每一天自动抓取、筛选后的推荐都会留档在这里。点开任意一期，可以回看当天的项目清单和它们的小白教程。
        </p>
        <div className="mt-4 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
      </header>

      <Suspense
        fallback={
          <div className="grid-texture rounded-[28px] border border-white/10 bg-white/[0.03] p-10 text-center text-zinc-400">
            正在加载往期数据…
          </div>
        }
      >
        <IssueList />
      </Suspense>
    </main>
  );
}

async function IssueList() {
  const issues = await getIssueList();

  if (issues.length === 0) {
    return (
      <div className="grid-texture rounded-[28px] border border-white/10 bg-white/[0.03] p-10 text-center">
        <p className="text-lg font-semibold text-zinc-100">还没有往期存档</p>
        <p className="mt-3 text-sm text-zinc-400">
          跑一次 <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-zinc-300">npm run update:daily</code>{" "}
          就会生成第一期并存进数据库。
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {issues.map((item, index) => (
        <li key={item.dateKey} className="card-enter" style={{ animationDelay: `${index * 60}ms` }}>
          <Link
            href={`/history/${item.dateKey}`}
            className="glow-hover group flex flex-col gap-4 rounded-[28px] border border-white/10 bg-white/[0.04] p-6 hover:border-cyan-400/40 hover:bg-white/[0.07] sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-gradient-to-r from-cyan-400/20 to-fuchsia-400/20 px-3 py-1 text-xs font-semibold text-cyan-200">
                  第 {item.issue} 期
                </span>
                <span className="text-sm font-medium text-zinc-200">{item.dateLabel}</span>
                {index === 0 ? (
                  <span className="rounded-full bg-lime-400/15 px-2.5 py-0.5 text-xs font-medium text-lime-300">
                    最新
                  </span>
                ) : null}
              </div>
              <h2 className="mt-2 truncate text-lg font-semibold text-zinc-50 transition group-hover:text-cyan-200">
                {item.title}
              </h2>
              <p className="mt-1 text-xs text-zinc-500">更新于 {formatTime(item.updatedAt)}</p>
            </div>

            <div className="flex shrink-0 items-center gap-6 text-sm">
              <div className="text-center">
                <div className="glow-cyan text-xl font-semibold text-cyan-200">{item.pickCount}</div>
                <div className="mt-0.5 text-xs text-zinc-500">个项目</div>
              </div>
              <div className="text-center">
                <div className="flex items-center gap-1 text-xl font-semibold text-yellow-300">
                  ⭐ {formatStars(item.totalStars)}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500">合计 Star</div>
              </div>
              <span className="text-zinc-500 transition group-hover:translate-x-1 group-hover:text-cyan-300">
                →
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
