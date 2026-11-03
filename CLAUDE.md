# CLAUDE.md

本文件是给 Claude Code（以及项目里其他 AI 助手）看的项目说明书。**改代码前先读这里。**

## 项目概述

**GitHub 热门项目推荐** —— 每天自动从 GitHub 挑选值得关注的新锐开源项目，生成一篇中文推荐稿、给每个项目配一篇 AI 生成的「小白教程」，并放到网页上展示（右下角还有 AI 问答助手）。

目录里**两套实现并存**，别改错地方：

| 目录 | 技术栈 | 状态 |
|------|--------|------|
| 根目录 `/` | Next.js 16 + Prisma 6 + TailwindCSS 4 | 主项目，首页 + AI 助手 + 小白教程 + 每天自动更新（已完成） |
| `github-hot-recommend/` | Express 4 + better-sqlite3 11 + tsx | 已跑通的 MVP（抓取/筛选/生成/网页/SQLite 全流程，已接去重） |

## 技术栈

- **前端**：Next.js 16.4.2（App Router）+ React 19.3 + TypeScript 5（strict）
- **样式**：TailwindCSS 4（走 `@tailwindcss/turbopack`，用 `@import "tailwindcss"` + `@theme` 语法，**不是** v3 的 `tailwind.config.js`）
- **数据库/ORM**：Prisma 6.19.3 + SQLite
- **其它**：bcryptjs（密码哈希，预留）
- **子项目**：Express 4 + better-sqlite3 11（原生模块，Node 22 下 prebuild 免编译）

## 常用命令

### 主项目（在根目录运行）

```bash
npm run dev        # 启动 Next.js 开发服务器 → http://localhost:3000
npm run build      # 生产构建
npm run start      # 生产启动
npm run lint       # ESLint
npm test           # vitest 单测（176 项）
npm run update:daily   # 手动跑「抓取→筛选→AI教程→入库→快照→订阅源」全流程
npm run eval       # 教程质量评测（真调模型，花钱）；--gate 卡质量、--limit/--mode/--concurrency/--judge
npm run data:static # 从数据库回填静态数据包（history.json + issues/*.json），部署前跑
npm run usage      # LLM 用量报告（与站内 /usage 看板同一套口径）
npm run db:seed        # 填充种子数据（等同 npx prisma db seed）

# Prisma
npx prisma migrate dev --name <名字>   # 创建并应用数据库迁移
npx prisma generate                    # 重新生成 Prisma 客户端
npx prisma db seed                     # 填充种子数据（跑 prisma/seed.ts）
npx prisma studio                      # 打开数据库可视化界面
```

### 子项目 github-hot-recommend/（先进该目录）

```bash
npm run build      # 抓取 + 筛选 + 生成一期推荐稿（含历史去重，写 recommended.json）
npm run fetch      # 只抓取候选项目并打印（调试）
npm run serve      # 启动 API + 网页 → http://localhost:3000
npm run dev        # 启动服务（改动自动重启）
npm run typecheck  # 类型检查
```

## 目录结构

```
github-hot-picks/
├── src/app/
│   ├── page.tsx          # 首页（焦点卡 + 榜单 + 推荐稿全文）
│   ├── history/          # 往期列表 + 往期详情 [date]
│   ├── usage/page.tsx    # 成本看板（需 USAGE_PAGE_TOKEN，由 src/proxy.ts 保护）
│   ├── sitemap.ts / robots.ts / not-found.tsx / loading.tsx / feed.xml 静态文件
│   └── api/              # chat（流式问答）/ tutorial（教程即时生成）
├── src/proxy.ts          # Next 16 里取代 middleware.ts 的约定，目前只守 /usage
├── src/components/       # ChatAssistant / ProjectTutorialModal / PicksExplorer（搜索筛选）
├── src/lib/
│   ├── prisma.ts         # PrismaClient 单例
│   ├── site-data.ts      # 读推荐数据（优先 DB、失败回退快照）
│   ├── site-url.ts       # 站点绝对地址（sitemap / RSS / OG 用）
│   ├── pipeline/         # report（每期成败报告）/ retry（跨期补做教程）/ feed（RSS）
│   ├── eval/             # 评测：run / scorers / judge / gate（门禁阈值）
│   └── ai/               # llm / agent / planner / sanitize / usage / usage-stats …
├── scripts/update-daily.ts  # 「一天一更」核心管线（抓取→筛选→AI教程→入库→快照→订阅源）
├── public/               # 静态资源 + data/latest.json 与 feed.xml（**机器每天写的，别手改**）
├── prisma/
│   ├── schema.prisma     # 数据模型：8 张表（见下）
│   ├── migrations/       # 迁移记录（init → … → add_tutorial_failure_tracking）
│   ├── seed.ts           # 种子数据脚本（8 项目 + 1 稿 + 5 推荐）
│   └── dev.db            # SQLite 数据库文件（已被 .gitignore 忽略）
├── generated/prisma/     # Prisma 生成的客户端（勿手改，已 gitignore）
├── prisma.config.ts      # Prisma 配置（schema 路径、迁移、datasource url）
├── next.config.ts        # Next.js 配置（cacheComponents + partialPrefetching 开启）
├── tsconfig.json         # 路径别名 @/* → src/*
├── .github/workflows/daily.yml  # GitHub Actions 每天定时跑主项目管线
├── .env.example          # 环境变量模板（DATABASE_URL 绝对路径 + SILICONFLOW_API_KEY）
├── PRD.md                # 方案与计划文档
├── TUTORIAL.md           # 给新手的 12 步上手指南
├── CLAUDE.md             # 本文件
└── github-hot-recommend/ # Express 版 MVP（独立子项目，有自己的 package.json）
```

