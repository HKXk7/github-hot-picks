# GitHub 热门项目推荐 —— 新手小白上手指南

> 这份教程假设你**几乎没接触过命令行**。每一步都会告诉你「要做什么」「为什么」「做完应该看到什么」。
> 全程照做，大约 15 分钟就能把整个项目跑起来，并看到 AI 小助手。

---

## 0. 这个项目是干什么的？

一句话：**每天自动去 GitHub 上挑出值得关注的新项目，写成一期推荐，放到一个漂亮的网页上，再配一个能陪你聊天、帮你解读项目的 AI 小助手，并且每个项目都有一篇 AI 写好的「小白教程」教你上手。**

它自动完成四件事：

1. **抓取** —— 每天从 GitHub 拉取最近新出的、有一定 star 的项目；
2. **筛选** —— 按规则打分、去重（同一位作者只推一个、推荐过的不再推），挑出最值得看的 10 个；
3. **生成** —— 写成一篇中文推荐稿（项目名、简介、star 数、推荐理由），并**给每个项目自动生成一篇「小白教程」**；
4. **展示** —— 渲染成网页，右下角还有一个「AI Buddy」可以追问，点项目卡片能看它的教程。

---

## 1. 你需要准备什么（环境）

先确认电脑里有没有这三样东西。打开终端（Windows 按 `Win` 键，输入 `cmd` 回车），逐条输入下面的命令：

```bash
node -v
npm -v
git --version
```

- `node -v` 能打印出 `v22.x.x` 就算合格（本项目用 Node 22 开发，建议 >= 18）。
- `npm -v` 能打印出版本号即可。
- `git --version` 能打印出版本号即可。

> 如果某条命令提示「不是内部或外部命令」，说明那件东西还没装。去官网下载安装：
> - Node.js（含 npm）：https://nodejs.org/zh-cn （下载 LTS 版，一路下一步）
> - Git：https://git-scm.com/downloads （一路下一步）
> 装完**重新开一个终端**再验证。

另外准备两个账号（都不是必须立刻有，用到那一步再注册也行）：

- **GitHub 账号**：https://github.com （用于让自动化定时任务跑起来）
- **硅基流动账号**：https://cloud.siliconflow.cn （用于 AI 小助手，有免费额度）

---

## 2. 第 1 步：拿到代码

在终端里进入你想放项目的目录，然后克隆（如果你已经有代码了，跳过这步直接看第 3 步）：

```bash
git clone https://github.com/你的用户名/github-hot-picks.git
cd github-hot-picks
```

> 如果你还没推到 GitHub、代码就在本机，直接在文件管理器里进入 `github-hot-picks` 文件夹，然后在终端里 `cd` 到它即可。

---

## 3. 第 2 步：安装依赖

在项目根目录（能看到 `package.json` 的地方）执行：

```bash
npm install
```

- **做什么**：把项目用到的所有「别人写好的工具包」下载下来。
- **预期结果**：出现一大串下载进度，最后没有红色 `error` 就算成功。会多出一个 `node_modules` 文件夹，正常。
- 第一次装可能要好几分钟，耐心等。

---

## 4. 第 3 步：配置环境变量（.env）

项目里有一个被忽略的文件 `.env`，用来存「密码、密钥」这类不能公开的东西。第一次拿到项目需要自己创建它。

**做法**：项目里已经放了一个模板 `.env.example`。把它复制一份，改名为 `.env`：

- 在文件管理器里：选中 `.env.example` → 复制 → 粘贴 → 改名为 `.env`
- 或者命令行（在项目根目录）：`cp .env.example .env`

然后**用记事本或编辑器打开 `.env`**，改两处：

```ini
# 1. 数据库路径：必须改成你机器上的「绝对路径」！
#    把下面这行改成你的实际路径，Windows 用正斜杠 /，例如：
DATABASE_URL="file:D:/你的实际路径/github-hot-picks/prisma/dev.db"

# 2. AI 密钥：去 https://cloud.siliconflow.cn 注册，在「API 密钥」里新建一个 key 粘进来
SILICONFLOW_API_KEY="sk-你的密钥"
```

> ⚠️ **为什么要绝对路径**（这是本项目最容易踩的坑）：
> `file:./dev.db` 这种「相对路径」，Prisma 命令行和网页运行时对它的理解不一样，会导致网页打不开数据库报错。所以务必写成 `file:D:/...` 这种完整的绝对路径。
>
> 怎么拿到绝对路径？在文件管理器地址栏点击 `github-hot-picks` 文件夹，地址栏显示的就是完整路径；Windows 下把反斜杠 `\` 换成正斜杠 `/` 即可。

---

## 5. 第 4 步：初始化数据库

数据库是个「文件」（`prisma/dev.db`），第一次要先建表。在项目根目录依次执行：

```bash
# ① 按迁移记录建出 4 张表（Repository / Article / Recommendation / JobRun）
npx prisma migrate deploy

