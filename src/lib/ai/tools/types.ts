import type { ToolSpec } from "../llm";

/**
 * 一个「可被模型调用的工具」= 声明 + 执行体。
 *
 * 声明部分（spec）是要发给模型的 JSON Schema，写得太随意模型就不会用；
 * 执行体必须**永不抛异常**——工具报错也要变成一段文字回给模型，
 * 让模型自己决定是换个参数重试还是放弃。这是 agent 和普通函数调用的关键区别：
 * 工具失败不是系统失败，是给模型的一条观察结果。
 */
export interface Tool {
  spec: ToolSpec;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

/** 工具执行记录，用于日志与事后审计（简历上讲 agent 可观测性就靠它） */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  /** 截断后的结果，避免日志爆炸 */
  preview: string;
  ok: boolean;
  ms: number;
}

export const MAX_RESULT_CHARS = 3000;

export function truncate(s: string, limit = MAX_RESULT_CHARS): string {
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n…（已截断，原文共 ${s.length} 字符）`;
}

/** 从模型给出的 arguments 字符串里安全取参（模型经常输出不合法 JSON） */
export function parseArgs(raw: string): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
