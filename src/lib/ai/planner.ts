import { z } from "zod";
import { chat } from "./llm";
import { runToolAgent } from "./agent";
import type { Tool } from "./tools";
import type { ToolCallRecord } from "./tools/types";

/**
 * 规划型 Agent：先列计划，再逐步取证，然后回头检查够不够，最后综合成答案。
 *
 * 和 agent.ts 的区别：那是「单目标取证循环」——给一个目标，模型边查边想直到够用，
 * 适合「写一个项目的安装教程」这种一步到位的事。遇到「对比两个项目并给学习路线」
 * 这种需要拆开、且每步要用到不同来源的问题，单循环会漏掉其中一半，
 * 因为它没有「我还没做完」这个概念。这里补的就是这一层：
 *
 *   规划 → 逐步执行（每步一个取证小循环）→ 反思（还缺什么）→ 补做 → 综合
 *
 * 反思这一步是必要的，不是装饰：计划是在看到任何资料之前写出来的，
 * 必然有猜错的地方。允许它补一步，比要求一次规划到位可靠得多。
 */

export const PLAN_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

/**
 * 全部步骤（计划 + 反思补做）的硬上限。
 * 实测没有这个限制时，反思环节几乎总会觉得「还差点」，一路补到 7 步、70 多秒——
 * 深度模式是可选的慢路径，但不能慢到没人愿意点。
 */
const MAX_TOTAL_STEPS = 5;

const PlanSchema = z.object({
  steps: z
    .array(z.object({ goal: z.string().trim().min(4).max(200) }))
    .min(1)
    .max(5),
});

const ReflectionSchema = z.object({
  done: z.boolean(),
  missing: z.array(z.object({ goal: z.string().trim().min(4).max(200) })).max(3).default([]),
});

export interface PlannedStep {
  goal: string;
  /** 这一步得到的观察（模型看完工具结果后的小结），会累积进下一步的上下文 */
  observation: string;
  toolCalls: ToolCallRecord[];
}

export interface PlannerResult {
  /** 最终计划（含反思后补做的步骤） */
  plan: string[];
  steps: PlannedStep[];
  answer: string;
  llmRounds: number;
  warnings: string[];
}

