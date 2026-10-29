import { z } from "zod";

/**
 * 教程数据结构版本。
 * 存在数据库的 tutorial 列里是一道字符串：
 * - 新版：`{"v":2,...}` 的 JSON 字符串
 * - 旧版：纯 Markdown 文本
 * 靠能不能 JSON.parse 且带 v 字段来区分，因此不需要迁移旧数据。
 */
export const TUTORIAL_VERSION = 2;

const shortText = (min: number, max: number) => z.string().trim().min(min).max(max);

/**
 * 小白教程的结构化 schema。
 *
 * 注意 installCommands 刻意**不设 min(1)**：如果一个项目其实不能本地安装，
 * 硬要求它必须给命令，等于逼它编一条。允许为空，但此时 confidence 不许标 high —— 
 * 这条跨字段规则才是真正防瞎编的那一刀。
 */
export const TutorialSchema = z
  .object({
    v: z.literal(TUTORIAL_VERSION),
    /** 一句话说明它解决什么问题 */
    oneLiner: shortText(10, 120),
    /** 适合谁 */
    audience: shortText(4, 60),
    /** 安装 / 启动命令，允许为空（例如只有在线演示的项目） */
    installCommands: z.array(shortText(1, 200)).max(6),
    /** 值得新手先试的功能 */
    features: z.array(shortText(2, 200)).min(2).max(4),
    /** 新手最容易踩的坑 */
    pitfalls: z.array(shortText(2, 200)).min(1).max(3),
    /** AI 自评把握程度 */
    confidence: z.enum(["high", "medium", "low"]),
    /** 无法确认的信息（如具体版本号），留给自己承认不知道 */
    missingInfo: z.array(shortText(1, 100)).max(5).default([]),
  })
  .refine((t) => t.installCommands.length > 0 || t.confidence !== "high", {
    message: "没有给出安装命令时，confidence 不能是 high",
    path: ["confidence"],
  })
  .refine((t) => t.missingInfo.length === 0 || t.confidence !== "high", {
    message: "存在无法确认的信息时，confidence 不能是 high",
    path: ["confidence"],
  });

export type Tutorial = z.infer<typeof TutorialSchema>;

/** 判断数据库里存的是不是新版结构化教程 */
export function isStructuredTutorial(raw: string | null): boolean {
  if (!raw) return false;
  return raw.trimStart().startsWith("{") && parseStructuredTutorial(raw) !== null;
}

/** 把数据库里的字符串解析成结构化教程；失败（含旧版 Markdown）返回 null */
export function parseStructuredTutorial(raw: string | null): Tutorial | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = TutorialSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    // 旧版数据就是普通 Markdown，parse 会失败，属于预期情况
    return null;
  }
}

/** 把结构化教程渲染回 Markdown（沿用原来的四个小标题，前端渲染器无需改动） */
export function renderTutorialToMarkdown(t: Tutorial): string {
  const parts: string[] = [];

  parts.push(`## 它是干什么的\n\n${t.oneLiner}`);

  if (t.installCommands.length > 0) {
    const code = t.installCommands.join("\n");
    parts.push(`## 怎么安装 / 快速开始\n\n\`\`\`bash\n${code}\n\`\`\``);
  } else {
    parts.push(`## 怎么安装 / 快速开始\n\n这个项目没有给出可直接执行的安装命令，请以官方 README 为准。`);
  }

  parts.push(`## 核心功能怎么用\n\n${t.features.map((f) => `- ${f}`).join("\n")}`);

  const pitfallSection = [`## 适合谁 / 常见坑`, ``, `适合人群：${t.audience}`, ``, `常见坑：`];
  pitfallSection.push(...t.pitfalls.map((p) => `- ${p}`));
  parts.push(pitfallSection.join("\n"));

  // 把握程度不高或承认有未知信息时，明确告诉读者哪些只能作参考
  const caveats: string[] = [];
  if (t.confidence !== "high") {
    caveats.push(`这份教程 AI 的把握程度为「${CONFIDENCE_LABEL[t.confidence]}」`);
  }
  if (t.missingInfo.length > 0) {
    caveats.push(`以下细节未经确认，请以官方 README 为准：${t.missingInfo.join("、")}`);
  }
  if (caveats.length > 0) {
    parts.push(`## 注意事项\n\n${caveats.join("；")}。`);
  }

  return parts.join("\n\n");
}

const CONFIDENCE_LABEL: Record<Tutorial["confidence"], string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/**
 * 给消费方用的兜底函数：无论数据库里存的是新版 JSON 还是旧版 Markdown，
 * 一律返回可直接渲染的 Markdown。
 */
export function toTutorialMarkdown(raw: string | null): string | null {
  if (!raw) return null;
  const structured = parseStructuredTutorial(raw);
  return structured ? renderTutorialToMarkdown(structured) : raw;
}
