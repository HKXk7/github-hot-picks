import { NextRequest } from "next/server";
import { buildAssistantContext, getLatestSiteIssue } from "@/lib/site-data";
import { formatRetrieved, searchKnowledge } from "@/lib/rag/retrieve";
import { runPlannedAgent } from "@/lib/ai/planner";
import { BASE_TOOLS } from "@/lib/ai/tools";
import { knowledgeTool } from "@/lib/ai/tools/knowledge";
import { checkRateLimit, clientIp, rateLimitHeaders } from "@/lib/rate-limit";
// 副作用导入：把 LLM 用量接到数据库。放在最上面，确保后续调用都能被记下来。
import "@/lib/ai/observability";
import { emitCall, newTraceId, withTrace } from "@/lib/ai/usage-sink";
import { extractUsage } from "@/lib/ai/usage";
import {
  createSession,
  loadHistory,
  maybeSummarize,
  resolveSession,
  saveTurn,
  trimHistory,
} from "@/lib/chat-session";

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
 */
const MAX_CHARS_PER_MESSAGE = 4000;
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

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
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

/** 会话 id 由服务端发：客户端不能自己造 id 往库里灌 */
async function ensureSession(sessionId: unknown): Promise<string> {
  if (typeof sessionId === "string") {
    const resolved = await resolveSession(sessionId);
    if (resolved) return resolved;
  }
  return createSession();
}

/** 把上游 SSE 流里的正文拼回一整段，用于存进会话历史 */
function extractSseText(raw: string): string {
  let out = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[];
        usage?: unknown;
      };
      const delta = obj.choices?.[0]?.delta?.content;
      if (delta) out += delta;
    } catch {
      // 流里偶尔会有非 JSON 的心跳行，跳过即可
    }
  }
  return out;
}

function callUpstream(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
}

