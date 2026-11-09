import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PrismaClient } from "../generated/prisma/client";
// 注意用相对路径：本文件由 tsx 直接执行，@/* 别名不保证生效
import {
  generateStructuredTutorial,
  hasApiKey,
  type GenerationMode,
  type TutorialMeta,
} from "../src/lib/tutorial/generate";
import { parseStructuredTutorial, toTutorialMarkdown } from "../src/lib/tutorial/schema";
import { attachEvidence } from "../src/lib/tutorial/evidence";
// 副作用导入：把 LLM 用量接到数据库上。少了这一行，跑完只知道「生成了」，
// 不知道花了多少 token、哪一步慢。
import "../src/lib/ai/observability";
// 分类规则抽成纯函数（src/lib/picks.ts）：分类贴错了不会报错，只会安静地别扭一整期，
// 所以要能被单测覆盖；放在脚本里就没法测（import 本文件会直接跑起整条管线）。
import { categorize } from "../src/lib/picks";
// 跑完的报告抽成纯函数模块：报告写错不会报错，只会让人看不见问题
import { buildRunReport, formatRunReport, formatRunReportMarkdown } from "../src/lib/pipeline/report";
import type { RetryOutcome, StepOutcome } from "../src/lib/pipeline/report";
import { retryMissingTutorials } from "../src/lib/pipeline/retry";
import { indexHistory, selectFresh } from "../src/lib/pipeline/candidates";
import { buildRssFeed } from "../src/lib/pipeline/feed";
import { writeStaticSiteData } from "../src/lib/pipeline/static-data";
import { buildKnowledgeIndex } from "../src/lib/rag/index-store";

const prisma = new PrismaClient();

/**
 * 教程生成模式。日更管线默认走 tools（先取证再动笔），设 TUTORIAL_MODE=plain 可降级。
 *
 * 为什么管线用 tools 而前端点击用 plain：管线每天只跑一次、10 个项目合计多花约 2 分钟，
 * 没人会感知这点延迟；而教程一旦写出不存在的安装命令，是直接坑到读者的硬错误。
 * 前端是人在屏幕前等，22 秒体验很差，那边保留快的单轮（见 api/tutorial/route.ts）。
 *
 * 2026-10-29 分层随机评测（8 个样本×2 模式，data/eval/latest.json）：
 *   plain  1.50 条命令 / 8.3s  / 0 次工具调用 / 37.5% 的样本给出可核验命令
 *   tools  2.25 条命令 / 22.1s / 6.9 次工具调用 / 62.5% 的样本给出可核验命令
 * 「可核验命令」指命令里的包名能在 npm / PyPI / crates.io 上查到——这是本项目要防的头号问题，
 * 两版编造率都是 0%，但 tools 能给出可核验命令的项目数多了近七成。
 */
const tutorialMode: GenerationMode = process.env.TUTORIAL_MODE === "plain" ? "plain" : "tools";

/**
 * 站点对外地址，写进 RSS 和 sitemap 的绝对链接里。
 * 没配就退回 localhost：宁可链接是错的（一眼能看出来），
 * 也不要因为环境变量缺失让整轮跑挂 —— 订阅源和数据库不是一回事。
 */
const SITE_URL = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";


// ================= 类型 =================
interface RawRepo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  archived: boolean;
  fork: boolean;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

interface ScoredRepo extends RawRepo {
  owner: string;
  score: number;
  reasons: string[];
}

// ================= 抓取 =================
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

