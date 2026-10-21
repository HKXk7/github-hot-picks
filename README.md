# GitHub 热门项目推荐（github-hot-picks）

每天自动从 GitHub 上挑选值得关注的新锐开源项目，生成一期中文推荐稿放到网页上，并给每个项目配一篇 AI 写的「小白教程」，外加一个能陪你聊天的 AI 助手。

> 这是一个「选品助手」：GitHub 上有几亿个仓库，好项目很容易被埋没。这个项目替你跑完「抓取 → 筛选 → 写稿 → 生成教程 → 展示」的全流程，把真正值得看的项目挑出来、写成推荐稿，再让 AI 帮你解读、教你怎么上手。

---

## 目录

- [项目介绍](#项目介绍)
- [项目亮点](#项目亮点)
- [技术栈](#技术栈)
- [本地开发环境搭建](#本地开发环境搭建)
- [使用说明](#使用说明)
- [数据模型](#数据模型)
- [目录结构](#目录结构)
- [常见问题](#常见问题)
- [License](#license)

---

## 项目介绍

一句话概括：**每天定时抓取 GitHub 新项目 → 按规则打分筛选 → 自动生成中文推荐稿 → AI 给每个项目写一篇小白教程 → 网页展示 + AI 问答助手**。

### 它做了哪些事

| 环节 | 做了什么 |
|------|---------|
| **抓取** | 调用 GitHub Search API，拉取最近 30 天新建、star > 50 的候选项目 |
| **筛选** | 按 star、活跃度、描述完整度等规则打分，并做「作者去重」和「历史去重」，避免霸榜或重复推荐 |
| **生成** | 选出 Top 10，写成 Markdown 推荐稿入库；同时生成静态快照 `public/data/latest.json` |
| **AI 教程** | 用大模型给每个项目写一篇「是什么 / 怎么装 / 核心功能 / 适合谁 + 避坑」的小白教程 |
| **展示** | 深色霓虹风格网页：今日焦点卡片、候选榜单、往期回顾、每期的推荐稿全文 |
| **AI 问答** | 右下角 AI Buddy，带着当天推荐内容回答你的提问，可切换模型 |

### 关键挑战与解法

| 挑战 | 对策 |
|------|------|
| 自动化 | 抓取 → 筛选 → 生成 → 入库 → 快照一条龙脚本，一条命令跑完 |
| 信息筛选 | 一套评分规则 + 作者去重 + 跨期历史去重，过滤水项目、重复推荐 |
| 定时执行 | GitHub Actions 每天云端自动触发，无需本机常开 |

---

## 项目亮点

- **全自动闭环**：从 GitHub 数据到一篇可读的推荐稿，一条命令跑通，无需手工干预。
- **每个项目都有「小白教程」**：教程分 4 段（是什么 / 怎么装 / 核心功能 / 适合谁 + 避坑），点卡片上的链接即可弹出阅读。
- **缺教程可「现场生成」**：早期推荐过的项目如果还没教程，卡片上会显示一个可点链接，点击后**当场用 AI 生成**并写回数据库；第二次再点就是秒开的缓存。
- **往期回顾**：`/history` 列出所有历史期号，点进去看当天完整榜单和推荐稿全文，每天自动多一期。
- **AI 助手带上下文**：不是裸聊天框，而是带着当天推荐数据的小助手，支持 4 个主流模型切换、流式输出、连续对话。
- **双数据源容灾**：前端优先读数据库，读不到时自动回退读已提交的快照文件，所以静态部署也能正常显示。
- **零配置数据库**：SQLite 单文件存储，不用装数据库服务，部署到云端定时任务也很省心。
- **新手友好**：技术选型（TypeScript + TailwindCSS + Prisma + SQLite）都是主流且易上手的组合，另有 14 节的大白话教程。

---

## 技术栈

### 主项目（仓库根目录）

| 类别 | 技术 | 版本 |
|------|------|------|
| 前端框架 | Next.js（App Router + React Server Components） | 16.4.2 |
| UI 库 | React | 19.3.0 |
| 语言 | TypeScript（strict） | 5.x |
| 样式 | TailwindCSS | 4.x |
| ORM | Prisma | 6.19.3 |
| 数据库 | SQLite | — |
| 脚本运行 | tsx | 4.x |
| AI 接口 | 硅基流动 SiliconFlow（OpenAI 兼容协议） | — |

> ⚠️ **Prisma 必须锁 6**：安装时用 `prisma@6` + `@prisma/client@6`。直接 `npx prisma` 不带版本会拿到 v8，导致 `--datasource-provider` 等参数报 `No flag registered`。

### 子项目（`github-hot-recommend/`，早期 MVP）

| 类别 | 技术 |
|------|------|
| 服务端 | Express 4 |
| 数据库 | better-sqlite3 11 |
| 运行 | tsx |

---

## 本地开发环境搭建

### 1. 环境要求

- **Node.js** ≥ 20.9（推荐 22，本项目与 CI 均使用 Node 22）
- **npm**（随 Node 一起安装）
- **无需安装数据库**（SQLite 就是一个文件）

```bash
node -v   # 应 ≥ 20.9
npm -v
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制模板并填写：

```bash
cp .env.example .env
```

`.env` 里有两个变量：

```env
# ⚠️ 必须是「绝对路径」，不能写成 file:./dev.db
DATABASE_URL="file:D:/你的路径/github-hot-picks/prisma/dev.db"

# AI 功能用的密钥（硅基流动），不配的话推荐流程照常跑，只是不生成教程、AI 助手不可用
SILICONFLOW_API_KEY="sk-你的密钥"
SILICONFLOW_BASE_URL="https://api.siliconflow.cn/v1"
```

> **为什么 DATABASE_URL 必须绝对路径？**
> Prisma 命令行（migrate / seed）相对 `prisma/` 目录解析相对路径，而 Next.js 运行时相对**项目根目录**解析，两边不一致会报 `Error code 14: Unable to open the database file`。Windows 请用正斜杠，例如 `D:/.../prisma/dev.db`。

> `.env` 已被 `.gitignore` 忽略，不会提交。**改完 `.env` 要重启 dev server 才生效**（Next.js 不热加载环境变量）。

> `SILICONFLOW_API_KEY` 在 [硅基流动](https://cloud.siliconflow.cn/) 申请，新建后粘过去即可。

### 4. 初始化数据库

迁移记录已经提交在仓库里，新机器直接应用即可：

```bash
# 应用已有迁移，建表
npx prisma migrate deploy

# 重新生成 Prisma 客户端（首次拉代码后建议跑一次）
npx prisma generate

# 可选：填充种子数据，方便先看到页面效果
npm run db:seed
```

如果你改了 `prisma/schema.prisma`，则用下面这条生成新迁移（会一并重生成客户端）：

```bash
npx prisma migrate dev --name 你的改动名
```

> ⚠️ **改了 schema 后重生成客户端，要先停掉 dev server**。运行中的 Next.js 会锁住 `query_engine-windows.dll.node`，导致 `npx prisma generate` 报 EPERM。

### 5. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)，就能看到最新一期推荐。

> 数据库还是空的？跑一条 `npm run update:daily` 拉取今天的真实数据，或 `npm run db:seed` 灌入示例数据。

---

## 使用说明

### 页面导览

| 路径 | 说明 |
|------|------|
| `/` | 首页：今日焦点项目 + 候选榜单 + 本期推荐稿全文 + 新手指引区块 |
| `/history` | 往期列表：每一期一张卡片（期号、日期、项目数、合计 Star） |
| `/history/<日期>` | 往期详情：日期形如 `2026-10-21`，看当天完整榜单和稿子原文 |
| 右下角浮窗 | AI Buddy：带当天推荐上下文的问答助手，可切模型 |

小白教程的入口在每个项目卡片底部：

- 已有教程 → 按钮显示「📖 小白上手此项目保姆级教程」，点击弹窗阅读；
- 还没有教程 → 显示绿色链接「✨ 小白上手此项目保姆级教程 →」，点击即时生成（约 7 秒）并自动弹窗。

### 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动开发服务器（热更新） |
| `npm run build` | 生产构建 |
| `npm run start` | 生产模式启动（需先 build） |
| `npm run lint` | 运行 ESLint 检查 |
| `npm run update:daily` | 手动跑一次完整流程（抓取 → 筛选 → AI 生成教程 → 入库 → 写快照） |
| `npm run db:seed` | 填充种子数据 |

### Prisma 命令

| 命令 | 作用 |
|------|------|
| `npx prisma migrate deploy` | 应用已有迁移（新机器 / CI 用） |
| `npx prisma migrate dev --name <名字>` | 改了 schema 后创建并应用新迁移 |
| `npx prisma generate` | 重新生成 Prisma 客户端（改 schema 后必跑，需先停 dev server） |
| `npx prisma db seed` | 填充种子数据 |
| `npx prisma studio` | 打开数据库可视化界面 |

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | AI 问答代理，转发到硅基流动，流式返回；参数 `{ messages, model }` |
| POST | `/api/tutorial` | 教程即时生成；参数 `{ fullName }`，已有教程直接返回（`cached: true`） |

### 每天自动更新（GitHub Actions）

`.github/workflows/daily.yml` 已经在仓库里，**每天北京时间 17:00** 自动跑一次：安装依赖 → 应用迁移 → 跑更新脚本 → 把生成的数据快照提交回仓库。也可以在 GitHub 仓库页面的 Actions 里手动点「Run workflow」立即触发。

推送到 GitHub 后，如果希望云端也生成 AI 教程，需要在仓库 **Settings → Secrets and variables → Actions** 里添加一个 Secret：

| Secret 名 | 值 |
|-----------|-----|
| `SILICONFLOW_API_KEY` | 你的硅基流动密钥 |

不配也没关系：推荐流水线照常跑，只是文章里不会有 AI 教程（本地因为有 `.env`，不受影响）。

---

## 数据模型

`prisma/schema.prisma` 里定义了 4 张表：

| 模型 | 关键字段 | 作用 |
|------|---------|------|
| `Repository` | `fullName`、`stars`、`language`、`tutorial` | 抓取到的 GitHub 项目；`tutorial` 存 AI 生成的小白教程 |
| `Article` | `issue`、`title`、`content`、`weekStart` | 每天一期的推荐稿 |
| `Recommendation` | `sortOrder`、`reason`、`category` | 稿子 ↔ 项目的多对多关系（兼带排名和推荐理由） |
| `JobRun` | `jobType`、`status`、`startedAt` | 定时任务运行记录，用于展示自动化状态 |

---

## 目录结构

```
github-hot-picks/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # 首页（焦点卡片 + 榜单 + 推荐稿全文）
│   │   ├── layout.tsx                # 全局布局
│   │   ├── globals.css               # 三色霓虹主题样式
│   │   ├── history/page.tsx          # 往期列表页
│   │   ├── history/[date]/page.tsx   # 往期详情页
│   │   └── api/
│   │       ├── chat/route.ts         # AI 问答接口（多模型流式）
│   │       └── tutorial/route.ts     # 小白教程即时生成接口
│   ├── components/
│   │   ├── ChatAssistant.tsx         # 右下角 AI 助手浮窗
│   │   └── ProjectTutorialModal.tsx  # 小白教程弹窗（含即时生成按钮）
│   └── lib/
│       ├── prisma.ts                 # PrismaClient 单例
│       ├── site-data.ts              # 读推荐数据（优先 DB、回退快照）
│       └── format.ts                 # 语言配色、Star 格式化、稿子解析
├── scripts/update-daily.ts           # 「一天一更」核心管线
├── public/data/latest.json           # 生成的推荐快照（会提交回仓库）
├── prisma/
│   ├── schema.prisma                 # 数据模型（4 张表）
│   ├── migrations/                   # 迁移记录
│   ├── seed.ts                       # 种子数据
│   └── dev.db                        # SQLite 数据库文件（不提交）
├── generated/prisma/                 # Prisma 生成的客户端（勿手改）
├── .github/workflows/daily.yml       # 每天定时任务
├── .env.example                      # 环境变量模板
├── PRD.md                            # 方案与计划文档
├── TUTORIAL.md                       # 给新手的 14 节上手指南
├── CLAUDE.md                         # 给 AI 助手的项目说明书
└── github-hot-recommend/             # Express 版 MVP（独立子项目）
```

---

## 常见问题

| 现象 | 原因与解法 |
|------|-----------|
| `Error code 14: Unable to open the database file` | `DATABASE_URL` 用了相对路径，改成绝对路径见上文第 3 步 |
| 页面显示「还没有检测到推荐数据」 | 数据库是空的，跑 `npm run update:daily` 或 `npm run db:seed` |
| AI 助手回复「未配置 SILICONFLOW_API_KEY」 | `.env` 里没填密钥或填错，**重启** dev server 再试 |
| `npx prisma generate` 报 EPERM | dev server 正锁着引擎 dll，先停止服务再生成 |
| `No flag registered` / `--datasource-provider` 报错 | Prisma 版本不对（装成了 v8），安装时锁 6：`prisma@6` + `@prisma/client@6` |
| `Unknown argument 'xxx'`（刚加的字段） | 改完 schema 没重生成客户端，停掉 dev server 跑 `npx prisma generate` |
| build 时提示 `dynamic = "force-dynamic"` 不兼容 | 本项目的 Next.js 配置里开了 `cacheComponents`，不要声明这个导出；动态数据用 `<Suspense>` 包裹即可 |

---

## 两套实现说明

仓库里有**两套实现并存**，注意区分，日常开发改动都在根目录下：

| 目录 | 技术栈 | 状态 |
|------|--------|------|
| 根目录 `/` | Next.js 16 + Prisma 6 + TailwindCSS 4 | 主项目（首页 + 往期 + AI 助手 + 小白教程 + 每天自动更新） |
| `github-hot-recommend/` | Express 4 + better-sqlite3 11 | 早期跑通的 MVP，只在本地手动跑出 Markdown 稿时用 |

子项目用法（可选）：

```bash
cd github-hot-recommend
npm install
npm run build      # 抓取 + 筛选 + 生成一期推荐稿（Markdown）
npm run serve      # 启动 API + 网页
npm run typecheck  # 类型检查
```

---

## License

本项目采用 **MIT License**，完整许可条款见仓库中的 [LICENSE](./LICENSE) 文件。

```
MIT License

Copyright (c) 2026 Kora Xael

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
