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
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-10">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-cyan-500">
          ← 返回今日推荐
        </Link>
        <p className="mt-6 text-sm font-bold uppercase tracking-[0.28em] text-cyan-500">Archive</p>
        <h1 className="mt-2 text-4xl font-extrabold text-slate-900">往期推荐</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
          每一天自动抓取、筛选后的推荐都会留档在这里。点开任意一期，可以回看当天的项目清单和它们的小白教程。
        </p>
        <div className="mt-4 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
      </header>

      <Suspense fallback={<div className="panel-card p-10 text-center text-slate-500">正在加载往期数据…</div>}>
        <IssueList />
      </Suspense>
    </main>
  );
}

async function IssueList() {
  const issues = await getIssueList();

  if (issues.length === 0) {
    return (
      <div className="panel-card p-10 text-center">
        <p className="text-lg font-bold text-slate-900">还没有往期存档</p>
        <p className="mt-3 text-sm text-slate-600">
          跑一次 <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-cyan-600">npm run update:daily</code> 就会生成第一期并存进数据库。
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
            className="project-card group flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full border border-cyan-200 bg-gradient-to-r from-cyan-50 to-fuchsia-50 px-3 py-1 text-xs font-bold text-cyan-600">
                  第 {item.issue} 期
                </span>
                <span className="text-sm font-semibold text-slate-900">{item.dateLabel}</span>
                {index === 0 ? (
                  <span className="rounded-full border border-lime-200 bg-lime-50 px-2.5 py-0.5 text-xs font-bold text-lime-600">最新</span>
                ) : null}
              </div>
              <h2 className="mt-2 truncate text-lg font-bold text-slate-900 transition group-hover:text-cyan-600">{item.title}</h2>
              <p className="mt-1 text-xs text-slate-400">更新于 {formatTime(item.updatedAt)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-6 text-sm">
              <div className="text-center">
                <div className="text-xl font-extrabold text-cyan-500 glow-cyan">{item.pickCount}</div>
                <div className="mt-0.5 text-xs text-slate-400">个项目</div>
              </div>
              <div className="text-center">
                <div className="flex items-center gap-1 text-xl font-extrabold text-amber-500">⭐ {formatStars(item.totalStars)}</div>
                <div className="mt-0.5 text-xs text-slate-400">合计 Star</div>
              </div>
              <span className="text-slate-400 text-lg transition group-hover:translate-x-1 group-hover:text-cyan-500">→</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}