# ② 可选：填一点「示例数据」，让你还没抓真实数据前也能预览页面
npx prisma db seed
```

- **做什么**：① 建表；② 塞进 8 个示例项目、1 篇示例稿，方便你预览。
- **预期结果**：两条命令都没有红色报错。② 结束会打印 `✅ 种子数据填充完成：8 个项目、1 篇稿子、5 条推荐`。

> 如果第 ① 步报错说找不到迁移文件，说明代码不完整；如果报「数据库不存在」，通常是 `.env` 里路径写错了，回到第 4 步检查。

---

## 6. 第 5 步：启动网站

```bash
npm run dev
```

- **预期结果**：终端出现 `Ready` 之类的字样，并提示访问 `http://localhost:3000`。
- 打开浏览器，输入 **http://localhost:3000** 回车。
- 你会看到一个深色、带渐变和卡片动画的页面，顶部写着「GitHub 热门项目推荐」，中间是「今天值得关注的项目」列表。

> 想停止网站：回到终端按 `Ctrl + C`。

---

## 7. 第 6 步：使用 AI 小助手

1. 看页面**右下角**，有一个带「AI」字样的圆形按钮，点它。
2. 会弹出一个聊天面板「GitHub Work Buddy」。
3. 面板顶部有**模型选择下拉框**，可以切换：
   - DeepSeek V4 Pro（综合强）
   - DeepSeek V4.1 Flash（快）
   - 智谱 GLM 5.3（中文好）
   - Kimi K2.6（助手）
4. 下面有几个「快捷问题」，点一下就能直接问；也可以自己在输入框打字，回车发送。

它会**带上今天这期推荐的内容**来回答你，所以你可以问：

- 「帮我总结今天最值得看的 3 个项目」
- 「哪个项目最适合新手练手？」
- 「这几个里哪些适合做 AI 工具？」

> ⚠️ 如果点开 AI 助手、发送后报错「未配置 SILICONFLOW_API_KEY」，说明第 4 步的密钥没填对（或没填）。填好 `.env` 后**重启** `npm run dev` 再试。

---

## 8. 第 7 步：看每个项目的小白教程

每个推荐项目卡片上都有一个 **「看小白教程」** 按钮（点项目名字也能看详情）。

1. 点任意一个项目的「看小白教程」。
2. 会弹出一个窗口，里面是 AI 专门为这个项目写的**新手教程**，固定四段：
   - **它是干什么的** —— 用大白话讲这个项目解决什么问题；
   - **怎么安装 / 快速开始** —— 一步步教你怎么跑起来；
   - **核心功能** —— 它最值得用的功能有哪些；
   - **适合谁 / 避坑** —— 谁适合用、新手常踩的坑。

> 这些教程是「一天一更」流程里，AI 自动生成的（和推荐稿一起）。所以你看教程前，需要先让项目有数据——要么跑过 `npm run update:daily`（见下一步），要么用种子数据（种子数据的示例项目教程可能为空）。

**想看以前某一天推荐了什么？** 点首页顶部的 **「📚 往期回顾」** 按钮（或直接访问 `http://localhost:3000/history`），会列出每一天的存档；点任意一期就能回看当天的全部项目和小白教程。

---

## 9. 第 8 步：手动更新一期真实数据

种子数据是「假的示例」。想看**今天从 GitHub 真实抓到的项目**，在项目根目录再开一个终端（网站可以继续跑着），执行：

```bash
npm run update:daily
```

- **做什么**：真实调用 GitHub 接口 → 抓最近 30 天新建、star>50 的项目 → 打分、去重、选 top 10 → **给每个项目调用 AI 生成小白教程** → 写进数据库 → 生成一个快照文件 `public/data/latest.json`。
- **预期结果**：打印 `✅ 已更新第 N 期（...），推荐 10 个项目，其中 10 个已生成教程`。
- 然后刷新浏览器 `http://localhost:3000`，就能看到真实项目了。

> 这一步需要联网访问 GitHub。如果提示「GitHub API 失败」，多半是网络或限流问题，等一会儿再跑一次即可。

---

## 10. 第 9 步：让它「每天自动更新」（部署自动化）

上面的「手动更新」要你自己敲命令。真正的「一天一更」靠 **GitHub Actions** 自动完成——它已经配好了，你只需要把代码推上去。

### 10.1 把代码推到 GitHub

```bash
git add .
git commit -m "初始化项目"
git branch -M main
git remote add origin https://github.com/你的用户名/github-hot-picks.git
git push -u origin main
```

> 如果 `git remote add` 报错说已存在，先 `git remote remove origin` 再执行。

