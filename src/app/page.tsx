import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { getLatestSiteIssue } from "@/lib/site-data";
import { formatStars, formatTime, parseContent } from "@/lib/format";
import PicksExplorer from "@/components/PicksExplorer";

/**
 * 任务状态的中文标签。
 * partial = 稿子出来了但本期有项目没生成出教程 —— 这种半失败以前会显示成 success，
 * 于是「某项目连续几期没有教程」这种问题一直没人看见。
 */
const RUN_STATUS_LABEL: Record<string, string> = {
  success: "正常运行",
  partial: "部分成功",
  failed: "运行失败",
  running: "运行中",
  ready: "待运行",
};

/**
 * 首页必须是「静态外壳 + Suspense 包住查库的那部分」。
 *
 * 开了 cacheComponents 之后，直接在页面组件里 await 数据库属于运行时数据，
 * 会让整页没法预渲染（build 会直接失败）。所以外壳同步渲染，
 * 内容放 Suspense 里流式补齐 —— 也就是 Partial Prerender 想要的形态。
 */
export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      <Suspense
        fallback={
          <div className="panel-card p-10 text-center">
            <p className="text-base font-bold text-slate-800">正在加载今日推荐…</p>
            <p className="mt-2 text-sm text-slate-500">第一次打开要读一次数据库，稍等一下就好。</p>
          </div>
        }
      >
        <RecommendationSection />
      </Suspense>
    </main>
  );
}

