import { NextRequest } from "next/server";
import { buildAssistantContext, getLatestSiteIssue } from "@/lib/site-data";
import { formatRetrieved, searchKnowledge } from "@/lib/rag/retrieve";
import { runPlannedAgent } from "@/lib/ai/planner";
import { BASE_TOOLS } from "@/lib/ai/tools";
import { knowledgeTool } from "@/lib/ai/tools/knowledge";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";

// 硅基流动（SiliconFlow）OpenAI 兼容接口
const BASE_URL = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";

// 前端「模型选择」下拉里可选、且已实测可用的模型
export const AVAILABLE_MODELS = [
  { id: "deepseek-ai/DeepSeek-V4-Pro", label: "DeepSeek V4 Pro（综合强）" },
  { id: "deepseek-ai/DeepSeek-V4.1-Flash", label: "DeepSeek V4.1 Flash（快）" },
  { id: "zai-org/GLM-5.3", label: "智谱 GLM 5.3（中文好）" },
  { id: "Pro/moonshotai/Kimi-K2.6", label: "Kimi K2.6（助手）" },
] as const;

const MODEL_IDS = new Set<string>(AVAILABLE_MODELS.map((m) => m.id));

/**
 * 这个接口每调一次就花一次上游的钱，必须对「次数」和「单次体积」都设上限：
 * 只限次数的话，一条塞满 20 万字符的消息照样能一次烧掉一大截额度。
 * 正常聊天远远碰不到这些值（一条 4000 字、一轮 20 条、总量 16000 字）。
 */
const MAX_MESSAGES = 20;
const MAX_CHARS_PER_MESSAGE = 4000;
const MAX_TOTAL_CHARS = 16_000;
/** 每个 IP 每分钟几次对话。骂人式连点会撞线，正常聊天不会 */
const RATE_LIMIT_PER_MIN = Number(process.env.CHAT_RATE_LIMIT ?? 20);

// 关闭「思维链」，避免模型默认输出一大段 reasoning 消耗 token（见 siliconflow-eval-integration skill）
function thinkingParam(model: string): Record<string, unknown> {
  if (/Qwen|inclusionAI|tencent/i.test(model)) {
    return { enable_thinking: false };
  }
  if (/zai-org|deepseek|THUDM|moonshot|Kimi/i.test(model)) {
    return { thinking: { type: "disabled" } };
  }
  return {};
}

const SYSTEM_PROMPT = `
你是「GitHub 热门项目推荐」站点里的 AI Work Buddy，职责是：
1. 优先围绕本站最新一期推荐内容回答问题；
2. 帮用户理解项目亮点、适用场景、学习路线和技术选型；
3. 对新手更友好，回答要分点、易懂、可执行；
4. 可以给出代码示例、学习建议和排错思路，但不要编造不存在的数据。

如果用户问“今天推荐什么”“哪个适合新手”“怎么开始学”，请结合站点上下文给出明确建议。
回答默认使用简洁、自然、友好的中文。
`.trim();

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * 从站内知识库里捞和这个问题相关的资料。
 *
 * 没有这一步，AI Buddy 只能看见「最新一期」，问「上次那个做图表的库叫什么」它答不上来，
 * 而知识库里其实躺着以往所有项目的教程切片和 README。
 *
 * 检索是尽力而为：知识库没建、embedding 挂了、或者超时，都只是少一段参考资料，
 * 不能让整个对话失败——所以任何异常都吞掉，退化成「仅靠最新一期上下文」回答。
 */
