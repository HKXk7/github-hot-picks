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
import { buildKnowledgeIndex } from "../src/lib/rag/index-store";

const prisma = new PrismaClient();

/**
 * 教程生成模式。默认 plain（单轮成稿，快且有评测支撑）；
 * 想要「先取证再动笔」的高质量路径就设 TUTORIAL_MODE=tools，代价是慢一倍以上。
 *
 * 2026-10-29 的评测（data/eval/mode-compare-2026-10-29.json，6 个项目×2 模式）：
 *   plain  平均 4.17 条命令 / 缺 3.00 项 / 7.3s  / 0 次工具调用
 *   tools  平均 4.33 条命令 / 缺 3.67 项 / 15.8s / 3.33 次工具调用
 * 结论：当前提示词下工具模式只增加了延迟，结构化完整度反而更差，故默认切回 plain。
 */
const tutorialMode: GenerationMode = process.env.TUTORIAL_MODE === "tools" ? "tools" : "plain";

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

function filterTop(repos: RawRepo[], n: number, exclude: Set<string>): ScoredRepo[] {
  const seenOwner = new Set<string>();
  return repos
    .filter((r) => !exclude.has(r.full_name)) // 历史去重：排除往期已推荐
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

function guessCategory(r: RawRepo): string {
  const text = `${r.name} ${r.description ?? ""} ${(r.topics ?? []).join(" ")}`.toLowerCase();
  if (/ai|llm|gpt|agent|ml|deep|neural|infer|model|chat/i.test(text)) return "AI";
  if (/react|vue|next|front|web|ui|css|tailwind|component/i.test(text)) return "前端";
  if (/cli|tool|sdk|lib|framework|util|dev/i.test(text)) return "工具";
  if (/rust|go|python|java|server|api|database|sql|backend/i.test(text)) return "后端";
  return "其他";
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

// ================= 主流程 =================
async function main() {
  const startedAt = new Date();
  const jobRun = await prisma.jobRun.create({
    data: { jobType: "daily-update", status: "running", startedAt },
  });

  try {
    const repos = await fetchCandidates();

    // 历史去重：排除以前推荐过的项目
    const history = await prisma.repository.findMany({
      where: { recommendations: { some: {} } },
      select: { fullName: true },
    });
    const exclude = new Set(history.map((h) => h.fullName));
    const top = filterTop(repos, 10, exclude);
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

    for (let i = 0; i < top.length; i++) {
      const r = top[i];

      // 已有教程则复用（避免重复调用 AI、保持幂等），否则生成
      const existing = await prisma.repository.findUnique({ where: { githubId: r.id } });
      let tutorial = existing?.tutorial ?? null;
      if (!tutorial) {
        if (!hasApiKey()) {
          console.warn(`  ⚠️ 未配置 SILICONFLOW_API_KEY，跳过教程生成：${r.full_name}`);
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
            // 存结构化 JSON，渲染成 Markdown 是展示层的事
            tutorial = JSON.stringify(result.tutorial);
          } else {
            console.warn(`  ⚠️ 教程生成失败：${r.full_name} - ${result.error}`);
          }
        }
      } else {
        console.log(`  ♻️ 复用已有教程 ${i + 1}/${top.length}：${r.full_name}`);
      }

      await prisma.repository.upsert({
        where: { githubId: r.id },
        update: {
          name: r.name,
          description: r.description,
          url: r.html_url,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          fetchedAt: new Date(),
          ...(tutorial ? { tutorial } : {}),
        },
        create: {
          githubId: r.id,
          name: r.name,
          fullName: r.full_name,
          description: r.description,
          url: r.html_url,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          fetchedAt: new Date(),
          ...(tutorial ? { tutorial } : {}),
        },
      });

      picks.push({
        rank: i + 1,
        fullName: r.full_name,
        name: r.name,
        description: r.description,
        url: r.html_url,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        category: guessCategory(r),
        reason: r.reasons.join("；"),
        tutorial,
      });
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
        status: "success",
        startedAt: startedAt.toISOString(),
        endedAt: new Date().toISOString(),
        log: null,
      },
    };
    const outDir = path.join(process.cwd(), "public", "data");
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, "latest.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf8");

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

    await prisma.jobRun.update({
      where: { id: jobRun.id },
      data: { status: "success", endedAt: new Date() },
    });

    const withTutorial = picks.filter((p) => p.tutorial).length;
    const structured = picks.filter((p) => parseStructuredTutorial(p.tutorial)).length;
    console.log(
      `✅ 已更新第 ${issue} 期（${title}），推荐 ${top.length} 个项目，其中 ${withTutorial} 个有教程（结构化 ${structured} 个）`,
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

main().catch((err) => {
  console.error("失败：", err instanceof Error ? err.message : err);
  process.exit(1);
});
