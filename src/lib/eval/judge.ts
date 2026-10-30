import { chat, hasApiKey } from "../ai/llm";
import type { JudgeScore } from "./types";
import type { Tutorial } from "../tutorial/schema";
import type { EvalCase } from "./types";

/**
 * LLM-as-judge：用另一个模型给教程质量打分。
 *
 * 为什么不只靠前面的程序化判定：安装命令能不能查证是硬指标，
 * 但「这段描述对不对」「新手能不能照着做」没有 registry 可查。
 * 业界标准做法就是请一个模型当裁判，代价是要承认裁判本身也有偏见——
 * 所以它只用于参考趋势，不作为 CI 门禁的硬指标。
 *
 * 刻意让裁判拿到的输入只有项目元信息和教程本身，
 * **不给它看生成时的 README**：否则它容易变成复述原文，而不是独立判断。
 */
const JUDGE_MODEL = "deepseek-ai/DeepSeek-V4-Pro";

const RUBRIC = `你是 AI 生成内容的审核员。下面是一份给编程新手看的开源项目上手教程，以及该项目的公开元信息。

请从两个维度各打 1-5 分（整数），并给出一句中文理由：

1. groundedness（是否言之有据）：
   - 5 = 没有把推测写成事实，不确定处都有说明
   - 3 = 有个别地方写得过满，但没有明显的硬性错误
   - 1 = 出现了明显编造的具体细节（不存在的版本号、精确 star 数、凭空捏造的功能）
   注意：教程若自带「把握程度」「未确认信息」等自我说明，应视为加分项而非减分项。

2. usefulness（对新手是否有用）：
   - 5 = 照着就能跑起来，命令具体、坑点有用
   - 3 = 大致讲清楚了但缺关键步骤
   - 1 = 全是空话，或者根本没法照做

只输出 JSON，不要任何解释文字、不要代码围栏：
{"groundedness": <1-5>, "usefulness": <1-5>, "reason": "<一句话>"}`;

function renderTutorial(t: Tutorial): string {
  return [
    `一句话简介：${t.oneLiner}`,
    `适合人群：${t.audience}`,
    `安装命令：\n${t.installCommands.map((c) => `  ${c}`).join("\n") || "  （无）"}`,
    `核心功能：\n${t.features.map((f) => `  - ${f}`).join("\n")}`,
    `常见坑：\n${t.pitfalls.map((p) => `  - ${p}`).join("\n")}`,
    `自述把握程度：${t.confidence}`,
    `自述未确认信息：${t.missingInfo.join("、") || "（无）"}`,
  ].join("\n");
}

export async function judgeTutorial(meta: EvalCase, tutorial: Tutorial): Promise<JudgeScore | null> {
  if (!hasApiKey()) return null;

  const info = [
    `项目名：${meta.fullName}`,
    meta.description ? `简介：${meta.description}` : null,
    meta.language ? `主语言：${meta.language}` : null,
    `Star：${meta.stars}`,
  ]
    .filter(Boolean)
    .join("\n");

  const outcome = await chat({
    model: JUDGE_MODEL,
    messages: [
      { role: "system", content: RUBRIC },
      { role: "user", content: `${info}\n\n===== 待评审教程 =====\n${renderTutorial(tutorial)}` },
    ],
    maxTokens: 400,
    temperature: 0,
    jsonMode: true,
  });

  if (!outcome.ok || !outcome.message.content) return null;

  try {
    const text = outcome.message.content.replace(/```(?:json)?/gi, "").trim();
    const parsed = JSON.parse(text) as Partial<JudgeScore>;
    const g = Number(parsed.groundedness);
    const u = Number(parsed.usefulness);
    if (!Number.isFinite(g) || !Number.isFinite(u)) return null;
    return {
      groundedness: Math.min(5, Math.max(1, Math.round(g))),
      usefulness: Math.min(5, Math.max(1, Math.round(u))),
      reason: String(parsed.reason ?? "").slice(0, 200),
    };
  } catch {
    return null;
  }
}

export function summarizeJudge(metrics: { judge?: JudgeScore }[]): {
  groundedness?: number;
  usefulness?: number;
} {
  const judged = metrics.map((m) => m.judge).filter((j): j is JudgeScore => !!j);
  if (judged.length === 0) return {};
  return {
    groundedness: judged.reduce((a, j) => a + j.groundedness, 0) / judged.length,
    usefulness: judged.reduce((a, j) => a + j.usefulness, 0) / judged.length,
  };
}
