import type { Tool } from "./types";
import { str } from "./types";
import { formatRetrieved, searchKnowledge } from "../../rag/retrieve";

/**
 * 站内知识库检索工具。
 *
 * 和前面几个「联网取证」工具互补：那几个解决「这个项目到底是什么」，
 * 这个解决「我们站里已经有哪些相关资料」——比如用户问「推荐过哪些 Rust 项目」，
 * 光靠 GitHub API 是答不出来的，必须检索自己积累的教程语料。
 */
export const knowledgeTool: Tool = {
  spec: {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "在本站已积累的开源项目教程库里做语义检索，返回最相关的几个项目片段及其出处。适合回答『推荐过哪些某类项目』『有没有类似 X 的项目』这类需要回顾历史内容的问题；查单个项目的具体细节请优先用 fetch_readme。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "检索意图，写成自然语言问题或关键词组合均可" },
          topK: { type: "number", description: "返回几条，默认 3，最多 5" },
        },
        required: ["query"],
      },
    },
  },
  async execute(args) {
    const query = str(args.query);
    if (!query) return "参数错误：缺少 query。";
    const topK = typeof args.topK === "number" ? Math.min(Math.max(Math.trunc(args.topK), 1), 5) : 3;
    try {
      const chunks = await searchKnowledge(query, topK);
      return formatRetrieved(chunks);
    } catch (err) {
      return `检索失败：${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
