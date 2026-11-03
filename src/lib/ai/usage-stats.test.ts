import { describe, expect, it } from "vitest";
import { summarizeUsage, quantile, type UsageRow } from "./usage-stats";

function row(patch: Partial<UsageRow> = {}): UsageRow {
  return {
    traceId: "t-1",
    kind: "tutorial",
    label: "fetch_readme",
    model: "deepseek-ai/DeepSeek-V4.1-Flash",
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    costCny: 0.001,
    latencyMs: 1000,
    ok: true,
    error: null,
    createdAt: new Date("2026-11-03T10:00:00Z"),
    ...patch,
  };
}

describe("quantile", () => {
  it("空数组返回 0 而不是 NaN", () => {
    expect(quantile([], 0.5)).toBe(0);
  });

  it("样本少时取最近的那一个，不做插值", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.95)).toBe(4);
  });
});

describe("summarizeUsage", () => {
  it("汇总 token 与耗时", () => {
    const s = summarizeUsage([row(), row({ totalTokens: 80, latencyMs: 3000 })]);
    expect(s.calls).toBe(2);
    expect(s.totalTokens).toBe(200);
    expect(s.promptTokens).toBe(200);
    expect(s.completionTokens).toBe(40);
    expect(s.totalMs).toBe(4000);
    expect(s.p50Ms).toBe(3000);
  });

  it("一次调用都没有时成功率是 1，不是 0", () => {
    // 空数据集显示「成功率 0%」会被误读成「全挂了」，实际是「没跑过」
    expect(summarizeUsage([]).successRate).toBe(1);
    expect(summarizeUsage([]).calls).toBe(0);
  });

  it("失败计入失败率并按时间倒序列出", () => {
    const s = summarizeUsage([
      row({ ok: false, error: "timeout", createdAt: new Date("2026-11-03T10:00:00Z") }),
      row({ ok: false, error: "429", createdAt: new Date("2026-11-03T12:00:00Z") }),
      row(),
    ]);
    expect(s.failed).toBe(2);
    expect(s.successRate).toBeCloseTo(1 / 3);
    expect(s.failures[0].error).toBe("429");
  });

  it("只有部分调用有金额时也算 hasCost，但不把 null 当 0 相加以外的数据", () => {
    const s = summarizeUsage([row({ costCny: 0.5 }), row({ costCny: null })]);
    expect(s.hasCost).toBe(true);
    expect(s.cost).toBeCloseTo(0.5);
  });

  it("一条金额都没有时不假装知道成本", () => {
    const s = summarizeUsage([row({ costCny: null })]);
    expect(s.hasCost).toBe(false);
    expect(s.cost).toBe(0);
  });

  it("按用途 / 模型 / 步骤 / trace 分组", () => {
    const s = summarizeUsage([
      row({ kind: "tutorial", model: "m1", label: "fetch_readme", traceId: "a" }),
      row({ kind: "tutorial", model: "m1", label: "generate", traceId: "a" }),
      row({ kind: "chat", model: "m2", label: null, traceId: "b" }),
    ]);
    expect(s.byKind.map((g) => g.key)).toEqual(["tutorial", "chat"]);
    expect(s.byModel.map((g) => g.key)).toEqual(["m1", "m2"]);
    expect(s.byLabel.map((g) => g.key)).toEqual(["fetch_readme", "generate"]);
    expect(s.byTrace.find((g) => g.key === "a")?.calls).toBe(2);
  });

  it("耗时最长 / token 最多的组排在最前面", () => {
    const s = summarizeUsage([
      row({ model: "cheap", totalTokens: 10, latencyMs: 100 }),
      row({ model: "heavy", totalTokens: 900, latencyMs: 9000 }),
    ]);
    expect(s.byModel[0].key).toBe("heavy");
    expect(s.byKind[0].ms).toBe(9100);
  });
});