async function RecommendationSection() {
  // 光有 Suspense 不够：Next 会在构建期把这段解析完、整页标成静态，
  // 数据就烘死在构建产物里了。声明「按请求渲染」，日更之后线上才会
  // 读到新的快照（部署版靠 SITE_SNAPSHOT_BASE 每 10 分钟同步一次）。
  await connection();
  const issue = await getLatestSiteIssue();
  if (!issue) {
    return (
      <div className="panel-card p-10 text-center">
        <p className="text-xl font-bold text-slate-900">还没有检测到推荐数据</p>
        <p className="mt-3 text-slate-600">
          可以先运行 <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-cyan-600">npm run db:seed</code>{" "}
          预览页面，或者直接执行{" "}
          <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-cyan-600">npm run update:daily</code>{" "}
          拉取今天的数据。
        </p>
      </div>
    );
  }

  const contentBlocks = parseContent(issue.content);

  return (
    <div className="space-y-12">
      {/* ====== Header ====== */}
      <header className="grid gap-6 lg:grid-cols-[1.2fr_0.9fr] lg:items-start">
        {/* 左：主卡片 */}
        <div className="featured-card p-6 sm:p-8">
          <p className="mb-4 inline-flex items-center gap-2 badge-lime px-3 py-1 text-xs font-semibold">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-lime-500" />
            AIBuddy 已接入 · 自动化日报 · 第 {issue.issue} 期
          </p>
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            <span className="gradient-text">GitHub 热门项目推荐</span>
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
            {issue.dateLabel} 更新，自动抓取 GitHub 热门新项目，筛选后生成推荐清单。右下角 <span className="font-semibold text-cyan-600">AIBuddy</span> 帮你更快看懂这些项目。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#today" className="btn-primary px-5 py-3 text-sm">
              查看今日推荐 →
            </a>
            <Link href="/history" className="btn-outline px-5 py-3 text-sm font-medium">
              📚 往期回顾
            </Link>
            <a href="#guide" className="btn-outline px-5 py-3 text-sm font-medium">
              新手教程
            </a>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-4">
            <MiniStat label="本期推荐" value={`${issue.picks.length} 个`} />
            <MiniStat label="合计 Star" value={formatStars(issue.totalStars)} />
            <MiniStat label="涉及语言" value={`${issue.languageCount} 种`} />
            <MiniStat label="数据来源" value={issue.source === "database" ? "数据库" : "快照"} />
          </div>
        </div>

        {/* 右：信息面板 */}
        <div className="space-y-4">
          <InfoPanel
            title="自动化状态"
            eyebrow="Daily Pipeline"
            body="系统按天自动抓取候选项目、筛选、生成推荐内容，并把最新结果写回站点数据源。"
            footer={`最近更新：${formatTime(issue.updatedAt)}`}
          >
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <MiniStat label="任务状态" value={RUN_STATUS_LABEL[issue.runStatus?.status ?? "ready"] ?? "待运行"} />
              <MiniStat label="运行模式" value={issue.source === "database" ? "实时读取" : "已提交快照"} />
              <MiniStat label="更新频率" value="一天一更" />
              <MiniStat label="对话方式" value="流式 AI 问答" />
            </div>
          </InfoPanel>

          <InfoPanel
            title="AIBuddy"
            eyebrow="Right Panel"
            body="右下角可以打开 AIBuddy。它会带上今天推荐上下文，不是普通聊天框，是懂当前项目数据的小助手。"
            footer="支持模型切换、连续对话、快捷提问和本地会话记忆。"
          />
        </div>
      </header>

      {/* ====== 今日推荐 ====== */}
      <section id="today" className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.28em] text-cyan-500">Today&apos;s Picks</p>
            <h2 className="mt-1 text-3xl font-extrabold text-slate-900">今天值得关注的项目</h2>
            <div className="mt-3 h-1 w-16 rounded-full bg-gradient-to-r from-cyan-400 via-lime-400 to-fuchsia-400" />
          </div>
          <p className="max-w-2xl text-sm leading-7 text-slate-500">{issue.summary}</p>
        </div>

        {/* 搜索 / 筛选 / 卡片列表（客户端组件，过滤是本地的、瞬时的） */}
        <PicksExplorer picks={issue.picks} />
      </section>

      {/* ====== 说明区 ====== */}
      <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <InfoPanel
          title="今天这期怎么读"
          eyebrow="Read Me First"
          body="最省时间的方式：先看第一名项目，再找一个和你目标最接近的分类，然后用右下角 AIBuddy 继续追问。"
          footer="推荐提问：这个项目适不适合新手？我应该先学什么？"
        />
        <InfoPanel
          title="自动化到底做了什么"
          eyebrow="Automation Flow"
          body="每天自动执行：抓 GitHub 候选项目 → 去重排序 → 生成推荐理由 → 写入站点数据 → 前端展示。"
          footer="也可以手动执行 npm run update:daily 立即刷新。"
        />
      </section>

      {/* ====== 推荐稿全文 ====== */}
      <section className="panel-card p-6 sm:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.28em] text-cyan-500">Issue Summary</p>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900">{issue.title}</h2>
        <div className="mt-6 space-y-4 text-slate-700">
          {contentBlocks.map((block, index) => {
            if (block.type === "h1") return <h3 key={index} className="text-xl font-bold text-slate-900">{block.text}</h3>;
            if (block.type === "h2") return <h4 key={index} className="pt-2 text-lg font-bold text-slate-800">{block.text}</h4>;
            if (block.type === "h3") return <h5 key={index} className="pt-1 text-base font-semibold text-slate-700">{block.text}</h5>;
            if (block.type === "li") return (
              <div key={index} className="flex gap-3 text-sm leading-7">
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-cyan-400" />
                <span>{block.text}</span>
              </div>
            );
            if (block.type === "quote") return (
              <blockquote key={index} className="rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm leading-7 text-cyan-800 font-medium">
                {block.text}
              </blockquote>
            );
            return <p key={index} className="text-sm leading-8">{block.text}</p>;
          })}
        </div>
      </section>

      {/* ====== 新手教程 ====== */}
      <section id="guide" className="panel-card p-6 sm:p-8">
        <p className="text-sm font-bold uppercase tracking-[0.28em] text-cyan-500">Beginner Guide</p>
        <h2 className="mt-2 text-2xl font-extrabold text-slate-900">新手也能看懂的上手教程</h2>
        <p className="mt-3 max-w-3xl text-sm leading-8 text-slate-600">
          照着下面 4 步做，就能把项目跑起来、看到 AIBuddy、并触发自动更新。
        </p>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <GuideCard step="01" title="先把项目跑起来" text="安装依赖后先启动本地开发服务器，确认页面能打开。" code="npm install\nnpm run dev" />
          <GuideCard step="02" title="准备数据" text="用种子数据可以先预览；要今天的真实数据就跑自动更新脚本。" code="npm run db:seed\n# 或者\nnpm run update:daily" />
          <GuideCard step="03" title="接入 AIBuddy" text="在 .env 里填好 SiliconFlow 密钥，右下角就能打开 AIBuddy 并切换模型。" code="SILICONFLOW_API_KEY=你的密钥\nSILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1" />
          <GuideCard step="04" title="每天自动更新" text="仓库 GitHub Actions 已配置每天早上 8 点自动执行。" code="GITHUB_TOKEN=可选\nSILICONFLOW_API_KEY=用于生成教程" />
        </div>
      </section>
    </div>
  );
}

// ====== InfoPanel ======
function InfoPanel({ eyebrow, title, body, footer, children }: {
  eyebrow: string; title: string; body: string; footer: string; children?: React.ReactNode;
}) {
  return (
    <div className="panel-card p-5 sm:p-6">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-500">{eyebrow}</p>
      <h2 className="mt-2 text-lg font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-7 text-slate-600">{body}</p>
      {children ? <div className="mt-4">{children}</div> : null}
      <p className="mt-4 text-xs leading-6 text-slate-400">{footer}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
    </div>
  );
}

function GuideCard({ step, title, text, code }: { step: string; title: string; text: string; code: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <div className="text-sm font-bold text-cyan-600">步骤 {step}</div>
      <h3 className="mt-2 text-lg font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-7 text-slate-600">{text}</p>
      <pre className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800 font-mono">
        <code>{code}</code>
      </pre>
    </div>
  );
}
