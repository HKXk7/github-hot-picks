import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hasApiKey,
  generateStructuredTutorial,
  type TutorialMeta,
} from "@/lib/tutorial/generate";
import { renderTutorialToMarkdown, toTutorialMarkdown } from "@/lib/tutorial/schema";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
// 副作用导入：这个接口会现场生成教程（烧钱），用量必须能查得到
import "@/lib/ai/observability";

// 尽力从 GitHub 补全 topics / homepage 等元数据（失败不影响，回退用数据库里的信息）
async function fetchGithubMeta(fullName: string): Promise<Partial<TutorialMeta>> {
  try {
    const res = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "github-hot-picks",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    const r = (await res.json()) as {
      description?: string | null;
      language?: string | null;
      stargazers_count?: number;
      topics?: string[];
      homepage?: string | null;
      html_url?: string;
    };
    return {
      description: r.description ?? null,
      language: r.language ?? null,
      stars: r.stargazers_count,
      topics: r.topics ?? [],
      homepage: r.homepage || null,
    };
  } catch {
    return {};
  }
}

/**
 * 用户手动请求生成的仓库没有 GitHub 真实 id，但 githubId 是唯一约束，
 * 以前一律填 0 —— 第二个这样的项目就会撞唯一约束（虽然被 catch 吞掉，
 * 结果是静默不入库，教程下次还得重生成）。用全名哈希顶上，并取负值：
 * 真实 GitHub id 恒为正，这样两个 id 空间不会打架。
 */
function placeholderGithubId(fullName: string): number {
  let hash = 0;
  for (let i = 0; i < fullName.length; i++) hash = (hash * 31 + fullName.charCodeAt(i)) | 0;
  return -(Math.abs(hash) + 1);
}

/**
 * 生成一次教程 = 一次大模型生成 + 至少一次 GitHub 请求，比对话更贵，
 * 所以配额给得更紧。正常用法是「点开一个项目看教程」，一分钟 5 次绰绰有余。
 */
const RATE_LIMIT_PER_MIN = Number(process.env.TUTORIAL_RATE_LIMIT ?? 5);
const MAX_FULL_NAME_LENGTH = 100;

export async function POST(request: Request) {
  // 先看有没有 key（成本为零），再限流，最后才碰 body 和数据库
  if (!hasApiKey()) {
    return NextResponse.json(
      { error: "未配置 SILICONFLOW_API_KEY，无法生成教程" },
      { status: 503 },
    );
  }

  const limit = checkRateLimit(`tutorial:${clientIp(request.headers)}`, {
    limit: Number.isFinite(RATE_LIMIT_PER_MIN) ? RATE_LIMIT_PER_MIN : 5,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return NextResponse.json(
      { error: `生成请求太频繁，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试。` },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  let fullName: string;
  try {
    const body = (await request.json()) as { fullName?: unknown };
    fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (fullName.length > MAX_FULL_NAME_LENGTH) {
    return NextResponse.json({ error: "项目名过长" }, { status: 400 });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
    return NextResponse.json({ error: "项目名格式不正确" }, { status: 400 });
  }

  try {
    // 已有教程直接返回（幂等）
    const repo = await prisma.repository.findUnique({ where: { fullName } });
    if (repo?.tutorial) {
      // 数据库里存的是结构化 JSON，这里转回 Markdown 供弹窗渲染；旧版 Markdown 数据原样返回
      return NextResponse.json(
        { tutorial: toTutorialMarkdown(repo.tutorial), cached: true },
        { headers: rateLimitHeaders(limit) },
      );
    }

    // 用数据库里的基础信息 + GitHub 实时元数据补全
    const gh = await fetchGithubMeta(fullName);
    const meta: TutorialMeta = {
      fullName,
      description: gh.description ?? repo?.description ?? null,
      language: gh.language ?? repo?.language ?? null,
      stars: gh.stars ?? repo?.stars ?? 0,
      topics: gh.topics ?? [],
      homepage: gh.homepage ?? null,
    };

    // 交互路径固定走 plain：用户在屏幕前等，评测里 tools 平均 22s 而 plain 只要 8s。
    // 日更管线那条离线路径反过来默认 tools（见 scripts/update-daily.ts 的注释说明理由）。
    const result = await generateStructuredTutorial(meta, { mode: "plain" });
    if (!result.tutorial) {
      return NextResponse.json(
        { error: `教程生成失败：${result.error ?? "未知原因"}` },
        { status: 502 },
      );
    }

    const tutorial = result.tutorial;
    const stored = JSON.stringify(tutorial);

    // 写回数据库；仓库记录不存在时（如读的是旧快照）尽力补建，失败也不影响返回
    if (repo) {
      await prisma.repository.update({ where: { fullName }, data: { tutorial: stored } });
    } else {
      await prisma.repository
        .create({
          data: {
            githubId: placeholderGithubId(fullName),
            fullName,
            name: fullName.split("/")[1] ?? fullName,
            description: meta.description,
            url: `https://github.com/${fullName}`,
            language: meta.language,
            stars: meta.stars,
            forks: 0,
            fetchedAt: new Date(),
            tutorial: stored,
          },
        })
        .catch(() => {});
    }

    return NextResponse.json(
      {
        tutorial: renderTutorialToMarkdown(tutorial),
        cached: false,
        attempts: result.attempts,
        // 取证了多少次、用了哪些工具。前端可以拿它说明「这份教程不是凭空编的」
        evidence: result.toolCalls ?? [],
      },
      { headers: rateLimitHeaders(limit) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `教程生成失败：${message}` }, { status: 500 });
  }
}
