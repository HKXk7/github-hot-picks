/**
 * 全项目唯一的 LLM 调用层。
 *
 * 为什么要有这一层：
 * 之前教程生成是「拼 prompt → fetch → 取 content」三步散在业务代码里，
 * 一旦要加工具调用，消息结构就从单轮变成多轮（含 tool / tool_calls 角色），
 * 散着写必然失控。这里把 OpenAI 兼容协议（硅基流动用的就是这套）收口，
 * 上层只管拼消息和解析结果。
 */

export const SF_BASE = process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1";
export const SF_KEY = process.env.SILICONFLOW_API_KEY ?? "";

export function hasApiKey(): boolean {
  return SF_KEY.length > 0;
}

// ---------- OpenAI 兼容消息格式 ----------
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** assistant 消息：模型要求调用哪些工具 */
  tool_calls?: ToolCall[];
  /** tool 消息：这条结果对应哪个 tool_call */
  tool_call_id?: string;
  /** tool 消息：对应的函数名，部分模型要求带 */
  name?: string;
}

/** 工具声明（OpenAI function calling 的 JSON Schema 子集） */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** "auto" | "none" | { type:"function", function:{name} } */
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
  maxTokens?: number;
  temperature?: number;
  /** JSON 模式；部分模型（GLM 系）不支持，调用方需能降级 */
  jsonMode?: boolean;
  /** 关思维链。带 tools 时建议关掉，否则模型容易把推理写进文本里 */
  disableThinking?: boolean;
  timeoutMs?: number;
  /** 429/5xx 退避次数 */
  maxRetries?: number;
  onRetry?: (info: { attempt: number; reason: string; waitMs: number }) => void;
}

export type ChatOutcome =
  | {
      ok: true;
      message: ChatMessage;
      finishReason: string | null;
      /** 本次调用是否真的用了降级手段，供上层记录 */
      degraded: string[];
    }
  | { ok: false; error: string; status?: number };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function chat(opts: ChatOptions): Promise<ChatOutcome> {
  const {
    model,
    messages,
    tools,
    toolChoice,
    maxTokens = 1600,
    temperature = 0.3,
    jsonMode = false,
    disableThinking = true,
    timeoutMs = 90_000,
    maxRetries = 2,
    onRetry,
  } = opts;

  if (!SF_KEY) return { ok: false, error: "未配置 SILICONFLOW_API_KEY" };

  const degraded: string[] = [];
  // JSON 模式 / 思维链这两个开关都不是所有模型都吃，失败就剥掉重试，
  // 而不是直接判死——不同厂商的兼容层差异很大。
  let useJsonMode = jsonMode;
  let useThinkingOff = disableThinking;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      stream: false,
    };
    if (tools?.length) body.tools = tools;
    if (toolChoice && tools?.length) body.tool_choice = toolChoice;
    if (useJsonMode) body.response_format = { type: "json_object" };
    if (useThinkingOff) body.thinking = { type: "disabled" };

    let res: Response;
    let text: string;
    try {
      res = await fetch(`${SF_BASE}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${SF_KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === maxRetries) return { ok: false, error: `网络异常：${msg}` };
      const wait = 800 * 2 ** attempt;
      onRetry?.({ attempt: attempt + 1, reason: `网络异常 ${msg}`, waitMs: wait });
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      const lower = text.toLowerCase();
      // 模型不吃 response_format → 降级为纯 prompt 约束
      if (res.status === 400 && useJsonMode && /json[_ ]?mode|response_format|json_object/.test(lower)) {
        degraded.push("该模型不支持 response_format，降级为纯 prompt 约束");
        useJsonMode = false;
        attempt -= 1;
        continue;
      }
      // 模型不吃 thinking 字段 → 剥掉
      if (res.status === 400 && useThinkingOff && /thinking/.test(lower)) {
        degraded.push("该模型不支持 thinking 字段，已剥除");
        useThinkingOff = false;
        attempt -= 1;
        continue;
      }
      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === maxRetries) {
        return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 300)}`, status: res.status };
      }
      const wait = 800 * 2 ** attempt + Math.floor(Math.random() * 300);
      onRetry?.({ attempt: attempt + 1, reason: `HTTP ${res.status}`, waitMs: wait });
      await sleep(wait);
      continue;
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, error: `响应不是合法 JSON：${text.slice(0, 200)}` };
    }

    const choice = data?.choices?.[0];
    if (!choice) return { ok: false, error: `响应缺少 choices：${text.slice(0, 200)}` };

    return {
      ok: true,
      message: {
        role: "assistant",
        content: choice?.message?.content ?? null,
        ...(choice?.message?.tool_calls?.length ? { tool_calls: choice.message.tool_calls } : {}),
      },
      finishReason: choice?.finish_reason ?? null,
      degraded,
    };
  }

  return { ok: false, error: "重试耗尽" };
}

// ---------- embeddings（RAG 用） ----------
export const EMBEDDING_MODEL = "BAAI/bge-m3";
/** bge-m3 输出 1024 维 */
export const EMBEDDING_DIM = 1024;

/**
 * 把一批文本转成向量。
 * 返回 null 表示失败（网络/额度），调用方要能退化到纯 BM25 检索，不能让主流程崩。
 */
export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!SF_KEY || texts.length === 0) return null;
  try {
    const res = await fetch(`${SF_BASE}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SF_KEY}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vecs = (data.data ?? []).map((d) => d.embedding).filter((v): v is number[] => Array.isArray(v));
    return vecs.length === texts.length ? vecs : null;
  } catch {
    return null;
  }
}
