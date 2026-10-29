/**
 * 构建 RAG 知识库索引。
 *
 * 用法：npm run rag:build
 *
 * 幂等：按 (repoFullName, source) 唯一键 upsert，内容没变就不重复生成向量。
 * 每天跑完 update:daily 之后再跑它，就能把当天新增的教程并进检索库。
 */
import "dotenv/config";
import { buildKnowledgeIndex } from "../src/lib/rag/index-store";

(async () => {
  console.log("开始构建知识库索引…");
  const stats = await buildKnowledgeIndex({ log: (m) => console.log(m) });

  console.log("\n========== 结果 ==========");
  console.log(`扫描仓库 ${stats.scanned} 个，写入切片 ${stats.chunks} 条，新生成向量 ${stats.embedded} 条`);
  if (stats.skipped) console.log(`跳过（向量不可用，将退化为纯 BM25）：${stats.skipped} 条`);
  if (stats.failed.length) {
    console.log(`失败 ${stats.failed.length} 项：`);
    for (const f of stats.failed.slice(0, 10)) console.log(`  - ${f}`);
  }
})();
