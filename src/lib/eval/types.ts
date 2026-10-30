import type { Ecosystem } from "../ai/tools/package";
import type { GenerationMode } from "../tutorial/generate";
import type { Tutorial } from "../tutorial/schema";

/** 一条评测样本：就是一个待测项目 */
export interface EvalCase {
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  topics: string[];
  homepage: string | null;
}

/**
 * 单条安装命令的判定结果。
 *
 * 四种状态不能合成两种，否则指标会失真：
 * - verified    ：包名在对应 registry 里真实存在
 * - fabricated  ：包名查了确实不存在 —— 这就是模型编的，最严重
 * - unverifiable：命令不含可查证的包名（git clone / docker run / 源码构建等），
 *                 既不证明它对，也不能说它编，只能放着
 * - error       ：registry 请求失败，判定不了，同样不能算成编造
 */
export type CommandVerdict = "verified" | "fabricated" | "unverifiable" | "error";

export interface CommandCheck {
  command: string;
  verdict: CommandVerdict;
  ecosystem?: Ecosystem;
  packageName?: string;
  detail?: string;
}

export interface CaseResult {
  fullName: string;
  mode: GenerationMode;
  /** 是否成功生成了通过 schema 校验的教程 */
  generated: boolean;
  attempts: number;
  ms: number;
  toolCalls: number;
  tutorial: Tutorial | null;
  checks: CommandCheck[];
  error?: string;
}

export interface CaseMetrics {
  fullName: string;
  mode: GenerationMode;
  generated: boolean;
  attempts: number;
  ms: number;
  toolCalls: number;
  commands: number;
  verified: number;
  fabricated: number;
  unverifiable: number;
  errored: number;
  confidence: Tutorial["confidence"] | "-";
  missingInfo: number;
  /** 编造率：只在「能查证」的命令里算分母，避免把 git clone 误判成编造 */
  fabricationRate: number | null;
  verifiedRate: number | null;
  /** LLM 评审打分，只有开启 judge 时才有 */
  judge?: JudgeScore;
  error?: string;
}

export interface JudgeScore {
  /** 1-5 分：内容是否像有依据而非凭空生成 */
  groundedness: number;
  /** 1-5 分：对新手是否有用 */
  usefulness: number;
  reason: string;
}

export interface RunSummary {
  mode: GenerationMode;
  cases: number;
  generated: number;
  /** 生成成功率 */
  successRate: number;
  avgCommands: number;
  /** 所有命令里被验证存在 / 查证不存在 / 无法查证 的数量 */
  totalVerified: number;
  totalFabricated: number;
  totalUnverifiable: number;
  /** 可查证命令中的编造率 */
  fabricationRate: number | null;
  verifiedRate: number | null;
  /** 至少给出一条可验证命令的样本占比 */
  casesWithVerifiedCommand: number;
  avgMissingInfo: number;
  avgAttempts: number;
  avgToolCalls: number;
  avgMs: number;
  avgJudgeGroundedness?: number;
  avgJudgeUsefulness?: number;
}

export interface EvalRun {
  at: string;
  cases: EvalCase[];
  metrics: CaseMetrics[];
  summary: RunSummary[];
  /** 相对上一次运行的退化项 */
  regressions?: string[];
}
