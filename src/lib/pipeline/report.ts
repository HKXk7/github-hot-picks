/**
 * 日更跑完之后的「这一期到底怎么样」报告。
 *
 * 为什么单独抽一个模块：报告写错不会报错，只会让人看不见问题 ——
 * 之前教程生成失败只是打一行 warn，跑完照常打印「✅ 已更新第 N 期」，
 * 于是一个项目可以连续几期没有教程而没人发现。
 * 抽成纯函数才能用单测钉住「失败必须出现在报告里」这件事。
 */

/** 本期每个项目的教程结果 */
export type StepKind =
  /** 这期新生成的 */
  | "generated"
  /** 库里已有，直接复用 */
  | "reused"
  /** 尝试生成但没成功 */
  | "failed"
  /** 没配置 API key 之类的原因，压根没尝试 */
  | "skipped";

export interface StepOutcome {
  fullName: string;
  kind: StepKind;
  /** kind=failed 时的原因 */
  error?: string;
}

/** 给历史上「缺教程」的项目补做一次的结果 */
export interface RetryOutcome {
  fullName: string;
  ok: boolean;
  /** 累计尝试过几期（含这次） */
  attempts: number;
  error?: string;
  /** 已到重试上限，之后不再自动补做 */
  gaveUp?: boolean;
}

export interface RunReport {
  generated: number;
  reused: number;
  failed: number;
  skipped: number;
  retryAttempted: number;
  retryFixed: number;
  retryGaveUp: number;
  /** 本期失败的项目与原因 */
  failures: { fullName: string; error?: string }[];
  /**
   * success / partial。
   * 不设 failed：整轮跑挂是异常路径，由调用方写 JobRun 的 failed。
   * partial 的意思是「稿子出来了，但本期有项目没拿到教程」——
   * 这种半失败最容易被当成成功，所以必须有单独的状态。
   */
  status: "success" | "partial";
}

export function buildRunReport(steps: StepOutcome[], retries: RetryOutcome[] = []): RunReport {
  const count = (k: StepKind) => steps.filter((s) => s.kind === k).length;
  const failed = count("failed");

  return {
    generated: count("generated"),
    reused: count("reused"),
    failed,
    skipped: count("skipped"),
    retryAttempted: retries.length,
    retryFixed: retries.filter((r) => r.ok).length,
    retryGaveUp: retries.filter((r) => r.gaveUp).length,
    failures: steps.filter((s) => s.kind === "failed").map((s) => ({ fullName: s.fullName, error: s.error })),
    status: failed > 0 ? "partial" : "success",
  };
}

/** 终端用的纯文本报告 */
export function formatRunReport(r: RunReport): string {
  const total = r.generated + r.reused + r.failed + r.skipped;
  const lines: string[] = [
    `📊 本期 ${total} 个项目：新生成 ${r.generated} · 复用 ${r.reused} · 失败 ${r.failed} · 跳过 ${r.skipped}`,
  ];

  for (const f of r.failures) {
    lines.push(`   ❌ ${f.fullName}${f.error ? ` —— ${f.error}` : ""}`);
  }

  if (r.retryAttempted > 0) {
    lines.push(
      `♻️ 补做历史欠账：尝试 ${r.retryAttempted} 个，补上 ${r.retryFixed} 个${r.retryGaveUp ? `，放弃 ${r.retryGaveUp} 个` : ""}`,
    );
  }

  if (r.failed === 0 && r.retryGaveUp === 0) {
    lines.push(r.retryFixed > 0 ? "✅ 本期教程全部就位，历史欠账也有进展" : "✅ 本期教程全部就位");
  }

  return lines.join("\n");
}

/** CI job summary 用的 Markdown */
export function formatRunReportMarkdown(r: RunReport): string {
  const rows = [
    "| 项 | 数量 |",
    "|----|------|",
    `| 本期项目 | ${r.generated + r.reused + r.failed + r.skipped} |`,
    `| 新生成教程 | ${r.generated} |`,
    `| 复用已有教程 | ${r.reused} |`,
    `| 生成失败 | ${r.failed} |`,
    `| 未尝试（无 key 等） | ${r.skipped} |`,
    `| 补做历史欠账 | ${r.retryAttempted}（成功 ${r.retryFixed}，放弃 ${r.retryGaveUp}） |`,
  ];

  const lines = ["## 本期日更结果", "", ...rows, "", `状态：**${r.status === "success" ? "全部成功" : "部分成功"}**`];

  if (r.failures.length) {
    lines.push("", "### 生成失败的项目", "");
    for (const f of r.failures) lines.push(`- \`${f.fullName}\`${f.error ? `：${f.error}` : ""}`);
  }
  return lines.join("\n");
}