### 10.2 它就会自动跑了

推到 GitHub 后，打开你的仓库页面 → 顶部点 **Actions** 标签页，能看到一个叫 **「Daily GitHub Hot Picks」** 的工作流：

- **每天北京时间 17:00 自动跑一次**：抓取 → 筛选 → AI 生成教程 → 生成 → 把快照提交回仓库。
- 也可以随时手动点 **「Run workflow」** 立即跑一次测试。

**（推荐）让云端也能生成小白教程**：打开仓库 → **Settings → Secrets and variables → Actions → New repository secret**，名字填 `SILICONFLOW_API_KEY`，值填你的硅基流动密钥。不配的话云端每天仍然会更新推荐，只是教程一栏会是空的（本地跑不受影响）。

> 本项目仓库已配好这个 Secret。云端跑一次约 **1 分 45 秒**，日志里会逐条打印 `✍️ 生成教程 1/10 …`，最后一行是`✅ 已更新第 N 期（…），推荐 10 个项目，其中 10 个已生成教程`——看到这个就说明云端链路是通的。

### 10.3（可选）在线部署让全世界都能看

代码推到 GitHub 后，可以用免费的 **Vercel** 一键部署（它专门为 Next.js 设计）：

1. 打开 https://vercel.com ，用 GitHub 账号登录；
2. 点「Add New → Project」，选中你的 `github-hot-picks` 仓库；
3. 一路点下一步，Vercel 会自动构建并给你一个 `https://xxx.vercel.app` 的网址。

部署后，因为每天的快照会提交回仓库，Vercel 会自动跟着更新，网页每天都是新的。

---

## 11. 常见问题排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 网页打开报 `Unable to open the database file` | `.env` 里数据库用了相对路径 | 改成绝对路径（见第 4 步），重启 `npm run dev` |
| AI 助手报「未配置 SILICONFLOW_API_KEY」 | 密钥没填 | 填 `.env` 后重启 |
| `prisma` 命令报 `No flag registered for --datasource-provider` | 用了最新版 Prisma | 本项目已锁 Prisma 6，用 `npx prisma` 即可，别用 `npx prisma@latest` |
| `npm run update:daily` 报「GitHub API 失败」 | 网络/限流 | 等几分钟重试 |
| 页面显示「还没有检测到推荐数据」 | 数据库是空的 | 先 `npx prisma db seed` 或 `npm run update:daily` |
| 点「看小白教程」弹出来是空的 | 该项目还没生成教程 | 跑一次 `npm run update:daily`（种子示例项目可能没有教程） |
| 改了 `.env` 网页没变化 | Next.js 不热加载环境变量 | 重启 `npm run dev` |

---

## 12. 附录：这个项目里有两套代码

你会在根目录看到两个「主体」，它们其实是**同一个项目的两代实现**：

| | 主项目（根目录） | 子项目 `github-hot-recommend/` |
|---|---|---|
| 是什么 | **新版**，你正在用的 | 旧版 MVP，最早用来验证跑通 |
| 技术 | Next.js 16 + Prisma 6 + SQLite | Express + better-sqlite3 |
| 能干什么 | 展示推荐 + AI 助手 + 每天自动更新 | 抓取 + 筛选 + 生成 Markdown 稿 |
| 怎么跑 | `npm run dev` | `cd github-hot-recommend && npm install && npm run build` |

**建议**：日常只看主项目（根目录）就够了。子项目是历史留档，想研究「抓取逻辑最早是怎么写的」再去看它。

---

## 13. 关键文件速查

```
github-hot-picks/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 首页（推荐列表 + 教程引导）
│   │   ├── layout.tsx            # 全局布局，挂载 AI 助手
│   │   └── api/chat/route.ts     # AI 问答接口（转发硅基流动）
│   ├── components/ChatAssistant.tsx  # 右下角 AI 助手浮窗
│   ├── components/ProjectTutorialModal.tsx  # 项目小白教程弹窗
│   └── lib/
│       ├── prisma.ts             # 数据库连接单例
│       └── site-data.ts          # 读最新一期推荐数据
├── scripts/update-daily.ts       # 「一天一更」核心管线（抓取→筛选→AI教程→入库→快照）
├── prisma/
│   ├── schema.prisma             # 4 张表的定义
│   └── seed.ts                   # 示例数据
├── .github/workflows/daily.yml   # GitHub Actions 每天定时任务
├── .env.example                  # 环境变量模板（复制成 .env）
└── public/data/latest.json       # 每天生成的推荐快照（会提交回仓库）
```

---

到这里，你就已经：把项目跑起来 → 看到推荐列表 → 用上 AI 助手 → 手动更新了一期真实数据 → 并让它可以每天自动更新。剩下就交给时间，每天打开网页看看今天推荐了什么即可。