async function fetchCandidates(): Promise<RawRepo[]> {
  const q = `created:>${daysAgo(30)} stars:>50`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    q,
  )}&sort=stars&order=desc&per_page=100`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "github-hot-picks",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API 失败（${res.status}）：${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { items: RawRepo[] };
  return data.items.filter((r) => !r.fork && !r.archived);
}

// ================= 筛选 =================
function daysSince(d: string | null): number {
  if (!d) return 999;
  return (Date.now() - new Date(d).getTime()) / 86400000;
}

function scoreRepo(r: RawRepo): ScoredRepo {
  const reasons: string[] = [];
  let score = Math.log10(r.stargazers_count + 1) * 4;
  if (daysSince(r.pushed_at) <= 14) {
    score += 2;
    reasons.push("最近仍在活跃更新");
  }
  if (r.description && r.description.length > 10) score += 1.5;
  else score -= 1;
  if (r.homepage) {
    score += 1;
    reasons.push("有完整官网");
  }
  if ((r.topics ?? []).length >= 3) score += 1;
  if (r.language) score += 0.5;
  const age = daysSince(r.created_at);
  if (age <= 7) score += 2;
  else if (age <= 30) score += 1;
  if (r.stargazers_count >= 500) {
    score += 2;
    reasons.push("短时间收获大量 star");
  }
  return {
    ...r,
    owner: r.full_name.split("/")[0] ?? "",
    score: Math.round(score * 10) / 10,
    reasons,
  };
}

/**
 * 本期候选里挑出前 n 个。
 * 历史去重已在上游用 selectFresh（按 fullName + githubId）做完，
 * 这里只负责打分和「同一作者最多一个」。
 */
function filterTop(repos: RawRepo[], n: number): ScoredRepo[] {
  const seenOwner = new Set<string>();
  return repos
    .map(scoreRepo)
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      // 每位作者最多推荐一个，避免同一作者的系列项目霸榜
      if (seenOwner.has(r.owner)) return false;
      seenOwner.add(r.owner);
      return true;
    })
    .slice(0, n);
}


// ================= AI 生成小白教程 =================
// 生成逻辑已抽到共享模块，scripts 与 API 路由共用同一份，避免 prompt 两边不同步：
//   src/lib/tutorial/generate.ts —— prompt 构建 + 调用 + 容错解析 + 校验重试
//   src/lib/tutorial/schema.ts   —— Zod schema + Markdown 渲染
// 数据库里存的是结构化 JSON 字符串，旧版 Markdown 数据可共存（靠能否 parse 区分）。

function toTutorialMeta(r: ScoredRepo): TutorialMeta {
  return {
    fullName: r.full_name,
    description: r.description,
    language: r.language,
    stars: r.stargazers_count,
    topics: r.topics ?? [],
    homepage: r.homepage,
  };
}

// 把教程嵌入每期 Markdown 稿：教程内部的 ## 降级为 ###，避免和项目标题层级冲突
function renderTutorialInContent(tutorial: string | null): string {
  if (!tutorial) return "";
  const indented = tutorial
    .split("\n")
    .map((line) => (line.startsWith("## ") ? `### ${line.slice(3)}` : line))
    .join("\n");
  return `\n**📖 小白教程**\n\n${indented}`;
}

// ================= 日期工具（统一用中国时区） =================
function dayKeyOf(d: Date | string): string {
  return new Date(d).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}
function todayKey(): string {
  return dayKeyOf(new Date());
}
function zhDate(): string {
  return new Date().toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
  });
}

/**
 * 把项目写进库：已有记录就更新，没有才新建。
 *
 * 为什么不用 `upsert({ where: { fullName } })`：作者改名后 fullName 变了、githubId 没变，
 * upsert 会判断成「新记录」走 create 分支，撞上 githubId 唯一约束抛 P2002 —— 而在改成
 * 逐项兜底之前，这一下就能让整轮日更 exit 1（一期都不出）。
 * 所以先按两个维度找一次：找到就按主键更新，并把 fullName / githubId 一起刷新成 GitHub 上的当前值。
 */
async function saveRepository(
  r: ScoredRepo,
  existing: { id: string } | null,
  tutorial: string | null,
  failure: { tutorialError: string; tutorialFailedAt: Date } | null,
) {
  const shared = {
    name: r.name,
    description: r.description,
    url: r.html_url,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    fetchedAt: new Date(),
  };

  if (existing) {
    await prisma.repository.update({
      where: { id: existing.id },
      data: {
        ...shared,
        fullName: r.full_name,
        githubId: r.id,
        // 有教程就顺手清掉历史失败记录：这一项的语义是「当前缺教程的原因」
        ...(tutorial ? { tutorial, tutorialError: null, tutorialFailedAt: null } : {}),
        // 失败则记下原因并把跨期尝试次数 +1，供下期补做时挑出它
        ...(failure ? { ...failure, tutorialAttempts: { increment: 1 } } : {}),
      },
    });
    return;
  }

  await prisma.repository.create({
    data: {
      ...shared,
      githubId: r.id,
      fullName: r.full_name,
      ...(tutorial ? { tutorial } : {}),
      ...(failure ? { ...failure, tutorialAttempts: 1 } : {}),
    },
  });
}