async function retrieveContext(query: string): Promise<{ text: string; hits: number }> {
  if (!query.trim()) return { text: "", hits: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunks = await Promise.race([
      searchKnowledge(query, 5),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 4000);
      }),
    ]);
    if (!chunks || chunks.length === 0) return { text: "", hits: 0 };
    return { text: formatRetrieved(chunks), hits: chunks.length };
  } catch {
    return { text: "", hits: 0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "未配置 SILICONFLOW_API_KEY，请在 .env 中填写" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  // 限流放在最前面：被刷的时候，连解析 body 都不该为它做
  const limit = checkRateLimit(`chat:${clientIp(req.headers)}`, {
    limit: Number.isFinite(RATE_LIMIT_PER_MIN) ? RATE_LIMIT_PER_MIN : 20,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return new Response(
      JSON.stringify({
        error: `提问太频繁了，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试。`,
      }),
      {
        status: 429,
        headers: { "content-type": "application/json", ...rateLimitHeaders(limit) },
      },
    );
  }

  let body: { messages?: ChatMessage[]; model?: string; deep?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求体不是合法 JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const messages = Array.isArray(body.messages)
    ? body.messages.filter(
        (message): message is ChatMessage =>
          !!message &&
          ["user", "assistant", "system"].includes(message.role) &&
          typeof message.content === "string" &&
          message.content.trim().length > 0,
      )
    : [];
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages 不能为空" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (messages.length > MAX_MESSAGES) {
    return new Response(
      JSON.stringify({ error: `一次最多带 ${MAX_MESSAGES} 条对话记录` }),
      { status: 413, headers: { "content-type": "application/json" } },
    );
  }
  const oversized = messages.find((m) => m.content.length > MAX_CHARS_PER_MESSAGE);
  if (oversized) {
    return new Response(
      JSON.stringify({ error: `单条消息不能超过 ${MAX_CHARS_PER_MESSAGE} 字` }),
      { status: 413, headers: { "content-type": "application/json" } },
    );
  }
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return new Response(
      JSON.stringify({ error: `一轮对话总字数不能超过 ${MAX_TOTAL_CHARS} 字` }),
      { status: 413, headers: { "content-type": "application/json" } },
    );
  }

  // 模型名白名单校验，非法值回退到默认
  const model = MODEL_IDS.has(body.model ?? "") ? body.model! : AVAILABLE_MODELS[0].id;

  try {
    const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const [issue, knowledge] = await Promise.all([
      getLatestSiteIssue(),
      retrieveContext(lastUserText),
    ]);
    const siteContext = buildAssistantContext(issue);

    // 深度模式：问题需要拆成几步、每步查不同来源时，单轮回答会漏掉一半。
    // 改成「先规划 → 逐步取证 → 反思补做 → 综合」，代价是不再流式、慢得多。
    if (body.deep === true) {
      const planned = await runPlannedAgent({
        goal: lastUserText,
        tools: [...BASE_TOOLS, knowledgeTool],
        context: `${siteContext}${knowledge.text ? `\n\n知识库资料：\n${knowledge.text}` : ""}`,
      });
      return new Response(
        JSON.stringify({
          answer: planned.answer || "没能得出结论，请换一种问法试试。",
          plan: planned.plan,
          steps: planned.steps.map((s) => ({
            goal: s.goal,
            observation: s.observation,
            tools: s.toolCalls.map((c) => ({ name: c.name, ok: c.ok })),
          })),
          warnings: planned.warnings,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json", ...rateLimitHeaders(limit) },
        },
      );
    }

    // 知识库资料单独成段，并明确「冲突时以知识库为准」：
    // 否则模型会拿自己的旧印象盖掉站内真实数据，RAG 就白接了。
    const knowledgeBlock = knowledge.text
      ? `\n\n以下是站内知识库中与用户问题相关的资料（来自以往推荐过的项目）：\n${knowledge.text}\n` +
        `如果这些资料与问题相关，优先依据它们回答，并说明出自哪个项目；\n` +
        `资料里没有的内容不要编造，可以直接说不知道。`
      : "";
    const upstream = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: `${SYSTEM_PROMPT}\n\n以下是当前站点上下文，请优先基于它回答：\n${siteContext}${knowledgeBlock}`,
          },
          ...messages.slice(-12),
        ],
        stream: true,
        max_tokens: 2048,
        ...thinkingParam(model),
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return new Response(
        JSON.stringify({ error: `上游返回 ${upstream.status}：${errText.slice(0, 300)}` }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    // 直接把上游的 SSE 流转发回前端（保持流式打字机效果）
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        // 这条回答参考了几条知识库资料，便于排查「为什么答成这样」
        "x-rag-hits": String(knowledge.hits),
        ...rateLimitHeaders(limit),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: `调用上游失败：${msg}` }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}
