import { NextRequest } from "next/server";
import { buildAssistantContext, getLatestSiteIssue } from "@/lib/site-data";

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

export async function POST(req: NextRequest) {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "未配置 SILICONFLOW_API_KEY，请在 .env 中填写" }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }

  let body: { messages?: ChatMessage[]; model?: string };
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

  // 模型名白名单校验，非法值回退到默认
  const model = MODEL_IDS.has(body.model ?? "") ? body.model! : AVAILABLE_MODELS[0].id;

  try {
    const issue = await getLatestSiteIssue();
    const siteContext = buildAssistantContext(issue);
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
            content: `${SYSTEM_PROMPT}\n\n以下是当前站点上下文，请优先基于它回答：\n${siteContext}`,
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
