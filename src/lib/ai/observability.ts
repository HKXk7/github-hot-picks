/**
 * 把用量落到数据库。
 *
 * 用法：在入口（脚本、API 路由）里 `import "@/lib/ai/observability"` 一次即可，
 * 模块加载时会自动注册 sink。放在入口而不是 llm.ts 里，是为了让网络层
 * 保持不依赖数据库——单元测试和纯 prompt 场景下它照样能跑。
 *
 * 写入是「尽力而为」的：没有数据库、表还没迁移、磁盘满了，都只是一条
 * 没记上的用量，绝不能反过来拖垮一次正在进行的生成。
 */

import { prisma } from "../prisma";
import { setUsageSink, type LlmCallRecord } from "./usage-sink";
import { costOf } from "./usage";

/**
 * 关掉上报的开关。跑评测时想排除观测本身的干扰、或者部署到没有库的
 * 只读环境时用得上。
 */
function disabled(): boolean {
  return process.env.LLM_TRACE === "off";
}

function toDbRecord(r: LlmCallRecord) {
  return {
    traceId: r.traceId,
    kind: r.kind,
    label: r.label ?? null,
    model: r.model,
    promptTokens: r.usage.promptTokens,
    completionTokens: r.usage.completionTokens,
    totalTokens: r.usage.totalTokens,
    // 单价会变，所以在写入这一刻折算并存下来，而不是事后拿新价重算历史
    costCny: costOf(r.usage, r.model),
    latencyMs: r.latencyMs,
    ok: r.ok,
    error: r.error ?? null,
    degraded: r.degraded?.length ? JSON.stringify(r.degraded) : null,
  };
}

let warned = false;

setUsageSink((record: LlmCallRecord) => {
  if (disabled()) return;
  // 故意不 await：观测不该给主流程加延迟。失败只写一行警告。
  void prisma.llmCall
    .create({ data: toDbRecord(record) })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // 库不存在时每次调用都会报，刷屏没意义，只在第一次提醒
      if (!warned) {
        warned = true;
        console.warn(`[observability] 用量未能写入数据库，后续不再提示：${msg.slice(0, 120)}`);
      }
    });
});
