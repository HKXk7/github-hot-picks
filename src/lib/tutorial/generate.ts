import { z } from "zod";
import { TutorialSchema, TUTORIAL_VERSION, type Tutorial } from "./schema";
import { chat, hasApiKey, type ChatMessage } from "../ai/llm";
import { runToolAgent } from "../ai/agent";
import { BASE_TOOLS } from "../ai/tools";
import { knowledgeTool } from "../ai/tools/knowledge";
import type { Tool, ToolCallRecord } from "../ai/tools/types";

export { hasApiKey };

export const TUTORIAL_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

/** 必须显式给：服务端默认上限很低，JSON 被截断会伪装成「格式错」 */
const MAX_TOKENS = 1600;
/** 带工具时上下文更长，输出上限也要放宽 */
const MAX_TOKENS_TOOL = 2400;
/** 校验失败最多重试几轮（每轮都是一次真实调用） */
const MAX_ATTEMPTS = 3;
/** 工具模式下模型最多可以做几轮取证 */
const MAX_TOOL_STEPS = 5;

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
  /** 用了哪些工具（仅 tools 模式有值） */
  toolCalls?: ToolCallRecord[];
  /** 实际使用的模式 */
  mode?: GenerationMode;
}

/**
 * plain：只给模型项目基本信息，让它凭已有知识作答（快、便宜，但安装命令这类细节容易编）。
 * tools：先把 README / 仓库元数据 / 包管理器挂成工具让模型取证，再作答（慢一些，但每条结论都有出处）。
 */
export type GenerationMode = "plain" | "tools";

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

