import { getLatestSiteIssue, type SiteIssue } from "@/lib/site-data";
import { langStyle, formatStars, formatTime, parseContent } from "@/lib/format";
import ProjectTutorialModal from "@/components/ProjectTutorialModal";

export default async function Home() {
  const issue = await getLatestSiteIssue();

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-12 sm:px-8 sm:py-16">
      <RecommendationSection issue={issue} />
    </main>
  );
}

function RecommendationSection({ issue }: { issue: SiteIssue | null }) {
  if (!issue) {
    return (
      <div className="grid-texture rounded-[32px] border border-white/10 bg-white/[0.03] p-10 text-center">
        <p className="text-xl font-semibold text-zinc-100">还没有检测到推荐数据</p>
        <p className="mt-3 text-zinc-400">
          可以先运行 <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-zinc-300">npm run db:seed</code>{" "}
          预览页面，或者直接执行{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-zinc-300">npm run update:daily</code>{" "}
          拉取今天的数据。
        </p>
      </div>
    );
  }

  const contentBlocks = parseContent(issue.content);
  const topPick = issue.picks[0];

  return (
    <div className="space-y-14">
      <header className="grid gap-8 lg:grid-cols-[1.25fr_0.85fr] lg:items-start">
        <div className="rounded-[32px] border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_46%),radial-gradient(circle_at_top_right,rgba(232,121,249,0.2),transparent_38%),rgba(255,255,255,0.03)] p-8 shadow-2xl shadow-black/40">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-lime-400/30 bg-lime-400/10 px-3 py-1 text-xs font-medium text-lime-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-400" />
            AI Buddy 已接入 · 自动化日报 · 第 {issue.issue} 期
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            <span className="gradient-text">GitHub 热门项目推荐</span>
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-zinc-300 sm:text-lg">
            {issue.dateLabel} 更新，自动抓取 GitHub 热门新项目，筛选后生成推荐清单，并接入一个可连续对话、可切换模型的 AI 小助手，帮你更快看懂这些项目。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#today"
              className="rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 px-5 py-3 text-sm font-semibold text-zinc-950 shadow-lg shadow-cyan-500/30 transition hover:brightness-110 hover:shadow-cyan-400/50"
            >
              查看今日推荐 →
            </a>
            <a
              href="/history"
              className="rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-cyan-400/40 hover:bg-white/10"
            >
              📚 往期回顾
            </a>
            <a
              href="#guide"
              className="rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-medium text-zinc-200 transition hover:border-cyan-400/40 hover:bg-white/10"
            >
              看新手教程
            </a>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-4">
            <StatCard label="本期推荐" value={`${issue.picks.length} 个`} />
            <StatCard label="合计 Star" value={formatStars(issue.totalStars)} />
            <StatCard label="涉及语言" value={`${issue.languageCount} 种`} />
            <StatCard label="数据来源" value={issue.source === "database" ? "数据库" : "快照"} />
          </div>
        </div>

        <div className="space-y-4">
          <InfoPanel
            title="自动化状态"
            eyebrow="Daily Pipeline"
            body="系统会按天自动抓取候选项目、筛选、生成推荐内容，并把最新结果写回站点使用的数据源。"
            footer={`最近更新时间：${formatTime(issue.updatedAt)}`}
          >
            <div className="grid gap-3 text-sm text-zinc-300 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <MiniStat label="任务状态" value={issue.runStatus?.status ?? "ready"} />
              <MiniStat label="运行模式" value={issue.source === "database" ? "实时读取" : "已提交快照"} />
              <MiniStat label="更新频率" value="一天一更" />
              <MiniStat label="对话方式" value="流式 AI 问答" />
            </div>
          </InfoPanel>

          <InfoPanel
            title="AI Work Buddy"
            eyebrow="Right Panel"
            body="右下角可以直接打开 AI Buddy。它会带上今天这期推荐上下文，所以不是普通聊天框，而是更像一个懂当前项目数据的小助手。"
            footer="支持模型切换、连续对话、快捷提问和本地会话记忆。"
          />
        </div>
      </header>

      <section id="today" className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-400">Today&apos;s Picks</p>
            <h2 className="mt-1 text-3xl font-bold text-zinc-50">今天值得关注的项目</h2>
            <div className="mt-3 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
          </div>
          <p className="max-w-2xl text-sm leading-7 text-zinc-400">{issue.summary}</p>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.1fr_1.4fr]">
          {topPick ? <FeaturedCard issue={issue} /> : null}
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {issue.picks.slice(1).map((pick, index) => {
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
                      <h3 className="text-lg font-semibold text-zinc-100 transition group-hover:text-cyan-200">
                        <a href={pick.url} target="_blank" rel="noopener noreferrer">
                          {pick.fullName}
                        </a>
                      </h3>
                      <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-yellow-300">
                        <StarIcon />
                        {formatStars(pick.stars)}
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
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <InfoPanel
          title="今天这期怎么读"
          eyebrow="Read Me First"
          body="如果你是第一次看这种推荐站，最省时间的方式是：先看第一名项目，再找一个和你目标最接近的分类，然后用右下角 AI Buddy 继续追问。"
          footer="推荐提问：这个项目适不适合新手？我应该先学什么？"
        />
        <InfoPanel
          title="自动化到底做了什么"
          eyebrow="Automation Flow"
          body="它不是只生成一次页面，而是每天自动执行一条完整流水线：抓 GitHub 候选项目、做去重和排序、生成推荐理由、写入站点数据，再由前端读取最新结果展示出来。"
          footer="也可以手动执行 `npm run update:daily` 立即刷新。"
        />
      </section>

      <section className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8">
        <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">Issue Summary</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">{issue.title}</h2>
        <div className="mt-6 space-y-4 text-zinc-300">
          {contentBlocks.map((block, index) => {
            if (block.type === "h1") {
              return (
                <h3 key={index} className="text-2xl font-semibold text-white">
                  {block.text}
                </h3>
              );
            }
            if (block.type === "h2") {
              return (
                <h4 key={index} className="pt-2 text-xl font-semibold text-zinc-100">
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

      <section id="guide" className="rounded-[32px] border border-white/10 bg-white/[0.03] p-8">
        <p className="text-sm uppercase tracking-[0.28em] text-zinc-500">Beginner Guide</p>
        <h2 className="mt-2 text-3xl font-semibold text-zinc-50">新手也能看懂的上手教程</h2>
        <p className="mt-3 max-w-3xl text-sm leading-8 text-zinc-400">
          这一版不只是页面下方一句说明，而是把你真正需要走的步骤拆开了。你只要照着下面 4 步做，就能把项目跑起来、看到 AI 助手、并触发自动更新。
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <GuideCard
            step="01"
            title="先把项目跑起来"
            text="安装依赖后先启动本地开发服务器，这一步的目标只是确认页面能打开，不用急着研究代码。"
            code={`npm install\nnpm run dev`}
          />
          <GuideCard
            step="02"
            title="准备数据"
            text="如果你只是想先预览页面，用种子数据最快；如果要拿到今天的真实数据，就跑自动更新脚本。"
            code={`npm run db:seed\n# 或者\nnpm run update:daily`}
          />
          <GuideCard
            step="03"
            title="接入 AI 问答"
            text="在 .env 里填好 SiliconFlow 的密钥后，右下角就能打开 AI Buddy，并在面板里切换模型。"
            code={`SILICONFLOW_API_KEY=你的密钥\nSILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1`}
          />
          <GuideCard
            step="04"
            title="让它每天自动更新"
            text="仓库里的 GitHub Actions 已经改成按天执行。把仓库推到 GitHub 后，只要配好 Secret，就会一天一更。"
            code={`GITHUB_TOKEN=可选，提高限额\nSILICONFLOW_API_KEY=可选，用于生成更自然的摘要`}
          />
        </div>
      </section>
    </div>
  );
}

function FeaturedCard({ issue }: { issue: SiteIssue }) {
  const pick = issue.picks[0];
  const lang = langStyle(pick.language);

  return (
    <div className="group neon-card flex h-full flex-col rounded-[32px] p-6">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-lime-400 to-emerald-400 px-3 py-1 text-xs font-bold text-zinc-950 shadow-lg shadow-lime-400/30">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-950" />
          今日焦点
        </span>
        <span className="font-mono text-sm font-bold text-cyan-300 glow-cyan">
          #{String(pick.rank).padStart(2, "0")}
        </span>
      </div>

      <h3 className="mt-4 text-2xl font-semibold text-white transition group-hover:text-cyan-200">
        <a href={pick.url} target="_blank" rel="noopener noreferrer">
          {pick.fullName}
        </a>
      </h3>
      <p className="mt-2.5 text-sm leading-7 text-zinc-300">
        {pick.description ?? "这个项目今天冲到了推荐榜首，值得优先看看。"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        {pick.language ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium"
            style={{ color: lang.text, background: lang.bg }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: lang.dot }} />
            {pick.language}
          </span>
        ) : null}
        {pick.category ? (
          <span className="rounded-full bg-fuchsia-500/20 px-2.5 py-1 font-medium text-fuchsia-300">
            {pick.category}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1 font-semibold text-yellow-300">
          <StarIcon />
          {formatStars(pick.stars)}
        </span>
        <span className="text-zinc-500">⑂ {formatStars(pick.forks)}</span>
      </div>

      <div className="mt-4 rounded-2xl border border-cyan-400/20 bg-cyan-950/30 p-3.5 text-sm leading-7 text-zinc-200">
        <span className="font-semibold text-cyan-200">推荐理由：</span>
        {pick.reason ?? "它在今天的候选项目里综合表现最突出。"}
      </div>

      <div className="mt-4">
        <ProjectTutorialModal pick={pick} />
      </div>
    </div>
  );
}

function InfoPanel({
  eyebrow,
  title,
  body,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  footer: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
      <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">{eyebrow}</p>
      <h2 className="mt-2 text-xl font-semibold text-zinc-50">{title}</h2>
      <p className="mt-3 text-sm leading-7 text-zinc-400">{body}</p>
      {children ? <div className="mt-5">{children}</div> : null}
      <p className="mt-5 text-xs leading-6 text-zinc-500">{footer}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-medium text-white">{value}</div>
    </div>
  );
}

function GuideCard({
  step,
  title,
  text,
  code,
}: {
  step: string;
  title: string;
  text: string;
  code: string;
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-black/20 p-5">
      <div className="text-sm font-medium text-cyan-300">步骤 {step}</div>
      <h3 className="mt-2 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-7 text-zinc-400">{text}</p>
      <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-zinc-950/90 p-4 text-sm text-zinc-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function StatCard({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-3xl border border-white/10 bg-black/20 ${compact ? "p-4" : "p-5"}`}>
      <div className={`glow-cyan ${compact ? "text-lg" : "text-2xl"} font-semibold text-cyan-200`}>{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z" />
    </svg>
  );
}