## 关键文件

- `prisma/schema.prisma` —— **8 张表**：`Repository`（项目，含 `tutorial` 结构化教程 + `tutorialError`/`tutorialAttempts`/`tutorialFailedAt` 失败追踪）、`Article`（每天推荐稿）、`Recommendation`（稿子↔项目多对多）、`JobRun`（运行记录，`log` 里是每期成败报告）、`KnowledgeChunk`（RAG 切片）、`LlmCall`（每次模型调用的用量/耗时）、`ChatSession` + `ChatMessage`（AI Buddy 会话）。
- `prisma/seed.ts` —— 种子数据，从 `../generated/prisma/client` 导入（**不是** `@prisma/client`）。
- `src/lib/prisma.ts` —— PrismaClient 单例，从 `../../generated/prisma/client` 导入。
- `src/lib/site-data.ts` —— `getLatestSiteIssue()` 优先读 Prisma、失败回退读 `public/data/latest.json` 快照（静态部署也能显示最新推荐）。`SitePick` 接口含 `tutorial` 字段。另有 `getIssueList()`（所有期列表）和 `getIssueByDate(dateKey)`（按 YYYY-MM-DD 取某一期），供往期页使用。
- `src/lib/format.ts` —— 首页与往期页共用的展示工具：语言配色（`langStyle`）、star 格式化、Markdown 稿解析（`parseContent`）。
- `src/app/page.tsx` —— 首页，从数据库读最新一期 Article + 推荐项目渲染（Suspense + 静态外壳）。卡片上有「看小白教程」按钮，点开 `ProjectTutorialModal`；按钮区有「📚 往期回顾」入口。
- `src/app/history/page.tsx` —— 往期推荐列表页（期号、日期、项目数、合计 star）。
- `src/app/history/[date]/page.tsx` —— 某一期详情页（Next.js 16 里 `params` 是 Promise，要 `await params`）。
- `src/app/api/chat/route.ts` —— AI 问答接口，转发硅基流动（`SILICONFLOW_API_KEY`，4 个模型：DeepSeek-V4-Pro / DeepSeek-V4.1-Flash / GLM-5.3 / Kimi-K2.6）。
- `src/components/ChatAssistant.tsx` —— 右下角 AI Buddy 浮窗（模型切换 + 流式）。
- `src/components/ProjectTutorialModal.tsx` —— 项目小白教程弹窗（轻量 Markdown 渲染）。
- `scripts/update-daily.ts` —— **一天一更核心管线**：抓 GitHub → 筛选 → 给每个项目调 `generateTutorial()` 生成教程 → 写 Prisma → 生成 `public/data/latest.json` 快照。教程幂等（`repository.tutorial` 已存在就复用）。
- `github-hot-recommend/src/filter.ts` —— 旧版推荐评分逻辑（`scoreRepo`，含作者去重 + 历史去重），改推荐规则看这里。
- `github-hot-recommend/src/history.ts` —— 历史去重：读写 `data/recommended.json`。
- `.github/workflows/daily.yml` —— 每天（cron `0 9 * * *`，北京时间约 17:00）自动跑主项目管线并提交快照回仓库。