// ================= 主流程 =================
async function main() {
  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: { jobType: "daily-update", status: "running", startedAt },
  });

  try {
    const repos = await fetchCandidates();

    // 历史去重：排除以前推荐过的项目。fullName 和 githubId 两个维度都要看 ——
    // 作者改名后名字变了、id 没变，只按名字去重会让它重新上榜，
    // 随后 upsert 撞上 githubId 唯一约束，整轮日更失败（见 pipeline/candidates.ts）。
    const historyRows = await prisma.repository.findMany({
      where: { recommendations: { some: {} } },
      select: { fullName: true, githubId: true },
    });
    const top = filterTop(selectFresh(repos, indexHistory(historyRows)), 10);
    if (top.length === 0) {
      throw new Error("没有筛选出任何项目，请稍后重试或调低 star 门槛");
    }

    // 期号：今天已出过则复用，否则 +1
    const latest = await prisma.article.findFirst({ orderBy: { issue: "desc" } });
    const reuseToday = latest && dayKeyOf(latest.weekStart) === todayKey();
    const issue = reuseToday ? latest.issue : (latest?.issue ?? 0) + 1;

    const title = `${zhDate()} · GitHub 热门项目推荐`;
    const summary = `今天从 GitHub 新项目中挑选出 ${top.length} 个值得关注的项目，涵盖不同领域，每个项目都附有一份小白也能看懂的上手教程。`;

    // 逐个项目：生成/复用教程 → 入库（先不建推荐关系，等 article 建好）
    const picks: {
      rank: number;
      fullName: string;
      name: string;
      description: string | null;
      url: string;
      language: string | null;
      stars: number;
      forks: number;
      category: string;
      reason: string;
      tutorial: string | null;
    }[] = [];
    // 本期每个项目的教程结果，跑完汇总成报告 ——
    // 之前失败只打一行 warn，10 个项目里挂 1 个照样打印「✅ 已更新第 N 期」
    const steps: StepOutcome[] = [];

    for (let i = 0; i < top.length; i++) {
      const r = top[i];

      // 一个项目的意外不该带走整期：这段里的任何一次抛错（改名撞唯一约束、
      // 一次写库失败、工具/模型返回意料之外的结构）以前都会冒到最外层，
      // 日更 exit 1，稿子 / 快照 / RSS 一个都不落盘 —— 表现出来就是「今天没更新」。
      // 现在只把这个项目标成 failed 记进报告，剩下的项目照常跑。
      let tutorial: string | null = null;
      try {
        // 已有教程则复用（避免重复调用 AI、保持幂等），否则生成。
        // 同时按 fullName 和 githubId 查：从快照导入的记录里 githubId 是拿全名哈希出来的假值，
        // 只按 id 查会查不到（教程每天重生成、白花钱）；而仓库改名后只按名字也查不到。
        const existing = await prisma.repository.findFirst({
          where: { OR: [{ fullName: r.full_name }, { githubId: r.id }] },
        });
        tutorial = existing?.tutorial ?? null;
        // 生成失败时要写回库的字段（成功则清空）
        let failure: { tutorialError: string; tutorialFailedAt: Date } | null = null;

        if (!tutorial) {
          if (!hasApiKey()) {
            console.warn(`  ⚠️ 未配置 SILICONFLOW_API_KEY，跳过教程生成：${r.full_name}`);
            steps.push({ fullName: r.full_name, kind: "skipped" });
          } else {
            console.log(`  ✍️ 生成教程 ${i + 1}/${top.length}：${r.full_name}（模式 ${tutorialMode}）`);
            const result = await generateStructuredTutorial(toTutorialMeta(r), {
              mode: tutorialMode,
              log: (msg) => console.log(msg),
            });
            for (const w of result.warnings) console.warn(`     ⚠️ ${w}`);
            if (result.toolCalls?.length) {
              console.log(`     🔧 取证 ${result.toolCalls.length} 次：${result.toolCalls.map((c) => c.name).join("、")}`);
            }
            if (result.tutorial) {
              // 存结构化 JSON，渲染成 Markdown 是展示层的事。
              // 顺带把取证痕迹记进去：读者得能看出这份教程是查过资料的还是凭记忆写的。
              tutorial = JSON.stringify(attachEvidence(result.tutorial, result.toolCalls));
              steps.push({ fullName: r.full_name, kind: "generated" });
            } else {
              console.warn(`  ⚠️ 教程生成失败：${r.full_name} - ${result.error}`);
              failure = { tutorialError: result.error ?? "未知原因", tutorialFailedAt: new Date() };
              steps.push({ fullName: r.full_name, kind: "failed", error: failure.tutorialError });
            }
          }
        } else {
          console.log(`  ♻️ 复用已有教程 ${i + 1}/${top.length}：${r.full_name}`);
          steps.push({ fullName: r.full_name, kind: "reused" });
        }

        await saveRepository(r, existing, tutorial, failure);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ❌ 处理 ${r.full_name} 时出错，跳过这一项：${msg}`);
        tutorial = null;
        steps.push({ fullName: r.full_name, kind: "failed", error: `写库/生成异常：${msg}` });
      }

      picks.push({
        rank: i + 1,
        fullName: r.full_name,
        name: r.name,
        description: r.description,
        url: r.html_url,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        category: categorize(r),
        reason: r.reasons.join("；"),
        tutorial,
      });
    }

    // 逐项兜底不能变成「全挂了也照样发布」：一个都没处理成功时不写快照，
    // 直接失败退出 —— 让今天的缺口显式存在，而不是拿一期没教程的稿子糊过去。
    if (steps.length > 0 && steps.every((s) => s.kind === "failed")) {
      throw new Error(
        `本期 ${top.length} 个项目全部处理失败，未写快照。首个错误：${steps[0].error ?? "未知"}`,
      );
    }

    // 用带教程的 picks 生成每期 Markdown 稿
    const content =
      `# ${title}\n\n> ${summary}\n\n` +
      picks
        .map(
          (p, i) =>
            `## ${i + 1}. ${p.fullName}\n\n${p.description ?? ""}\n\n` +
            `- Stars：${p.stars} | 语言：${p.language ?? "—"}\n` +
            `- 仓库：${p.url}\n` +
            `- 推荐理由：${p.reason}\n` +
            renderTutorialInContent(toTutorialMarkdown(p.tutorial)),
        )
        .join("\n");

    const article = await prisma.article.upsert({
      where: { issue },
      update: {
        title,
        content,
        status: "published",
        publishedAt: new Date(),
      },
      create: {
        issue,
        title,
        content,
        status: "published",
        weekStart: new Date(),
        publishedAt: new Date(),
      },
    });

    // 重建本期推荐关系
    await prisma.recommendation.deleteMany({ where: { articleId: article.id } });
    for (let i = 0; i < picks.length; i++) {
      const repo = await prisma.repository.findUnique({
        where: { fullName: picks[i].fullName },
      });
      if (!repo) continue;
      await prisma.recommendation.upsert({
        where: { articleId_repositoryId: { articleId: article.id, repositoryId: repo.id } },
        update: {
          reason: picks[i].reason,
          category: picks[i].category,
          sortOrder: i + 1,
        },
        create: {
          articleId: article.id,
          repositoryId: repo.id,
          reason: picks[i].reason,
          category: picks[i].category,
          sortOrder: i + 1,
        },
      });
    }

    // 生成快照，供无数据库环境（如静态部署）回退读取
    const totalStars = picks.reduce((s, p) => s + p.stars, 0);
    const languageCount = new Set(picks.map((p) => p.language).filter(Boolean)).size;
    const snapshot = {
      issue,
      title,
      summary,
      content,
      dateKey: todayKey(),
      updatedAt: new Date().toISOString(),
      totalStars,
      languageCount,
      picks,
      runStatus: {
        // 有项目没生成出教程就如实写 partial：快照是数据库不可用时的兜底，
        // 兜底数据里写「一切正常」会骗过看快照的人
        status: steps.some((s) => s.kind === "failed") ? "partial" : "success",
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        log: null,
      },
    };
    const outDir = path.join(process.cwd(), "public", "data");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "latest.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf8");

    // 部署版没有数据库，往期列表 / 详情全靠这两份静态文件。
    // 索引是累积的：读取仓库里上期留下的 history.json，把本期并进去。
    await writeStaticSiteData(outDir, snapshot, (m) => console.log(m));

    // 订阅源跟着快照一起写：数据一天只变一次，为一个静态结果每次请求都查库不划算
    const feed = buildRssFeed({
      siteUrl: SITE_URL,
      issue,
      dateKey: todayKey(),
      title,
      picks: picks.map((p) => ({
        rank: p.rank,
        fullName: p.fullName,
        description: p.description,
        url: p.url,
        language: p.language,
        stars: p.stars,
        category: p.category,
      })),
    });
    await fs.writeFile(path.join(process.cwd(), "public", "feed.xml"), feed, "utf8");

    // 本期内容已经全部落库了，这时候才去补历史的坑：
    // 补做是额外开销，绝不能让它挡住今天这一期出稿。
    // 放在索引重建之前，补出来的教程才能一并进检索库。
    // 用 try/catch 兜住：今天这一期已经落库了，补做失败不该让整轮变成 failed。
    let retries: RetryOutcome[] = [];
    try {
      retries = await retryMissingTutorials(
        tutorialMode,
        { db: prisma, log: (m) => console.log(m) },
        top.map((r) => r.full_name),
      );
    } catch (err) {
      console.warn(`   ⚠️ 补做历史欠账时出错：${err instanceof Error ? err.message : err}`);
    }

    // 当天新增的教程要并进检索库，否则 search_knowledge 检索不到它们
    if (hasApiKey()) {
      try {
        console.log("🔍 重建知识库索引…");
        const stats = await buildKnowledgeIndex({ log: (m) => console.log(m) });
        console.log(`   切片 ${stats.chunks} 条，新增向量 ${stats.embedded} 条`);
      } catch (err) {
        // 索引失败不影响今天的推荐内容，记一笔继续
        console.warn(`   ⚠️ 索引构建失败：${err instanceof Error ? err.message : err}`);
      }
    }

    // ── 本期报告 ────────────────────────────────────────────────
    // 有项目没拿到教程时状态是 partial，不是 success：
    // 这种「稿子出来了但缺一块」的半失败最容易被人当成成功。
    const report = buildRunReport(steps, retries);
    console.log(`\n${formatRunReport(report)}`);

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: report.status, endedAt: new Date(), log: formatRunReport(report) },
    });

    // CI 里顺便把报告写进 job summary，不翻日志也能看见本期到底顺不顺
    if (process.env.GITHUB_STEP_SUMMARY) {
      await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, formatRunReportMarkdown(report) + "\n", "utf8");
    }

    const withTutorial = picks.filter((p) => p.tutorial).length;
    const structured = picks.filter((p) => parseStructuredTutorial(p.tutorial)).length;
    console.log(
      `\n✅ 已更新第 ${issue} 期（${title}），推荐 ${top.length} 个项目，其中 ${withTutorial} 个有教程（结构化 ${structured} 个）`,
    );
    console.log(`   快照已写入 public/data/latest.json`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.jobRun
      .update({ where: { id: jobRun.id }, data: { status: "failed", log: msg, endedAt: new Date() } })
      .catch(() => {});
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("失败：", msg);

  // 失败原因不能只留在控制台里：Actions 的原始日志要 admin 权限才下得到，
  // 而 step summary 和 ::error:: 注解在运行页面上能直接看见（也读得到）。
  // 之前「每天挂一次、但没人知道为什么」就是卡在这一步。
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs
      .appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `## ❌ 日更失败\n\n\`\`\`\n${msg.slice(0, 4000)}\n\`\`\`\n`,
        "utf8",
      )
      .catch(() => {});
  }
  // 单行化：注解里换行会截断，只保留第一屏能看全的部分
  console.log(`::error::日更失败：${msg.replace(/\s+/g, " ").slice(0, 300)}`);
  process.exit(1);
});
