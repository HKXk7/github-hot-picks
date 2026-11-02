import { Suspense } from "react";
import Link from "next/link";
import { getIssueByDate } from "@/lib/site-data";
import { formatStars, parseContent } from "@/lib/format";
import PicksExplorer from "@/components/PicksExplorer";

interface PageProps {
  params: Promise<{ date: string }>;
}

/**
 * 这里不能在 Suspense 外面 await params。
 *
 * 开了 cacheComponents 之后，params 属于「运行时数据」，在 Suspense 外读它会让整条
 * 路由没法预渲染——实测直接把 build 打断在 /history/[date]。正确做法是把 params
 * 这个 Promise 原样传进去，在 Suspense 内部再 await：外壳静态、内容流式补齐。
 */
export default function IssueDetailPage({ params }: PageProps) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <Suspense fallback={<div className="panel-card p-10 text-center text-slate-500">正在加载该期内容…</div>}>
        <IssueDetail params={params} />
      </Suspense>
    </main>
  );
}

async function IssueDetail({ params }: PageProps) {
  const { date } = await params;
  const issue = await getIssueByDate(date);

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

      <PicksExplorer picks={issue.picks} />

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