function renderMeta(meta: TutorialMeta): string {
  return [
    `项目名：${meta.fullName}`,
    meta.description ? `简介：${meta.description}` : null,
    meta.language ? `语言：${meta.language}` : null,
    `Star：${meta.stars}`,
    meta.topics.length ? `标签：${meta.topics.join("、")}` : null,
    meta.homepage ? `官网：${meta.homepage}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const WRITING_RULES = `要求：
- 全程中文，语气友好、具体、可执行，不要空话；
- 命令写进 installCommands 数组，每条是一个完整命令，不要带 markdown 围栏；
- 不要编造具体的版本号、精确的 star 数或你无法确认的细节；无法确认的写进 missingInfo；
- 查不到可靠的安装方式时，installCommands 就留空数组，并把 confidence 标为 medium 或 low；
- 信息不足时，基于项目类型给出合理、通用的建议。`;

export function buildPrompt(meta: TutorialMeta, repairNote?: string): string {
  const base = `你是面向编程新手的开源项目介绍写手。请为下面这个 GitHub 项目写一份「小白也能看懂」的上手教程，全程中文。

${renderMeta(meta)}

${WRITING_RULES}

${SCHEMA_DESC}`;

  if (!repairNote) return base;

  // 自修复的关键：把上一轮确切的错误告诉模型，而不是笼统地说「再试一次」
  return `${base}

---
上一次你的输出没有通过校验，具体问题如下：

${repairNote}

请修正这些问题，重新输出完整的 JSON（只输出 JSON，不要任何前缀或解释）。`;
}

/** 工具模式的开场消息：system 里讲清取证纪律，user 里给项目线索 */
function buildToolMessages(meta: TutorialMeta): ChatMessage[] {
  return [
    {
      role: "system",
      content: `你是面向编程新手的开源项目介绍写手，并且**可以调用工具核实事实**。

工作纪律（比写出漂亮的文案更重要）：
1. 动笔前先用 fetch_readme 读这个项目的 README，它是唯一可信的一手资料；
2. 只要你准备写安装命令，必须先用 fetch_package_info 核实包名真实存在——
   很多项目的仓库名和它在包管理器上的名字并不一致，甚至根本没发布，
   凭仓库名猜包名是最典型的错误；
   注意「安装命令」不限于包管理器：README 里写的 git clone + 构建命令
   （如 cargo build --release、pnpm install && pnpm dev）同样是合法的安装命令。
   查不到发布包**不等于**没有安装方式，此时应该回到 README 找源码构建步骤，
   只有两者都没有才把 installCommands 留空；
3. README 里没写、工具也查不到的东西，一律写进 missingInfo，不要靠常识补；
4. 如果你怀疑查到的包是「同名不同项目」（描述或仓库地址对不上），
   要在结论里明确指出，不要给出那条安装命令；
5. 需要参考本站其他项目的写法时，用 search_knowledge 检索。

${WRITING_RULES}

最后只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码围栏。

${SCHEMA_DESC}`,
    },
    {
      role: "user",
      content: `请为下面这个项目写一份小白上手教程。先取证，再动笔。

${renderMeta(meta)}`,
    },
  ];
}

// ================= 解析 =================
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

/** 把一段模型输出变成「通过校验的教程」或「下一条修复提示」 */
function tryParse(raw: string, finishReason: string | null): { tutorial: Tutorial } | { note: string } {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) {
    return {
      note:
        finishReason === "length"
          ? "你的输出被长度上限截断了，JSON 没有写完。请大幅精简各字段内容后重新输出。"
          : "没有从你的输出中提取到 JSON 对象（可能带了说明文字或 markdown 围栏）。请只输出纯 JSON。",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      note:
        finishReason === "length"
          ? "你的输出被长度上限截断，JSON 结构不完整无法解析。请精简内容后重新输出。"
          : "你输出的 JSON 无法解析，可能混入了注释、多余逗号或非 JSON 文本。请修正后重新输出。",
    };
  }

  const result = TutorialSchema.safeParse(parsed);
  if (!result.success) return { note: formatIssues(result.error) };
  return { tutorial: result.data };
}

// ================= 主入口 =================
export interface GenerateOptions {
  /** plain = 单轮凭知识作答（默认，快）；tools = 先工具取证再作答，可用 TUTORIAL_MODE=tools 打开 */
  mode?: GenerationMode;
  maxAttempts?: number;
  maxSteps?: number;
  log?: (msg: string) => void;
  /** 追加额外工具（测试或扩展用） */
  extraTools?: Tool[];
}

/**
 * 生成一份通过 schema 校验的小白教程。
 *
 * 两条路径共用同一套「提取 → 校验 → 把错误喂回去自修复」的闭环，区别只在
 * 第一轮是模型空想还是先取证。工具模式下自修复会复用已拿到的证据，
 * 不会把工具重跑一遍。
 */
export async function generateStructuredTutorial(
  meta: TutorialMeta,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  // 没有显式传入时看环境变量：TUTORIAL_MODE=tools 才走工具取证路径。
  // 默认 plain：评测里 tools 多花一倍时间，缺字段反而更多（见 scripts/update-daily.ts 注释）。
  const mode: GenerationMode = options.mode ?? (process.env.TUTORIAL_MODE === "tools" ? "tools" : "plain");
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const log = options.log ?? (() => {});
  const warnings: string[] = [];

  if (!hasApiKey()) {
    return { tutorial: null, attempts: 0, warnings, mode, error: "未配置 SILICONFLOW_API_KEY" };
  }

  const tools: Tool[] = [...BASE_TOOLS, knowledgeTool, ...(options.extraTools ?? [])];
  // tools 模式下这是一条会不断变长的对话（含工具观察）；plain 模式下每轮都是全新单轮请求
  let messages: ChatMessage[] = mode === "tools" ? buildToolMessages(meta) : [];
  let toolCalls: ToolCallRecord[] = [];
  let repairNote: string | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let raw = "";
    let finishReason: string | null = null;

    if (mode === "tools" && attempt === 1) {
      // 第一轮：取证。工具结果会留在 messages 里，后续修复直接复用，不必重跑工具
      const agent = await runToolAgent({
        model: TUTORIAL_MODEL,
        messages,
        tools,
        maxSteps: options.maxSteps ?? MAX_TOOL_STEPS,
        maxTokens: MAX_TOKENS_TOOL,
        // 不强制的话，模型有相当比例会跳过取证直接作答，工具就白挂了
        requireToolOnFirstStep: true,
        log: (m) => log(`    ${m}`),
      });
      toolCalls = agent.steps;
      warnings.push(...agent.warnings);
      messages = agent.messages;
      raw = agent.finalText;
      if (!raw.trim()) {
        warnings.push(`第 ${attempt} 轮：agent 返回空内容`);
        repairNote = "你刚才返回了空内容，请重新输出完整的 JSON。";
        continue;
      }
    } else {
      const msgs: ChatMessage[] =
        mode === "tools"
          ? [
              ...messages,
              {
                role: "user",
                content: `你上一次的输出没有通过校验：\n\n${repairNote}\n\n请基于上面已经查到的资料修正，只输出 JSON，不要任何解释。`,
              },
            ]
          : [{ role: "user", content: buildPrompt(meta, repairNote) }];

      const outcome = await chat({
        model: TUTORIAL_MODEL,
        messages: msgs,
        maxTokens: mode === "tools" ? MAX_TOKENS_TOOL : MAX_TOKENS,
        jsonMode: true,
      });

      if (!outcome.ok) {
        warnings.push(`第 ${attempt} 轮调用失败：${outcome.error.slice(0, 200)}`);
        repairNote = `接口调用失败：${outcome.error.slice(0, 200)}`;
        continue;
      }
      warnings.push(...outcome.degraded);
      raw = outcome.message.content ?? "";
      finishReason = outcome.finishReason;
      // 工具模式要保留对话，让修复轮也能看到 README 等证据
      if (mode === "tools") messages = msgs;
    }

    const parsed = tryParse(raw, finishReason);
    if ("tutorial" in parsed) {
      return { tutorial: parsed.tutorial, attempts: attempt, warnings, toolCalls, mode };
    }

    repairNote = parsed.note;
    warnings.push(`第 ${attempt} 轮未通过校验：${parsed.note.split("\n")[0]}`);
    log(`  ↳ 第 ${attempt} 轮校验未通过：${parsed.note.split("\n")[0]}`);
  }

  return {
    tutorial: null,
    attempts: maxAttempts,
    warnings,
    toolCalls,
    mode,
    error: `连续 ${maxAttempts} 轮未通过校验`,
  };
}
