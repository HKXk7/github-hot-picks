import { z } from "zod";
import { TutorialSchema, TUTORIAL_VERSION, type Tutorial } from "./schema";

// ================= 配置 =================
// 注意：这些常量现在是全项目唯一真源，scripts/update-daily.ts 和 API 路由都从这里取，
// 不要再各写一份（以前就是这么重复的）。
const SF_BASE = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
const SF_KEY = process.env.SILICONFLOW_API_KEY ?? "";
export const TUTORIAL_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

/** 必须显式给：服务端默认上限很低，JSON 被截断会伪装成「格式错」 */
const MAX_TOKENS = 1600;
const TIMEOUT_MS = 60_000;
/** 校验失败最多重试几轮（每轮都是一次真实调用） */
const MAX_ATTEMPTS = 3;
/** HTTP 层可重试错误（429/5xx）的退避次数 */
const MAX_HTTP_RETRIES = 2;

export function hasApiKey(): boolean {
  return SF_KEY.length > 0;
}

export interface TutorialMeta {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  topics: string[];
  homepage: string | null;
}

export interface GenerateResult {
  tutorial: Tutorial | null;
  /** 实际调用了几轮才通过（含失败轮） */
  attempts: number;
  /** 过程中发生的降级与重试，供日志排查 */
  warnings: string[];
  /** 全部轮次失败时的原因汇总 */
  error?: string;
}

// ================= prompt =================
const SCHEMA_DESC = `输出必须是一个严格符合下列要求的 JSON 对象。不要输出任何解释性文字，不要使用 markdown 代码围栏。

{
  "v": ${TUTORIAL_VERSION},
  "oneLiner": string, 10-120 字，一句话说明这个项目解决什么问题
  "audience": string, 4-60 字，说明适合谁
  "installCommands": string[], 0-6 条，真实可执行的安装或启动命令；确实无法给出时留空数组
  "features": string[], 2-4 条，每条说明一个值得新手先尝试的功能怎么用
  "pitfalls": string[], 1-3 条，新手最容易踩的坑
  "confidence": "high" | "medium" | "low", 你对上述内容的把握程度
  "missingInfo": string[], 你无法确认的信息（例如具体版本号）
}

两条硬性约束：
- 如果 installCommands 为空数组，confidence 不能是 high
- 如果 missingInfo 不是空数组，confidence 不能是 high`;

export function buildPrompt(meta: TutorialMeta, repairNote?: string): string {
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

  const base = `你是面向编程新手的开源项目介绍写手。请为下面这个 GitHub 项目写一份「小白也能看懂」的上手教程，全程中文。

${info}

要求：
- 全程中文，语气友好、具体、可执行，不要空话；
- 命令写进 installCommands 数组，每条是一个完整命令，不要带 markdown 围栏；
- 不要编造具体的版本号、精确的 star 数或你无法确认的细节；无法确认的写进 missingInfo；
- 查不到可靠的安装方式时，installCommands 就留空数组，并把 confidence 标为 medium 或 low；
- 信息不足时，基于项目类型给出合理、通用的建议。

${SCHEMA_DESC}`;

  if (!repairNote) return base;

  // 自修复的关键：把上一轮确切的错误告诉模型，而不是笼统地说「再试一次」
  return `${base}

---
上一次你的输出没有通过校验，具体问题如下：

${repairNote}

请修正这些问题，重新输出完整的 JSON（只输出 JSON，不要任何前缀或解释）。`;
}

// ================= 调用层 =================
type CallOutcome =
  | { kind: "ok"; content: string; finishReason: string | null }
  | { kind: "http-error"; status: number; body: string }
  | { kind: "network-error"; message: string };