/** 从模型输出里抠出计划；抠不出来就退化成「整件事一步做完」 */
export function parsePlan(text: string): { steps: { goal: string }[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = PlanSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseReflection(text: string): { done: boolean; missing: { goal: string }[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = ReflectionSchema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface PlannerOptions {
  goal: string;
  tools: Tool[];
  model?: string;
  /** 背景资料（例如站点上下文 / 知识库片段），会一并交给规划器和执行步骤 */
  context?: string;
  /** 计划里最多几步 */
  maxPlanSteps?: number;
  /** 每一步内部最多几轮工具调用 */
  maxToolCallsPerStep?: number;
  /** 最多反思补做几轮 */
  maxReplanRounds?: number;
  /** 综合成答案时的额外要求（例如「只输出 JSON」） */
  finalInstruction?: string;
  log?: (msg: string) => void;
}

export async function runPlannedAgent(opts: PlannerOptions): Promise<PlannerResult> {
  const {
    goal,
    tools,
    model = PLAN_MODEL,
    context = "",
    maxPlanSteps = 4,
    maxToolCallsPerStep = 3,
    maxReplanRounds = 1,
    finalInstruction = "用简洁的中文分点回答，不要复述上面资料里的原话，也不要编造资料里没有的内容。",
    log = () => {},
  } = opts;

  const warnings: string[] = [];
  let llmRounds = 0;

  const contextBlock = context ? `\n\n已知背景：\n${context}` : "";

  // ---------- 1. 规划 ----------
  const planOutcome = await chat({
    model,
    messages: [
      {
        role: "system",
        content:
          "你是任务规划器。把用户目标拆成若干个可执行的**取证步骤**：每一步必须能通过" +
          "调用工具查到东西（读 README、查包管理器、检索知识库），而不是「思考一下」。" +
          `最多 ${maxPlanSteps} 步，每步只做一件事。只输出 JSON：{"steps":[{"goal":"..."}]}`,
      },
      { role: "user", content: `目标：${goal}${contextBlock}` },
    ],
    maxTokens: 600,
    temperature: 0.2,
    jsonMode: true,
    disableThinking: true,
  });
  llmRounds++;

  let planned: { goal: string }[] = [];
  if (planOutcome.ok) {
    planned = parsePlan(planOutcome.message.content ?? "")?.steps ?? [];
  } else {
    warnings.push(`规划调用失败：${planOutcome.error.slice(0, 200)}`);
  }
  if (planned.length === 0) {
    // 规划失败不该让整个任务失败：退化成单步，交给执行循环自己摸索
    warnings.push("未能解析出计划，退化为单步执行");
    planned = [{ goal }];
  }
  planned = planned.slice(0, maxPlanSteps);
  log(`📋 计划 ${planned.length} 步：${planned.map((s) => s.goal).join(" → ")}`);

  // ---------- 2. 逐步执行 ----------
  const steps: PlannedStep[] = [];

  async function runStep(stepGoal: string): Promise<void> {
    const scratchpad = steps
      .map((s, i) => `步骤 ${i + 1}：${s.goal}\n结果：${s.observation}`)
      .join("\n\n");

    const outcome = await runToolAgent({
      model,
      messages: [
        {
          role: "user",
          content:
            `整体目标：${goal}\n\n${scratchpad ? `已完成步骤的发现：\n${scratchpad}\n\n` : ""}` +
            `现在只做这一步：${stepGoal}${contextBlock}\n\n` +
            `先用工具取证，然后用两三句话说明你发现了什么；查不到就说查不到，不要猜。`,
        },
      ],
      tools,
      maxSteps: maxToolCallsPerStep,
      maxTokens: 1200,
      requireToolOnFirstStep: true,
      log: (m) => log(`   ${m}`),
    });
    llmRounds += outcome.llmRounds;
    warnings.push(...outcome.warnings);

    steps.push({
      goal: stepGoal,
      observation: outcome.finalText.trim() || "（这一步没有得到有效结果）",
      toolCalls: outcome.steps,
    });
  }

  for (const step of planned) await runStep(step.goal);

  // ---------- 3. 反思：还缺什么就补做 ----------
  for (let round = 0; round < maxReplanRounds; round++) {
    // 补做也要有总量上限：实测不加限制时反思会一直觉得不够，一路补到 7 步、70 多秒。
    const remaining = MAX_TOTAL_STEPS - steps.length;
    if (remaining <= 0) break;

    const scratchpad = steps
      .map((s, i) => `步骤 ${i + 1}：${s.goal}\n结果：${s.observation}`)
      .join("\n\n");

    const reflect = await chat({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是检查员。判断已有发现是否足以回答目标。不够就指出还缺哪些**具体可查证**的补充步骤" +
            '（最多 3 个）。只输出 JSON：{"done":true} 或 {"done":false,"missing":[{"goal":"..."}]}',
        },
        { role: "user", content: `目标：${goal}\n\n已有发现：\n${scratchpad}` },
      ],
      maxTokens: 500,
      temperature: 0.2,
      jsonMode: true,
      disableThinking: true,
    });
    llmRounds++;

    if (!reflect.ok) break;
    const verdict = parseReflection(reflect.message.content ?? "");
    if (!verdict || verdict.done || verdict.missing.length === 0) break;

    const todo = verdict.missing.slice(0, remaining);
    if (todo.length === 0) break;
    log(`🔁 反思后补做 ${todo.length} 步：${todo.map((m) => m.goal).join(" → ")}`);
    for (const m of todo) await runStep(m.goal);
  }

  // ---------- 4. 综合 ----------
  const scratchpad = steps
    .map((s, i) => `步骤 ${i + 1}：${s.goal}\n结果：${s.observation}`)
    .join("\n\n");

  const final = await chat({
    model,
    messages: [
      {
        role: "system",
        content: `你是回答者，基于下面这些已经查证过的发现来回答用户的目标。${finalInstruction}`,
      },
      { role: "user", content: `目标：${goal}\n\n查证结果：\n${scratchpad}${contextBlock}` },
    ],
    maxTokens: 1600,
    temperature: 0.4,
    disableThinking: true,
  });
  llmRounds++;

  if (!final.ok) {
    warnings.push(`综合答案失败：${final.error.slice(0, 200)}`);
  }

  return {
    plan: steps.map((s) => s.goal),
    steps,
    answer: final.ok ? (final.message.content ?? "").trim() : "",
    llmRounds,
    warnings,
  };
}
