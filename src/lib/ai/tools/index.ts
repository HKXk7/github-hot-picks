import type { Tool, ToolCallRecord } from "./types";
import { parseArgs } from "./types";

export type { Tool, ToolCallRecord } from "./types";
import { repoMetaTool, readmeTool } from "./web";
import { packageInfoTool } from "./package";
import type { ToolSpec } from "../llm";

/** 「联网取证」类工具：不依赖数据库，随时可用 */
export const BASE_TOOLS: Tool[] = [repoMetaTool, readmeTool, packageInfoTool];

export function toSpecs(tools: Tool[]): ToolSpec[] {
  return tools.map((t) => t.spec);
}

export function findTool(tools: Tool[], name: string): Tool | undefined {
  return tools.find((t) => t.spec.function.name === name);
}

/**
 * 执行一个工具并记录耗时。
 * 工具内部已经保证不抛异常；这里再兜一层，防止未来的工具写漏。
 */
export async function executeTool(
  tools: Tool[],
  name: string,
  rawArgs: string,
): Promise<{ record: ToolCallRecord; output: string }> {
  const started = Date.now();
  const args = parseArgs(rawArgs);
  const tool = findTool(tools, name);

  if (!tool) {
    const output = `没有名为「${name}」的工具。可用工具：${tools.map((t) => t.spec.function.name).join("、")}`;
    return {
      record: { name, args, preview: output, ok: false, ms: Date.now() - started },
      output,
    };
  }

  try {
    const output = await tool.execute(args);
    const ok = !/^(参数错误|查询失败|无法获取|未能抓取|查不到)/.test(output.trimStart());
    return {
      record: {
        name,
        args,
        preview: output.slice(0, 200),
        ok,
        ms: Date.now() - started,
      },
      output,
    };
  } catch (err) {
    const output = `工具执行异常：${err instanceof Error ? err.message : String(err)}`;
    return {
      record: { name, args, preview: output, ok: false, ms: Date.now() - started },
      output,
    };
  }
}