async function callOnce(prompt: string, useJsonMode: boolean): Promise<CallOutcome> {
  try {
    const res = await fetch(`${SF_BASE}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SF_KEY}` },
      body: JSON.stringify({
        model: TUTORIAL_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: MAX_TOKENS,
        stream: false,
        // DeepSeek 系用这种写法关思维链（Qwen 系是 enable_thinking: false）
        thinking: { type: "disabled" },
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      return { kind: "http-error", status: res.status, body: (await res.text()).slice(0, 300) };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
    };
    return {
      kind: "ok",
      content: data.choices?.[0]?.message?.content ?? "",
      finishReason: data.choices?.[0]?.finish_reason ?? null,
    };
  } catch (err) {
    return { kind: "network-error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** 429 / 5xx 做指数退避重试；4xx 直接返回，不浪费配额 */
async function callWithBackoff(
  prompt: string,
  useJsonMode: boolean,
  warnings: string[],
): Promise<CallOutcome> {
  for (let i = 0; i <= MAX_HTTP_RETRIES; i++) {
    const outcome = await callOnce(prompt, useJsonMode);
    if (outcome.kind === "ok") return outcome;

    const retryable =
      outcome.kind === "network-error" ||
      outcome.status === 429 ||
      (outcome.status >= 500 && outcome.status < 600);

    if (!retryable || i === MAX_HTTP_RETRIES) return outcome;

    const wait = 800 * 2 ** i + Math.floor(Math.random() * 300);
    warnings.push(
      `${outcome.kind === "network-error" ? "网络异常" : `HTTP ${outcome.status}`}，${wait}ms 后退避重试`,
    );
    await sleep(wait);
  }
  return { kind: "network-error", message: "退避重试耗尽" };
}

/** 判断是不是「该模型不支持 JSON 模式」（已知 GLM 系会返回 400 Json mode is not supported） */
function isJsonModeUnsupported(status: number, body: string): boolean {
  return status === 400 && /json[_ ]?mode|response_format|json_object/i.test(body);
}

// ================= 解析层 =================
/** 宽容提取：剥掉代码围栏，取首尾花括号之间的内容 */
export function extractJsonObject(raw: string): string | null {
  const withoutFence = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  return withoutFence.slice(first, last + 1);
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(根节点)";
      return `- 字段 ${path}：${i.message}`;
    })
    .join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ================= 主入口 =================
/**
 * 生成一份通过 schema 校验的小白教程。
 *
 * 流程：调用 → 提取 JSON → Zod 校验 → 失败则把错误明细拼回 prompt 再调用，最多 MAX_ATTEMPTS 轮。
 * 全部失败返回 tutorial: null，调用方按现有降级逻辑处理（不让管线中断）。
 */
export async function generateStructuredTutorial(
  meta: TutorialMeta,
  options: { maxAttempts?: number; log?: (msg: string) => void } = {},
): Promise<GenerateResult> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const log = options.log ?? (() => {});
  const warnings: string[] = [];

  if (!SF_KEY) {
    return { tutorial: null, attempts: 0, warnings, error: "未配置 SILICONFLOW_API_KEY" };
  }

  let useJsonMode = true;
  let repairNote: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await callWithBackoff(buildPrompt(meta, repairNote), useJsonMode, warnings);

    // 模型不支持 JSON 模式 → 去掉该字段降级，不算消耗尝试次数
    if (outcome.kind === "http-error" && useJsonMode && isJsonModeUnsupported(outcome.status, outcome.body)) {
      warnings.push(`该模型不支持 response_format，降级为纯 prompt 约束（HTTP ${outcome.status}）`);
      log(`  ↳ 检测到不支持 JSON 模式，降级重试`);
      useJsonMode = false;
      attempt -= 1;
      continue;
    }

    if (outcome.kind !== "ok") {
      const msg =
        outcome.kind === "http-error"
          ? `HTTP ${outcome.status} ${outcome.body}`
          : outcome.message;
      repairNote = `调用失败（${msg}）`;
      continue;
    }

    if (!outcome.content.trim()) {
      repairNote = "你上一次返回了空内容。";
      continue;
    }

    // 截断和格式错是两种不同的故障，得分开报，否则排查方向会被带偏
    const jsonText = extractJsonObject(outcome.content);
    if (!jsonText) {
      repairNote =
        outcome.finishReason === "length"
          ? "你的输出被长度上限截断了，JSON 没有写完。请大幅精简各字段内容后重新输出。"
          : "没有从你的输出中提取到 JSON 对象（开头可能带了说明文字或 markdown 围栏）。请只输出纯 JSON。";
      warnings.push(`第 ${attempt} 轮：JSON 提取失败（finish_reason=${outcome.finishReason}）`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      repairNote =
        outcome.finishReason === "length"
          ? "你的输出被长度上限截断，JSON 结构不完整无法解析。请精简内容后重新输出。"
          : "你输出的 JSON 无法解析，可能混入了注释、多余逗号或非 JSON 文本。请修正后重新输出。";
      warnings.push(`第 ${attempt} 轮：JSON.parse 失败（finish_reason=${outcome.finishReason}）`);
      continue;
    }

    const result = TutorialSchema.safeParse(parsed);
    if (!result.success) {
      repairNote = formatIssues(result.error);
      warnings.push(`第 ${attempt} 轮：schema 校验失败，${result.error.issues.length} 处不符`);
      log(`  ↳ 第 ${attempt} 轮校验未通过：${result.error.issues.map((i) => i.path.join(".") || "根").join("、")}`);
      continue;
    }

    return { tutorial: result.data, attempts: attempt, warnings };
  }

  return {
    tutorial: null,
    attempts: maxAttempts,
    warnings,
    error: `连续 ${maxAttempts} 轮未通过校验`,
  };
}
