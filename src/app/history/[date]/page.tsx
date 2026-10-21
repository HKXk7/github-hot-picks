import { Suspense } from "react";
import Link from "next/link";
import { getIssueByDate } from "@/lib/site-data";
import { langStyle, formatStars, parseContent } from "@/lib/format";
import ProjectTutorialModal from "@/components/ProjectTutorialModal";

interface PageProps {
  params: Promise<{ date: string }>;
}

export default async function IssueDetailPage({ params }: PageProps) {
  const { date } = await params;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-8 sm:py-16">
      <Suspense
        fallback={
          <div className="grid-texture rounded-[28px] border border-white/10 bg-white/[0.03] p-10 text-center text-zinc-400">
            正在加载该期内容…
          </div>
        }
      >
        <IssueDetail dateKey={date} />
      </Suspense>
    </main>
  );
}

async function IssueDetail({ dateKey }: { dateKey: string }) {
  const issue = await getIssueByDate(dateKey);

  if (!issue) {
    return (
      <div className="grid-texture rounded-[28px] border border-white/10 bg-white/[0.03] p-10 text-center">
        <p className="text-lg font-semibold text-zinc-100">没有找到这一期的存档</p>
        <p className="mt-3 text-sm text-zinc-400">
          可能是日期不对，或这期还没有生成数据。
        </p>
        <Link
          href="/history"
          className="mt-6 inline-block rounded-full border border-cyan-400/40 bg-cyan-400/10 px-5 py-2.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-400/20"
        >
          ← 回往期列表看看
        </Link>
      </div>
    );
  }

  const contentBlocks = parseContent(issue.content);

  return (
    <div className="space-y-10">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/history"
            className="text-sm text-zinc-400 transition hover:text-cyan-300"
          >
            ← 往期列表
          </Link>
          <span className="text-zinc-600">/</span>
          <span className="rounded-full bg-gradient-to-r from-cyan-400/20 to-fuchsia-400/20 px-3 py-1 text-xs font-semibold text-cyan-200">
            第 {issue.issue} 期
          </span>
          <span className="text-sm text-zinc-400">{issue.dateLabel}</span>
        </div>
        <h1 className="mt-5 text-3xl font-bold text-zinc-50 sm:text-4xl">{issue.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-zinc-400">{issue.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
          <span className="rounded-full bg-white/5 px-3 py-1">{issue.picks.length} 个项目</span>
          <span className="rounded-full bg-white/5 px-3 py-1">
            合计 ⭐ {formatStars(issue.totalStars)}
          </span>
          <span className="rounded-full bg-white/5 px-3 py-1">{issue.languageCount} 种语言</span>
        </div>
        <div className="mt-5 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
      </header>

      <section>
        <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {issue.picks.map((pick, index) => {
            const lang = langStyle(pick.language);
            return (
              <li key={pick.fullName} className="card-enter" style={{ animationDelay: `${index * 60}ms` }}>
                <div className="group glow-hover flex h-full flex-col rounded-[28px] border border-white/10 bg-white/[0.04] p-5 hover:-translate-y-1 hover:border-cyan-400/40 hover:bg-white/[0.07]">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-cyan-400/80">
                      #{String(pick.rank).padStart(2, "0")}
                    </span>
                    {pick.language ? (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                        style={{ color: lang.text, background: lang.bg }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: lang.dot }} />
                        {pick.language}
                      </span>
                    ) : null}
                  </div>

                  <div className="mb-2 flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold text-zinc-100 transition group-hover:text-cyan-200">
                      <a href={pick.url} target="_blank" rel="noopener noreferrer">
                        {pick.fullName}
                      </a>
                    </h2>
                    <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-yellow-300">
                      ⭐ {formatStars(pick.stars)}
                    </span>
                  </div>

                  {pick.description ? (
                    <p className="mb-4 flex-1 text-sm leading-7 text-zinc-400">{pick.description}</p>
                  ) : null}

                  <div className="mt-auto space-y-2 border-t border-white/5 pt-3 text-xs">
                    {pick.category ? (
                      <span className="inline-block rounded-full bg-fuchsia-500/20 px-2.5 py-1 font-medium text-fuchsia-300">
                        {pick.category}
                      </span>
                    ) : null}
                    {pick.reason ? (
                      <p className="text-zinc-500">
                        <span className="text-cyan-300">推荐理由：</span>
                        {pick.reason}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3">
                    <ProjectTutorialModal pick={pick} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {contentBlocks.length > 0 ? (
        <section className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-400">
            Issue Summary
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-zinc-50">当天的推荐稿全文</h2>
          <div className="mt-6 space-y-4">
            {contentBlocks.map((block, index) => {
              if (block.type === "h1") {
                return (
                  <h3 key={index} className="text-xl font-semibold text-white">
                    {block.text}
                  </h3>
                );
              }
              if (block.type === "h2") {
                return (
                  <h4 key={index} className="pt-2 text-lg font-semibold text-zinc-100">
                    {block.text}
                  </h4>
                );
              }
              if (block.type === "li") {
                return (
                  <div key={index} className="flex gap-3 text-sm leading-7 text-zinc-400">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    <span>{block.text}</span>
                  </div>
                );
              }
              if (block.type === "quote") {
                return (
                  <blockquote
                    key={index}
                    className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-4 py-3 text-sm leading-7 text-cyan-100"
                  >
                    {block.text}
                  </blockquote>
                );
              }
              return (
                <p key={index} className="text-sm leading-8 text-zinc-400">
                  {block.text}
                </p>
              );
            })}
          </div>
        </section>
      ) : null}

      <div className="text-center">
        <Link
          href="/history"
          className="inline-block rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-medium text-zinc-200 transition hover:border-cyan-400/40 hover:bg-white/10"
        >
          ← 返回往期列表
        </Link>
      </div>
    </div>
  );
}
