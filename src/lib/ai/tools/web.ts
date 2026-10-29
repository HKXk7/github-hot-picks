import type { Tool } from "./types";
import { str, truncate } from "./types";

/**
 * 统一的网络读取：所有工具都走这里，统一超时、UA、鉴权。
 * 抓外部站点失败是常态（限流、404、网络抖动），所以一律返回 null 而不是抛错。
 */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; accept?: string; auth?: boolean } = {},
): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "github-hot-picks",
      ...(opts.accept ? { Accept: opts.accept } : {}),
      ...(opts.auth && process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    };
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function fetchJson<T>(url: string, opts?: Parameters<typeof fetchText>[1]): Promise<T | null> {
  const text = await fetchText(url, { accept: "application/json", ...opts });
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ============================================================
// 工具 1：仓库元数据
// ============================================================
interface GhRepo {
  full_name?: string;
  description?: string | null;
  language?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  topics?: string[];
  homepage?: string | null;
  license?: { spdx_id?: string | null } | null;
  default_branch?: string;
  pushed_at?: string;
  archived?: boolean;
}

export const repoMetaTool: Tool = {
  spec: {
    type: "function",
    function: {
      name: "fetch_repo_meta",
      description:
        "获取一个 GitHub 仓库的权威元数据：简介、主语言、star/fork 数、topics、官网、开源协议、默认分支、最近推送时间、是否已归档。需要确认项目的真实信息时用这个工具，不要凭印象作答。",
      parameters: {
        type: "object",
        properties: {
          fullName: { type: "string", description: '仓库全名，格式 "owner/repo"，例如 "vercel/next.js"' },
        },
        required: ["fullName"],
      },
    },
  },
  async execute(args) {
    const fullName = str(args.fullName);
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return "参数错误：fullName 必须是 owner/repo 形式。";
    const r = await fetchJson<GhRepo>(`https://api.github.com/repos/${fullName}`, { auth: true });
    if (!r) return `无法获取 ${fullName} 的元数据（仓库可能不存在、已私有，或 GitHub API 限流）。`;
    return truncate(
      [
        `仓库：${r.full_name ?? fullName}`,
        r.description ? `简介：${r.description}` : null,
        r.language ? `主语言：${r.language}` : null,
        `Star ${r.stargazers_count ?? "?"} / Fork ${r.forks_count ?? "?"}`,
        r.topics?.length ? `标签：${r.topics.join("、")}` : null,
        r.homepage ? `官网：${r.homepage}` : null,
        r.license?.spdx_id ? `协议：${r.license.spdx_id}` : null,
        r.default_branch ? `默认分支：${r.default_branch}` : null,
        r.pushed_at ? `最近推送：${r.pushed_at.slice(0, 10)}` : null,
        r.archived ? "⚠️ 该仓库已归档（不再维护）" : null,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  },
};

// ============================================================
// 工具 2：README 正文
// ============================================================
/**
 * README 里噪音很多（徽章、图片、HTML、超长目录），直接喂给模型会白白吃掉几千 token。
 * 这里做一次清洗：去 HTML 标签、去图片、去徽章行、压缩空行。
 */
export function cleanReadme(md: string): string {
  return md
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .replace(/^\s*\|?\s*:?-+\s*\|.*$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const readmeTool: Tool = {
  spec: {
    type: "function",
    function: {
      name: "fetch_readme",
      description:
        "抓取一个 GitHub 仓库 README 的正文（已自动去掉徽章和图片）。写安装步骤、功能用法、注意事项之前必须先看 README，这是唯一可信的一手资料。",
      parameters: {
        type: "object",
        properties: {
          fullName: { type: "string", description: '仓库全名，格式 "owner/repo"' },
          maxChars: { type: "number", description: "最多返回多少字符，默认 3000，需要看安装细节时可以调大到 8000" },
        },
        required: ["fullName"],
      },
    },
  },
  async execute(args) {
    const fullName = str(args.fullName);
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) return "参数错误：fullName 必须是 owner/repo 形式。";
    const limit = typeof args.maxChars === "number" ? Math.min(Math.max(args.maxChars, 500), 12000) : 3000;

    // 首选 GitHub API 的 readme 端点：一次请求拿到默认分支的 README，
    // 不用猜 master/main，也不用逐个候选文件名去撞（那套在本机网络下会拖到十几秒）。
    const viaApi = await fetchText(`https://api.github.com/repos/${fullName}/readme`, {
      accept: "application/vnd.github.raw",
      auth: true,
      timeoutMs: 12_000,
    });
    if (viaApi) {
      const cleaned = cleanReadme(viaApi);
      if (cleaned.length >= 20) return truncate(cleaned, limit);
    }

    // 兜底：直接取 raw 源，只试默认分支，失败就认了，不再穷举
    const meta = await fetchJson<GhRepo>(`https://api.github.com/repos/${fullName}`, { auth: true });
    const branch = meta?.default_branch ?? "main";
    const raw = await fetchText(`https://raw.githubusercontent.com/${fullName}/${branch}/README.md`, {
      timeoutMs: 8_000,
    });
    if (raw) {
      const cleaned = cleanReadme(raw);
      if (cleaned.length >= 20) return truncate(cleaned, limit);
    }

    return `未能抓取到 ${fullName} 的 README（可能是私有仓库、无 README，或 GitHub 接口限流）。`;
  },
};
