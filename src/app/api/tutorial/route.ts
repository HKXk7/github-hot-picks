import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// 与 scripts/update-daily.ts 保持同一套配置
const SF_BASE = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
const SF_KEY = process.env.SILICONFLOW_API_KEY ?? "";
const TUTORIAL_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

interface TutorialMeta {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  topics: string[];
  homepage: string | null;
  url: string;
}

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
      url: r.html_url,
    };
  } catch {
    return {};
  }
}

function buildPrompt(meta: TutorialMeta): string {
  const info = [
    `项目名：${meta.fullName}`,
    meta.description ? `简介：${meta.description}` : null,
    meta.language ? `语言：${meta.language}` : null,
    `Star：${meta.stars}`,
    meta.topics.length ? `标签：${meta.topics.join("、")}` : null,
    meta.homepage ? `官网：${meta.homepage}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `你是面向编程新手的开源项目介绍写手。请为下面这个 GitHub 项目写一份「小白也能看懂」的上手教程，用中文，语气友好、分点清晰、可执行。

${info}

请严格按照下面四个小标题输出（每个标题用 ## 开头），内容要具体、实用，不要空话：

## 它是干什么的
用 2~3 句大白话讲清这个项目解决什么问题、给谁用。

## 怎么安装 / 快速开始
给出最直接的上手方式（安装命令、依赖、或在线演示地址），命令用代码块包裹。

## 核心功能怎么用
列出 2~4 个最值得新手先尝试的功能，各用一句话说明怎么操作。

## 适合谁 / 常见坑
说明适合哪类人，以及新手最容易踩的 2~3 个坑。

要求：
- 全程中文，控制在 500 字以内；
- 命令写在代码块里；
- 不要编造具体的版本号、精确的 star 数或你无法确认的细节；
- 如果信息不足以判断，基于项目类型给出合理、通用的建议，并标注「以官方 README 为准」。`;
}

async function generateTutorial(meta: TutorialMeta): Promise<string> {
  const res = await fetch(`${SF_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SF_KEY}`,
    },
    body: JSON.stringify({
      model: TUTORIAL_MODEL,
      messages: [{ role: "user", content: buildPrompt(meta) }],
      max_tokens: 1200,
      thinking: { type: "disabled" },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new Error(`AI 服务返回 ${res.status}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text || text.length <= 20) {
    throw new Error("AI 返回内容为空");
  }
  return text;
}

export async function POST(request: Request) {
  if (!SF_KEY) {
    return NextResponse.json(
      { error: "未配置 SILICONFLOW_API_KEY，无法生成教程" },
      { status: 503 },
    );
  }

  let fullName: string;
  try {
    const body = (await request.json()) as { fullName?: unknown };
    fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
    return NextResponse.json({ error: "项目名格式不正确" }, { status: 400 });
  }

  try {
    // 已有教程直接返回（幂等）
    const repo = await prisma.repository.findUnique({ where: { fullName } });
    if (repo?.tutorial) {
      return NextResponse.json({ tutorial: repo.tutorial, cached: true });
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
      url: gh.url ?? repo?.url ?? `https://github.com/${fullName}`,
    };

    const tutorial = await generateTutorial(meta);

    // 写回数据库；仓库记录不存在时（如读的是旧快照）尽力补建，失败也不影响返回
    if (repo) {
      await prisma.repository.update({ where: { fullName }, data: { tutorial } });
    } else {
      await prisma.repository
        .create({
          data: {
            githubId: 0,
            fullName,
            name: fullName.split("/")[1] ?? fullName,
            description: meta.description,
            url: meta.url,
            language: meta.language,
            stars: meta.stars,
            forks: 0,
            fetchedAt: new Date(),
            tutorial,
          },
        })
        .catch(() => {});
    }

    return NextResponse.json({ tutorial, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `教程生成失败：${message}` }, { status: 500 });
  }
}
