import { Suspense } from "react";
import Link from "next/link";
import { getIssueByDate, type SitePick } from "@/lib/site-data";
import { langStyle, formatStars, parseContent } from "@/lib/format";
import ProjectTutorialModal from "@/components/ProjectTutorialModal";

interface PageProps {
  params: Promise<{ date: string }>;
}

export default async function IssueDetailPage({ params }: PageProps) {
  const { date } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Suspense fallback={<div className="panel-card p-10 text-center text-slate-500">正在加载该期内容…</div>}>
        <IssueDetail dateKey={date} />
      </Suspense>
    </main>
  );
}

async function IssueDetail({ dateKey }: { dateKey: string }) {
  const issue = await getIssueByDate(dateKey);

  if (!issue) {
    return (
      <div className="panel-card p-10 text-center">
        <p className="text-lg font-bold text-slate-900">没有找到这一期的存档</p>
        <p className="mt-3 text-sm text-slate-600">可能是日期不对，或这期还没有生成数据。</p>
        <Link href="/history" className="mt-6 inline-block btn-outline px-5 py-2.5 text-sm font-medium">← 回往期列表看看</Link>
      </div>
    );
  }

  const contentBlocks = parseContent(issue.content);
  const topPick = issue.picks[0];

  return (
    <div className="space-y-10">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/history" className="text-sm font-medium text-slate-500 transition hover:text-cyan-500">← 往期列表</Link>
          <span className="text-slate-300">/</span>
          <span className="rounded-full border border-cyan-200 bg-gradient-to-r from-cyan-50 to-fuchsia-50 px-3 py-1 text-xs font-bold text-cyan-600">第 {issue.issue} 期</span>
          <span className="text-sm font-medium text-slate-600">{issue.dateLabel}</span>
        </div>
        <h1 className="mt-5 text-3xl font-extrabold text-slate-900 sm:text-4xl">{issue.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{issue.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">{issue.picks.length} 个项目</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">合计 ⭐ {formatStars(issue.totalStars)}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{issue.languageCount} 种语言</span>
        </div>
        <div className="mt-5 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
      </header>

      {topPick ? <FeaturedCard issue={issue} /> : null}

      {issue.picks.length > 1 ? (
        <section>
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {issue.picks.slice(1).map((pick, index) => {
              const lang = langStyle(pick.language);
              return (
                <li key={pick.fullName} className="card-enter" style={{ animationDelay: `${index * 50}ms` }}>
                  <div className="project-card flex h-full flex-col p-5">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-sm font-bold text-cyan-500">#{String(pick.rank).padStart(2, "0")}</span>
                      {pick.language ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: lang.text, background: lang.bg }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: lang.dot }} />{pick.language}
                        </span>
                      ) : null}
                    </div>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <h2 className="text-base font-bold text-slate-900 leading-snug hover:text-cyan-600 transition-colors">
                        <a href={pick.url} target="_blank" rel="noopener noreferrer">{pick.fullName}</a>
                      </h2>
                      <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-amber-500">⭐ {formatStars(pick.stars)}</span>
                    </div>
                    {pick.description ? (
                      <p className="mb-3 flex-1 text-sm leading-6 text-slate-500 line-clamp-3">{pick.description}</p>
                    ) : null}
                    <div className="mt-auto space-y-1.5 border-t border-slate-100 pt-2 text-xs">
                      {pick.category ? (
                        <span className="inline-block rounded-full bg-fuchsia-50 px-2 py-0.5 font-semibold text-fuchsia-600 border border-fuchsia-100">{pick.category}</span>
                      ) : null}
                      {pick.reason ? (
                        <p className="text-slate-500"><span className="text-cyan-600 font-semibold">推荐：</span>{pick.reason.length > 48 ? pick.reason.slice(0, 48) + "…" : pick.reason}</p>
                      ) : null}
                    </div>
                    <div className="mt-3"><ProjectTutorialModal pick={pick} /></div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {contentBlocks.length > 0 ? (
        <section className="panel-card p-6 sm:p-8">
          <p className="text-sm font-bold uppercase tracking-[0.28em] text-cyan-500">Issue Summary</p>
          <h2 className="mt-2 text-2xl font-extrabold text-slate-900">当天的推荐稿全文</h2>
          <div className="mt-6 space-y-4 text-slate-700">
            {contentBlocks.map((block, index) => {
              if (block.type === "h1") return <h3 key={index} className="text-xl font-bold text-slate-900">{block.text}</h3>;
              if (block.type === "h2") return <h4 key={index} className="pt-2 text-lg font-bold text-slate-800">{block.text}</h4>;
              if (block.type === "h3") return <h5 key={index} className="pt-1 text-base font-semibold text-slate-700">{block.text}</h5>;
              if (block.type === "li") return (
                <div key={index} className="flex gap-3 text-sm leading-7">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-400" /><span>{block.text}</span>
                </div>
              );
              if (block.type === "quote") return (
                <blockquote key={index} className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm leading-7 text-cyan-800 font-medium">{block.text}</blockquote>
              );
              return <p key={index} className="text-sm leading-8">{block.text}</p>;
            })}
          </div>
        </section>
      ) : null}

      <div className="text-center">
        <Link href="/history" className="btn-outline inline-block px-6 py-3 text-sm font-medium">← 返回往期列表</Link>
      </div>
    </div>
  );
}

function FeaturedCard({ issue }: { issue: { picks: SitePick[] } }) {
  const pick = issue.picks[0];
  const lang = langStyle(pick.language);
  return (
    <div className="featured-card p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-fuchsia-500 px-3 py-1 text-xs font-bold text-white shadow-lg shadow-cyan-400/30">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          当日精选 · #{String(pick.rank).padStart(2, "0")}
        </span>
      </div>
      <h3 className="mt-4 text-2xl font-extrabold text-slate-900 sm:text-3xl">
        <a href={pick.url} target="_blank" rel="noopener noreferrer" className="hover:text-transparent hover:bg-clip-text hover:bg-gradient-to-r hover:from-cyan-500 hover:to-fuchsia-500 transition-all">{pick.fullName}</a>
      </h3>
      <p className="mt-3 text-base leading-7 text-slate-600 sm:text-lg">{pick.description ?? "这个项目在当天推荐中综合表现最突出。"}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {pick.language ? (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold" style={{ color: lang.text, background: lang.bg }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: lang.dot }} />{pick.language}
          </span>
        ) : null}
        {pick.category ? <span className="rounded-full bg-fuchsia-50 px-2.5 py-1 font-semibold text-fuchsia-600 border border-fuchsia-100">{pick.category}</span> : null}
        <span className="inline-flex items-center gap-1 font-bold text-amber-500">⭐ {formatStars(pick.stars)}</span>
        <span className="text-slate-400">⑂ {formatStars(pick.forks)}</span>
      </div>
      <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50 p-5 text-sm leading-7 text-cyan-900 font-medium">
        <span className="font-bold">推荐理由：</span>{pick.reason ?? "它在当天候选项目里综合表现最突出。"}
      </div>
      <div className="mt-5"><ProjectTutorialModal pick={pick} /></div>
    </div>
  );
}