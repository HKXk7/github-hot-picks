import type { Tutorial } from "./schema";

/**
 * 取证痕迹：这份教程是 AI 查过哪些东西才写出来的。
 *
 * 为什么要存它——不存的话，「先取证再动笔」这套机制对用户是完全不可见的：
 * 教程页面上只看到一段文字，和凭记忆编出来的那版长得一模一样，
 * 花在工具调用上的钱和延迟也就白花了。存下来展示出去，读者才能判断该信几分。
 */

export interface ToolEvidence {
  tool: string;
  calls: number;
}

/** 工具名 → 人话。用户不该看到函数名 */
export const TOOL_LABELS: Record<string, string> = {
  fetch_readme: "项目 README",
  fetch_repo_meta: "GitHub 仓库信息",
  fetch_package_info: "npm / PyPI / crates 注册表",
  search_knowledge: "站内知识库",
};

export function toolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/**
 * 把工具调用记录压成「查过什么、各查了几次」。
 * 只统计成功的调用：失败的取证不算「已核验」，混进去就是虚报。
 */
export function summarizeToolCalls(
  calls: { name: string; ok?: boolean }[] | undefined,
): ToolEvidence[] {
  const counts = new Map<string, number>();
  for (const c of calls ?? []) {
    if (c.ok === false) continue;
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tool, calls]) => ({ tool, calls }))
    .sort((a, b) => b.calls - a.calls);
}

/** 给结构化教程附上取证痕迹（生成侧用） */
export function attachEvidence(
  tutorial: Tutorial,
  calls: { name: string; ok?: boolean }[] | undefined,
): Tutorial {
  return { ...tutorial, evidence: summarizeToolCalls(calls ?? []) };
}

/** 教程是否带取证痕迹；plain 模式单轮生成的没有 */
export function hasEvidence(evidence: ToolEvidence[] | undefined): boolean {
  return !!evidence && evidence.length > 0;
}

export function totalEvidenceCalls(evidence: ToolEvidence[] | undefined): number {
  return (evidence ?? []).reduce((sum, e) => sum + e.calls, 0);
}