/** 取历史。GET /api/chat?sessionId=xxx */
export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return json({ messages: [], summary: null });
  const resolved = await resolveSession(sessionId);
  if (!resolved) return json({ messages: [], summary: null });
  const history = await loadHistory(resolved);
  return json(
    { sessionId: resolved, messages: history.messages, summary: history.summary },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    // 公开演示站默认不带密钥（不该把私有密钥塞进部署环境）。
    // 给一句能照着做的话，而不是丢个 500 让访客以为站点坏了。
    return json(
      { error: "公开演示站未接入模型密钥，AI 问答暂不可用；克隆仓库并在 .env 配置 SILICONFLOW_API_KEY 后即可启用。" },
      { status: 503 },
    );
  }

  // 限流放在最前面：被刷的时候，连解析 body 都不该为它做
  const limit = checkRateLimit(`chat:${clientIp(req.headers)}`, {
    limit: Number.isFinite(RATE_LIMIT_PER_MIN) ? RATE_LIMIT_PER_MIN : 20,
    windowMs: 60_000,
  });
  if (!limit.ok) {
    return json(
      { error: `提问太频繁了，请 ${Math.ceil(limit.retryAfterMs / 1000)} 秒后再试。` },
      { status: 429, headers: rateLimitHeaders(limit) },
    );
  }

  let body: { sessionId?: unknown; message?: unknown; model?: string; deep?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "message 不能为空" }, { status: 400 });
  if (message.length > MAX_CHARS_PER_MESSAGE) {
    return json({ error: `单条消息不能超过 ${MAX_CHARS_PER_MESSAGE} 字` }, { status: 413 });
  }

  const model = MODEL_IDS.has(body.model ?? "") ? body.model! : AVAILABLE_MODELS[0].id;
  const trace = { id: newTraceId("chat"), kind: "chat", label: "对话" };

  try {
    const sessionId = await ensureSession(body.sessionId);
    const [{ messages: rawHistory, summary }, issue, knowledge] = await Promise.all([
      loadHistory(sessionId),
      getLatestSiteIssue(),
      withTrace(trace, () => retrieveContext(message)),
    ]);
    const siteContext = buildAssistantContext(issue);

    // 多轮上下文 = 站点上下文 + 早期对话的滚动摘要 + 最近若干轮原文。
    // 摘要是压缩过的历史，不带上它，用户说的「刚才那个项目」模型就接不上。
    const summaryBlock = summary
      ? `\n\n以下是你们之前聊过的内容摘要（更早的对话已压缩）：\n${summary}\n` +
        `如果用户提到「刚才/上面/之前说的」，请依据这段摘要理解。`
      : "";
    const knowledgeBlock = knowledge.text
      ? `\n\n以下是站内知识库中与用户问题相关的资料（来自以往推荐过的项目）：\n${knowledge.text}\n` +
        `如果这些资料与问题相关，优先依据它们回答，并说明出自哪个项目；\n` +
        `资料里没有的内容不要编造，可以直接说不知道。`
      : "";
    const systemContent = `${SYSTEM_PROMPT}\n\n以下是当前站点上下文，请优先基于它回答：\n${siteContext}${summaryBlock}${knowledgeBlock}`;

    const history = trimHistory(rawHistory);
    const upstreamMessages = [
      { role: "system" as const, content: systemContent },
      ...history,
      { role: "user" as const, content: message },
    ];

    // 深度模式：问题需要拆成几步、每步查不同来源时，单轮回答会漏掉一半。
    // 改成「先规划 → 逐步取证 → 反思补做 → 综合」，代价是不再流式、慢得多。
    if (body.deep === true) {
      const planned = await withTrace({ ...trace, label: "深度模式" }, () =>
        runPlannedAgent({
          goal: message,
          tools: [...BASE_TOOLS, knowledgeTool],
          context: `${siteContext}${summaryBlock}${knowledge.text ? `\n\n知识库资料：\n${knowledge.text}` : ""}`,
        }),
      );
      const answer = planned.answer || "没能得出结论，请换一种问法试试。";
      await saveTurn(sessionId, message, answer);
      void maybeSummarize(sessionId);
      return json(
        {
          sessionId,
          answer,
          plan: planned.plan,
          steps: planned.steps.map((s) => ({
            goal: s.goal,
            observation: s.observation,
            tools: s.toolCalls.map((c) => ({ name: c.name, ok: c.ok })),
          })),
          warnings: planned.warnings,
        },
        { headers: rateLimitHeaders(limit) },
      );
    }

    const baseBody = {
      model,
      messages: upstreamMessages,
      stream: true,
      max_tokens: 2048,
      ...thinkingParam(model),
    };

    // 让上游在流的最后带一段 usage。没有它，流式这条链路就完全不知道花了多少 token。
    let upstream = await callUpstream(apiKey, { ...baseBody, stream_options: { include_usage: true } });
    // 不是所有兼容层都认 stream_options，认不出来就退回不带它重发一次，
    // 而不是直接让整条对话失败。
    if (!upstream.ok) {
      const errText = await upstream.text();
      if (/stream_options/i.test(errText)) {
        upstream = await callUpstream(apiKey, baseBody);
      }
      if (!upstream.ok) {
        return json(
          { error: `上游返回 ${upstream.status}：${errText.slice(0, 300)}` },
          { status: 502, headers: rateLimitHeaders(limit) },
        );
      }
    } else if (!upstream.body) {
      return json({ error: "上游没有返回内容" }, { status: 502 });
    }

    const startedAt = performance.now();
    const decoder = new TextDecoder();
    let raw = "";
    let usageSeen = false;

    // 一边把流原样转发给前端，一边把内容攒下来存进会话、把用量记进库。
    // flush 会在流关闭前 await，所以入库能赶在请求结束前完成。
    const recorder = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        raw += decoder.decode(chunk, { stream: true });
      },
      async flush() {
        raw += decoder.decode();
        const text = extractSseText(raw);
        if (text.trim()) await saveTurn(sessionId, message, text);

        // 最后一个 SSE 包里通常带 usage（前提是上游接受了 stream_options）
        for (const line of raw.split("\n").reverse()) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          try {
            const obj = JSON.parse(t.slice(5).trim()) as Record<string, unknown>;
            if (obj.usage) {
              emitCall({
                traceId: trace.id,
                kind: trace.kind,
                label: trace.label,
                model,
                usage: extractUsage(obj),
                latencyMs: Math.round(performance.now() - startedAt),
                ok: true,
              });
              usageSeen = true;
              break;
            }
          } catch {
            // 忽略非 JSON 行
          }
        }
        if (!usageSeen) {
          // 上游没给用量也要记一条：至少知道「这次调用发生过、花了多久」，
          // 否则对话的成本在系统里是彻底看不见的。
          emitCall({
            traceId: trace.id,
            kind: trace.kind,
            label: trace.label,
            model,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            latencyMs: Math.round(performance.now() - startedAt),
            ok: true,
          });
        }
        // 折叠历史这件慢事放在流结束之后，不占用用户等首字的时间
        void maybeSummarize(sessionId);
      },
    });

    return new Response(upstream.body!.pipeThrough(recorder), {
      status: 200,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-session-id": sessionId,
        // 这条回答参考了几条知识库资料，便于排查「为什么答成这样」
        "x-rag-hits": String(knowledge.hits),
        ...rateLimitHeaders(limit),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: `调用上游失败：${msg}` }, { status: 502 });
  }
}
