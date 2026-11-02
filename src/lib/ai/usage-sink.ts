/**
 * 用量上报的「出口」。
 *
 * 为什么要把出口和落库分开：
 * llm.ts 是纯的网络层，它不该知道数据存在哪儿。用 AsyncLocalStorage 传递
 * 调用链上下文（这次生成属于哪个 trace、是什么类型），调用方就不用把
 * traceId 一路透传到每一层——agent 循环里那些嵌套调用根本没法手工传。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { TokenUsage } from "./usage";

/** 一次业务操作（生成一份教程 / 回答一轮对话）下所有 LLM 调用的公共上下文 */
export interface TraceContext {
  id: string;
  /** tutorial | chat | embed | planner | eval */
  kind: string;
  label?: string;
}

export interface LlmCallRecord {
  traceId: string;
  kind: string;
  label?: string;
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  ok: boolean;
  error?: string;
  degraded?: string[];
}

export type UsageSink = (record: LlmCallRecord) => void;

const traceStore = new AsyncLocalStorage<TraceContext>();
let sink: UsageSink | null = null;

/** 由落库那一侧（observability.ts）注册；没注册就是不上报，主流程照跑 */
export function setUsageSink(next: UsageSink | null): void {
  sink = next;
}

export function getUsageSink(): UsageSink | null {
  return sink;
}

/**
 * 上报一次调用。
 * 观测系统把主流程搞挂是最糟的失败模式，所以这里连 sink 自己抛错都吞掉。
 */
export function emitCall(record: LlmCallRecord): void {
  try {
    sink?.(record);
  } catch {
    // 上报失败不应该影响业务
  }
}

let counter = 0;

export function newTraceId(kind: string): string {
  counter = (counter + 1) % 100_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${kind}-${Date.now().toString(36)}-${counter.toString(36)}${rand}`;
}

export function currentTrace(): TraceContext | undefined {
  return traceStore.getStore();
}

/** 在当前上下文里跑一段逻辑，其内部所有 LLM 调用都会带上这个 trace */
export function withTrace<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
  return traceStore.run(ctx, fn);
}

/** 开一个新的 trace 并跑 fn，返回 { result, traceId }，方便把 id 记进业务数据 */
export async function runTraced<T>(
  kind: string,
  label: string | undefined,
  fn: (ctx: TraceContext) => Promise<T>,
): Promise<{ result: T; traceId: string }> {
  const ctx: TraceContext = { id: newTraceId(kind), kind, ...(label ? { label } : {}) };
  const result = await withTrace(ctx, () => fn(ctx));
  return { result, traceId: ctx.id };
}