## 约定与注意事项（重点）

1. **Prisma 版本要锁 6**：`prisma@6` + `@prisma/client@6`。直接 `npx prisma` 不带版本会拿到 v8，导致 `--datasource-provider` 等参数报 `No flag registered`。
2. **Prisma 客户端生成位置**：schema 用 `provider = "prisma-client"` + `output = "../generated/prisma"`，类型化客户端在 `generated/prisma/`。所有业务代码（`seed.ts`、`src/lib/prisma.ts`）都应从 `../generated/prisma/client` 或 `../../generated/prisma/client` 导入，**不要用 `@prisma/client`**。
3. **DATABASE_URL 用绝对路径**：`.env` 里必须是 `file:D:/ai-coding-projects/github-hot-picks/prisma/dev.db` 这种绝对路径。相对路径 `file:./dev.db` 在 CLI 相对 `prisma/` 解析、Next.js 运行时相对项目根解析，两边不一致会报 `Error code 14: Unable to open the database file`。
4. **Next.js 16 踩坑**：
   - `next.config.ts` 开了 `cacheComponents`，**不能用** `export const dynamic = "force-dynamic"`，也**不能用** `export const revalidate`（两个都会让 build 直接报错）。
   - 动态数据（DB 查询）必须包在 `<Suspense fallback={...}>` 里，否则 build 报 "uncached data during prerendering"。正确形态是「静态外壳 + Suspense 包异步组件」，最终 `◐` Partial Prerender。
   - 确实需要「按请求生成」的路由（`sitemap.ts`、`/usage`、首页 `RecommendationSection`、往期列表 `IssueList`）在函数开头 `await connection()`；同理，读当前时间（`Date.now()`）在预渲染期会被拦，必须先 `await connection()`。
   - ⚠️ **光有 `<Suspense>` 不等于按请求渲染**：Next 会在构建期把 Suspense 里的异步组件解析完、整页标成 `○`。想让运行时数据生效（部署版每天同步最新快照），必须显式 `await connection()`，让路由变成 `◐`。
   - 站点在无数据库环境靠 `public/data/` 静态包运行：`latest.json` / `history.json` / `issues/<date>.json`。查询「成功但返回空数组」也要回退，空库不会抛异常。`SITE_SNAPSHOT_BASE` 配置后按 10 分钟 TTL 从 GitHub 拉最新数据。
   - `middleware.ts` 已废弃，改用 **`src/proxy.ts`**（`export default function proxy()`）；两个文件同时存在会报错。
   - 改 `.env` 后 dev 服务要**重启**才生效。
5. **路径别名**：`@/` 指向 `src/`。
6. **两个数据库**：主项目 `prisma/dev.db`；子项目 `github-hot-recommend/data/app.db`（互不相干）。两个 `.db` 都被 gitignore。
7. **`.env` 有 `DATABASE_URL`**，不要提交到 git（.gitignore 已忽略 `.env*`）。
8. **子项目存档规则**：`github-hot-recommend/data/` 下只提交 `*.md`（每天稿）和 `recommended.json`（去重历史），`app.db*` 不提交（子项目 .gitignore 已配置）。
9. **小白教程生成**：`Repository.tutorial` 字段存 AI 生成的 Markdown 教程，由 `scripts/update-daily.ts` 里的 `generateTutorial()` 调用硅基流动生成（4 段式：是什么/怎么装/核心功能/适合谁+避坑）。幂等策略：入库前若 `repository.tutorial` 已非空则跳过，避免重复花钱调 API。前端通过 `site-data.ts` 的 `SitePick.tutorial` 透传，卡片点「看小白教程」弹 `ProjectTutorialModal`。
10. **⚠️ 并行冲突风险**：用户编辑器里可能还有另一个 AI 助手在同时改文件，动手前先核对当前文件状态，避免互相覆盖。
11. **机器每天会写两个文件**：`public/data/latest.json`（推荐快照）和 `public/feed.xml`（RSS）由日更任务生成并由 Actions 提交回仓库。**不要手改**，第二天会被覆盖。
12. **git push 到 github.com 不通**（连接被 reset），但 `api.github.com` 正常。推送用 `scripts/push-via-api.mjs`（`GH_BASE=<远端 sha>` + `GH_LOCAL_BASE=<本地 sha>`）；推送前记得先把远端更新的 `public/data/latest.json` 拉回来，否则会把云端数据推成旧版本。
