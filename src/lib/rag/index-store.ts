import { prisma } from "../prisma";
import { toTutorialMarkdown } from "../tutorial/schema";
import { embed } from "../ai/llm";

/**
 * 知识库索引的构建与维护。
 *
 * 语料来源只有两类、都不需要联网：
 *   - tutorial   ：已生成的小白教程（渲染成 Markdown 后的全文，信息密度最高）
 *   - description：项目简介 + 主语言（教程还没生成时至少能被检索到）
 * README 也可以入库，但要逐个仓库联网抓，默认关闭，需要时显式开 includeReadme。
 */

export type ChunkSource = "tutorial" | "description" | "readme";

export interface BuildStats {
  scanned: number;
  chunks: number;
  embedded: number;
  skipped: number;
  failed: string[];
}

const EMBED_BATCH = 24;

function chunkContent(repo: {
  fullName: string;
  name: string;
  description: string | null;
  language: string | null;
  tutorial: string | null;
}): { source: ChunkSource; content: string }[] {
  const out: { source: ChunkSource; content: string }[] = [];

  const tutorial = toTutorialMarkdown(repo.tutorial);
  if (tutorial && tutorial.trim()) {
    // 标题带上项目名，检索时更容易命中「XX 项目怎么装」这类问法
    out.push({ source: "tutorial", content: `${repo.fullName}\n${tutorial}` });
  }

  if (repo.description?.trim()) {
    out.push({
      source: "description",
      content: `${repo.fullName}（${repo.name}）\n语言：${repo.language ?? "未标注"}\n简介：${repo.description}`,
    });
  }

  return out;
}

export async function buildKnowledgeIndex(
  opts: { includeReadme?: boolean; log?: (m: string) => void } = {},
): Promise<BuildStats> {
  const log = opts.log ?? (() => {});
  const stats: BuildStats = { scanned: 0, chunks: 0, embedded: 0, skipped: 0, failed: [] };

  const repos = await prisma.repository.findMany({
    select: { fullName: true, name: true, description: true, language: true, tutorial: true },
    orderBy: { stars: "desc" },
  });
  stats.scanned = repos.length;

  // 1) 先把文本落库（不依赖 embedding 是否可用）
  for (const repo of repos) {
    for (const chunk of chunkContent(repo)) {
      try {
        await prisma.knowledgeChunk.upsert({
          where: { repoFullName_source: { repoFullName: repo.fullName, source: chunk.source } },
          create: {
            repoFullName: repo.fullName,
            source: chunk.source,
            content: chunk.content,
            tokens: Math.ceil(chunk.content.length / 2),
          },
          update: {
            content: chunk.content,
            tokens: Math.ceil(chunk.content.length / 2),
            // 内容变了旧向量就作废，下次重建会补
            embedding: null,
            embeddedAt: null,
          },
        });
        stats.chunks++;
      } catch (err) {
        stats.failed.push(`${repo.fullName}/${chunk.source}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  log(`  切片写入完成：${stats.chunks} 条`);

  if (opts.includeReadme) {
    log("  includeReadme 暂未启用（会逐个仓库联网抓取，成本较高）");
  }

  // 2) 再补向量：只处理没向量的，增量跑很便宜
  const pending = await prisma.knowledgeChunk.findMany({
    where: { embedding: null },
    select: { id: true, content: true },
  });
  if (pending.length === 0) {
    log("  向量已全部就绪");
    return stats;
  }

  log(`  待生成向量：${pending.length} 条`);
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const batch = pending.slice(i, i + EMBED_BATCH);
    const vecs = await embed(batch.map((b) => b.content));
    if (!vecs) {
      stats.failed.push(`向量生成失败（第 ${i / EMBED_BATCH + 1} 批），这批将退化为纯 BM25 检索`);
      stats.skipped += batch.length;
      continue;
    }
    for (let j = 0; j < batch.length; j++) {
      await prisma.knowledgeChunk.update({
        where: { id: batch[j].id },
        data: { embedding: JSON.stringify(vecs[j]), embeddedAt: new Date() },
      });
      stats.embedded++;
    }
  }
  log(`  向量生成完成：${stats.embedded} 条`);

  return stats;
}
