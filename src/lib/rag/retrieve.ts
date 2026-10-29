import { prisma } from "../prisma";
import { BM25Index, cosine, parseEmbedding, rrfFuse } from "./bm25";
import { embed } from "../ai/llm";

/**
 * 混合检索：BM25（字面）+ 向量（语义），用 RRF 融合。
 *
 * 之所以要两路：
 * - 用户问「ripgrep 怎么装」这种带专有名词的，BM25 一击命中，向量可能把它和别的 CLI 工具混在一起；
 * - 用户问「有没有适合新手的 Rust 练手项目」这种描述性的，BM25 一个词都对不上，只有向量能救。
 * 单用任何一路都会在某些问法上翻车。
 */

export interface RetrievedChunk {
  repoFullName: string;
  source: string;
  content: string;
  score: number;
  /** 这一条是被哪一路召回的，便于排查「为什么搜出这个」 */
  matchedBy: string[];
}

interface LoadedChunks {
  ids: string[];
  docs: { id: string; content: string }[];
  meta: Map<string, { repoFullName: string; source: string; content: string }>;
  vectors: Map<string, number[]>;
  index: BM25Index;
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: { data: LoadedChunks; at: number } | null = null;

export function invalidateKnowledgeCache(): void {
  cache = null;
}

async function load(): Promise<LoadedChunks> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const rows = await prisma.knowledgeChunk.findMany({
    select: { id: true, repoFullName: true, source: true, content: true, embedding: true },
  });

  const docs = rows.map((r) => ({ id: r.id, content: r.content }));
  const meta = new Map(rows.map((r) => [r.id, { repoFullName: r.repoFullName, source: r.source, content: r.content }]));
  const vectors = new Map<string, number[]>();
  for (const r of rows) {
    const v = parseEmbedding(r.embedding);
    if (v) vectors.set(r.id, v);
  }

  const data: LoadedChunks = {
    ids: rows.map((r) => r.id),
    docs,
    meta,
    vectors,
    index: new BM25Index(docs),
  };
  cache = { data, at: Date.now() };
  return data;
}

export async function searchKnowledge(query: string, topK = 5): Promise<RetrievedChunk[]> {
  const q = query.trim();
  if (!q) return [];

  const { docs, meta, vectors, index } = await load();
  if (docs.length === 0) return [];

  const bm25Hits = index.search(q, topK * 3);

  // 向量这一路是可选的：embedding 接口挂了、或还没建过索引，就退化成纯 BM25，
  // 绝不能因为检索层报错让整个 agent 崩掉
  let vectorHits: { id: string; score: number }[] = [];
  if (vectors.size > 0) {
    const qv = await embed([q]);
    if (qv?.[0]) {
      vectorHits = [...vectors.entries()]
        .map(([id, v]) => ({ id, score: cosine(qv[0], v) }))
        .filter((h) => h.score > 0.25)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK * 3);
    }
  }

  const fused = rrfFuse([bm25Hits, vectorHits], topK);

  return fused.map((hit) => {
    const m = meta.get(hit.id);
    const matchedBy: string[] = [];
    if (bm25Hits.some((h) => h.id === hit.id)) matchedBy.push("bm25");
    if (vectorHits.some((h) => h.id === hit.id)) matchedBy.push("vector");
    return {
      repoFullName: m?.repoFullName ?? "",
      source: m?.source ?? "",
      content: m?.content ?? "",
      score: hit.score,
      matchedBy,
    };
  });
}

/** 把检索结果渲染成喂给模型的文本（带出处，方便模型引用与读者核对） */
export function formatRetrieved(chunks: RetrievedChunk[], maxChars = 1800): string {
  if (chunks.length === 0) return "知识库中没有检索到相关内容。";
  const parts: string[] = [];
  let used = 0;
  chunks.forEach((c, i) => {
    const body = c.content.slice(0, 600);
    if (used + body.length > maxChars) return;
    used += body.length;
    parts.push(`[${i + 1}] ${c.repoFullName}（来源：${c.source}${c.matchedBy.length ? `，命中：${c.matchedBy.join("+")}` : ""}）\n${body}`);
  });
  return parts.join("\n\n");
}
