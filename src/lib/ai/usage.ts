/**
 * token 用量与成本折算。
 *
 * 这里刻意**不**内置任何单价表：模型定价几个月就调一次，写死在代码里的数字
 * 迟早变成错数据，而错的成本比没有成本更糟——你会拿它做决策。
 * 所以单价走配置（LLM_PRICING_JSON），没配就只报 token，不报金额。
 *
 * 单位统一为「元 / 每百万 token」，和硅基流动计价页的口径一致。
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const EMPTY_USAGE: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/** 单个模型的单价：元 / 百万 token */
export interface ModelPrice {
  in: number;
  out: number;
}

export type PricingTable = Record<string, ModelPrice>;

/**
 * 从环境变量读单价表，形如：
 *   {"deepseek-ai/DeepSeek-V4-Pro":{"in":4,"out":16},"*":{"in":2,"out":8}}
 * "*" 是兜底项，没匹配到具体模型时用它。
 */
export function pricingFromEnv(raw: string | undefined): PricingTable {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const table: PricingTable = {};
    for (const [model, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<ModelPrice> | null;
      if (!v || typeof v.in !== "number" || typeof v.out !== "number") continue;
      table[model] = { in: v.in, out: v.out };
    }
    return table;
  } catch {
    // 配错了就当没配：宁可只报 token，也不要拿一份坏单价算钱
    return {};
  }
}

/** 没配单价时返回 null，调用方要能接受「只有 token 没有钱」 */
export function costOf(
  usage: TokenUsage,
  model: string,
  pricing: PricingTable = pricingFromEnv(process.env.LLM_PRICING_JSON),
): number | null {
  const price = pricing[model] ?? pricing["*"];
  if (!price) return null;
  const yuan =
    (usage.promptTokens / 1_000_000) * price.in + (usage.completionTokens / 1_000_000) * price.out;
  // 一次调用几分钱的零头没有意义，保留 4 位小数（0.0001 元）足够
  return Math.round(yuan * 10_000) / 10_000;
}

/** 把可能为空的成本渲染成人能读的样子 */
export function formatCost(costCny: number | null): string {
  if (costCny === null) return "—（未配置 LLM_PRICING_JSON）";
  return `¥${costCny.toFixed(4)}`;
}

/** 大数字加千分位，报告里好扫 */
export function formatTokens(n: number): string {
  return n.toLocaleString("zh-CN");
}

/**
 * 从上游响应里取 usage。
 * 各家字段位置不完全一致（有的在顶层、有的在 choices 里），而且流式响应
 * 经常干脆不给，所以取不到就返回 0 —— 不能因为少了用量就判定调用失败。
 */
export function extractUsage(data: unknown): TokenUsage {
  const u = (data as { usage?: Record<string, unknown> } | null)?.usage;
  if (!u) return EMPTY_USAGE;
  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = u[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return 0;
  };
  const promptTokens = num("prompt_tokens", "promptTokens", "input_tokens");
  const completionTokens = num("completion_tokens", "completionTokens", "output_tokens");
  const total = num("total_tokens", "totalTokens");
  return {
    promptTokens,
    completionTokens,
    totalTokens: total || promptTokens + completionTokens,
  };
}
