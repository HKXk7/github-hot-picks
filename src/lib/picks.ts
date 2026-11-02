/**
 * 项目分类 + 每期摘要。
 * ======================
 * 这两件事原来散在日更脚本里，抽出来是因为**它们错了不会报错，只会安静地别扭一整期**：
 * 分类贴错没人发现，摘要是句万能套话。抽成纯函数才能被单测兜住。
 */

import { formatStars } from "./format";

export const CATEGORIES = ["AI", "前端", "后端", "工具", "其他"] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * topics 是作者自己标的，比我们从项目名里正则猜准得多。
 * 举例：一个叫 gpu-unlock 的项目，光看名字像"工具"，但作者标了 machine-learning
 * ——它其实是给 AI 训练提速的。所以先看 topics，看不出来再回退到关键词。
 */
const TOPIC_HINTS: Record<Exclude<Category, "其他">, string[]> = {
  AI: [
    "ai", "artificial-intelligence", "llm", "large-language-model", "machine-learning",
    "deep-learning", "neural-network", "gpt", "chatgpt", "openai", "transformer",
    "diffusion", "stable-diffusion", "computer-vision", "nlp", "agent", "ai-agent",
    "rag", "inference", "mlops", "pytorch", "tensorflow", "onnx", "embedding",
  ],
  前端: [
    "frontend", "front-end", "web", "website", "react", "vue", "svelte", "angular",
    "nextjs", "nuxt", "ui", "ui-components", "design-system", "css", "tailwindcss",
    "tailwind", "component-library", "browser-extension", "chrome-extension", "canvas",
    "animation", "figma",
  ],
  后端: [
    "backend", "back-end", "server", "api", "rest-api", "graphql", "database", "sql",
    "postgres", "postgresql", "mysql", "sqlite", "redis", "microservices", "distributed-system",
    "kubernetes", "docker", "devops", "orm", "grpc",
  ],
  工具: [
    "cli", "command-line", "command-line-tool", "tool", "tools", "utility", "utils",
    "sdk", "library", "framework", "automation", "script", "terminal", "tui",
    "productivity", "dotfiles", "plugin", "extension",
  ],
};

/** topics 命中不了时，从名字/描述里猜。顺序即优先级：AI 先判，避免把 LLM 项目归成工具 */
const KEYWORD_RULES: Array<[RegExp, Category]> = [
  [/\b(ai|llm|gpt|agent|ml|deep|neural|infer|model|chat|diffusion|rag)\b/i, "AI"],
  [/\b(react|vue|next|front|web|ui|css|tailwind|component|browser|extension)\b/i, "前端"],
  [/\b(rust|go|python|java|server|api|database|sql|backend|redis|docker)\b/i, "后端"],
  [/\b(cli|tool|sdk|lib|framework|util|dev|terminal|plugin)\b/i, "工具"],
];

export interface CategorizeInput {
  name: string;
  description?: string | null;
  topics?: string[] | null;
}

export function categorize(input: CategorizeInput): Category {
  for (const topic of input.topics ?? []) {
    const t = topic.toLowerCase();
    for (const [category, hints] of Object.entries(TOPIC_HINTS) as [Exclude<Category, "其他">, string[]][]) {
      if (hints.includes(t)) return category;
    }
  }

  const text = `${input.name} ${input.description ?? ""} ${(input.topics ?? []).join(" ")}`;
  for (const [pattern, category] of KEYWORD_RULES) {
    if (pattern.test(text)) return category;
  }
  return "其他";
}

export interface SummaryPick {
  fullName: string;
  stars: number;
  category?: string | null;
  /** 推荐名次，1 为榜首。不传时退化为取 star 最高的 */
  rank?: number;
}

/**
 * 每期摘要原来是一句固定套话（"今天挑选出 10 个值得关注的项目…"），
 * 每期都一样，等于没说。改成从数据里现算：方向分布 + 榜首是谁，
 * 首页和 AI Buddy 的上下文都用得上它。
 */
export function buildIssueSummary(picks: SummaryPick[]): string {
  if (picks.length === 0) return "本期还没有推荐项目。";

  const counts = new Map<string, number>();
  for (const pick of picks) {
    const key = pick.category ?? "其他";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  // 数量相同按分类固定顺序排，保证同一期每次算出来都一样
  const order = new Map<string, number>(CATEGORIES.map((c, i) => [c, i]));
  const breakdown = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([category, count]) => `${category} ${count}`)
    .join(" · ");

  // 榜首按名次取，而不是按数组里谁排在前面——调用方传的顺序不该影响结论
  const top = [...picks].sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER) || b.stars - a.stars,
  )[0];
  return `本期 ${picks.length} 个项目（${breakdown}），榜首 ${top.fullName} 拿到 ${formatStars(top.stars)} star。`;
}
