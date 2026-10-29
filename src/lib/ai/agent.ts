import { chat, type ChatMessage, type ToolSpec } from "./llm";
import { executeTool, toSpecs, type Tool } from "./tools";
import type { ToolCallRecord } from "./tools/types";

export interface AgentResult {
  /** 模型最后给出的自然语言 / JSON 文本 */
  finalText: string;
  /** 每一步工具调用的记录，用于日志与前端展示 */
  steps: ToolCallRecord[];
  /** 实际调用了多少次 LLM（含收尾那次） */
  llmRounds: number;
  warnings: string[];
  /**
   * 完整的消息历史（含 system / user / assistant / tool）。
   * 回传它是为了自修复：校验失败时，取证得到的 README、包信息都还在这个 context 里，
   * 让模型照着已经查到的证据改 JSON 就行，不必把工具再调一遍。
   */
  messages: ChatMessage[];
}

export interface AgentOptions {
  model: string;
  messages: ChatMessage[];
  tools: Tool[];
  /** 最多允许几轮「模型→工具→模型」 */
  maxSteps?: number;
  maxTokens?: number;
  temperature?: number;
  /**
   * 第一轮强制模型调用工具（tool_choice: "required"）。
   * 实测「auto」时模型有相当比例直接凭记忆作答、跳过取证，
   * 那工具就白挂了。需要保证先取证的场景请打开这个开关。
   */
  requireToolOnFirstStep?: boolean;
  /** 步数用尽时，追加给模型的收尾指令 */
  finalInstruction?: string;
  onStep?: (rec: ToolCallRecord) => void;
  log?: (msg: string) => void;
}

/**
 * 工具调用循环（Tool-calling Agent Loop）。
 *
 * 这是「调用 API」和「做 Agent」的分界线：
 * 单轮调用里模型只能靠自己记忆作答，装什么包、有没有这个包全靠猜；
 * 这里把真实世界的数据源挂成工具，让模型**先查再答**，
 * 并且允许它根据查询结果自己决定下一步查什么（所以叫循环，不是固定流水线）。
 *
 * 循环形态：
 *   模型 → tool_calls → 执行工具（结果作为观察回灌）→ 模型 → … → 模型不再要工具 → 输出
 */
export async function runToolAgent(opts: AgentOptions): Promise<AgentResult> {
  const {
    model,
    tools,
    maxSteps = 5,
    maxTokens = 2400,
    temperature = 0.3,
    finalInstruction = "工具调用次数已用尽。请仅基于上面已经拿到的信息，直接输出最终结果，不要再调用任何工具。",
    onStep,
    log,
  } = opts;

  const messages: ChatMessage[] = [...opts.messages];
  const steps: ToolCallRecord[] = [];
  const warnings: string[] = [];
  const specs: ToolSpec[] = toSpecs(tools);
  let llmRounds = 0;

  for (let step = 1; step <= maxSteps; step++) {
    const outcome = await chat({
      model,
      messages,
      tools: specs,
      toolChoice:
        step === maxSteps ? "none" : opts.requireToolOnFirstStep && step === 1 ? "required" : "auto",
      maxTokens,
      temperature,
      // 带 tools 时禁用思维链，否则模型容易把推理过程写进正文字段
      disableThinking: true,
    });
    llmRounds++;

    if (!outcome.ok) {
      warnings.push(`第 ${step} 轮 LLM 调用失败：${outcome.error.slice(0, 200)}`);
      break;
    }

    const msg = outcome.message;
    const calls = msg.tool_calls ?? [];

    // 模型不再要工具 → 这就是最终答案
    if (calls.length === 0) {
      messages.push({ role: "assistant", content: msg.content ?? null });
      return { finalText: msg.content ?? "", steps, llmRounds, warnings, messages };
    }

    // 有工具调用：先把 assistant 这条（含 tool_calls）原样放回消息历史，
    // 顺序不能乱——OpenAI 协议要求 tool 消息必须紧跟在对应 tool_calls 的 assistant 消息之后。
    messages.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: calls,
    });

    // 同一轮里模型可能一次要多个工具，并发执行即可，彼此无依赖
    const results = await Promise.all(
      calls.map(async (call) => ({
        call,
        ...(await executeTool(tools, call.function?.name ?? "", call.function?.arguments ?? "")),
      })),
    );

    for (const r of results) {
      steps.push(r.record);
      onStep?.(r.record);
      log?.(`  🔧 ${r.record.name}(${JSON.stringify(r.record.args).slice(0, 80)}) → ${r.record.ok ? "OK" : "空/失败"} ${r.record.ms}ms`);
      messages.push({
        role: "tool",
        tool_call_id: r.call.id,
        name: r.call.function?.name,
        content: r.output,
      });
    }
  }

  // 走到这里说明步数用尽模型还在要工具：摘掉工具强制它收尾，避免无限循环
  warnings.push(`工具调用达到上限 ${maxSteps} 轮，已强制收尾`);
  const closing = await chat({
    model,
    messages: [...messages, { role: "user", content: finalInstruction }],
    maxTokens,
    temperature,
    disableThinking: true,
  });
  llmRounds++;

  if (!closing.ok) {
    warnings.push(`收尾调用失败：${closing.error.slice(0, 200)}`);
    return { finalText: "", steps, llmRounds, warnings, messages: [...messages, { role: "user", content: finalInstruction }] };
  }
  const finalMessages: ChatMessage[] = [
    ...messages,
    { role: "user", content: finalInstruction },
    { role: "assistant", content: closing.message.content ?? null },
  ];
  return { finalText: closing.message.content ?? "", steps, llmRounds, warnings, messages: finalMessages };
}
