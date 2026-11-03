import { describe, expect, it } from "vitest";
import { applyGate, formatGate, readThresholds, DEFAULT_THRESHOLDS } from "./gate";
import type { RunSummary } from "./types";

function summary(patch: Partial<RunSummary> = {}): RunSummary {
  return {
    mode: "tools",
    cases: 10,
    generated: 10,
    successRate: 1,
    avgCommands: 3,
    totalVerified: 8,
    totalFabricated: 0,
    totalUnverifiable: 4,
    fabricationRate: 0,
    verifiedRate: 0.8,
    casesWithVerifiedCommand: 0.8,
    avgMissingInfo: 1,
    avgAttempts: 1,
    avgToolCalls: 4,
    avgMs: 20_000,
    ...patch,
  };
}

describe("applyGate", () => {
  it("全绿时通过", () => {
    const r = applyGate([summary()]);
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it("编造率超阈值即判红", () => {
    const r = applyGate([summary({ fabricationRate: 0.5, verifiedRate: 0.5 })]);
    expect(r.passed).toBe(false);
    expect(r.failures.join()).toContain("命令编造率");
  });

  it("生成成功率不足即判红", () => {
    const r = applyGate([summary({ successRate: 0.4, generated: 4 })]);
    expect(r.passed).toBe(false);
    expect(r.failures.join()).toContain("生成成功率");
  });

  it("没有可查证命令时跳过比率判定，而不是判红", () => {
    // registry 抽风、或模型全给了 git clone，都可能出现这种情况。
    // 此时判红属于误报 —— 门禁假红一次，下次真红就没人看了。
    const r = applyGate([summary({ fabricationRate: null, verifiedRate: null, casesWithVerifiedCommand: 0 })]);
    const rateChecks = r.checks.filter((c) => c.metric.includes("率") && c.metric !== "生成成功率");
    expect(rateChecks.every((c) => c.skipped)).toBe(true);
  });

  it("没有可查证命令但也没有样本给出可验证命令时，仍然判红", () => {
    // 上面跳过了比率，但这不能变成免死金牌：一个能验证的命令都给不出来
    // 说明模型根本没给安装命令，这是真问题。
    const r = applyGate([summary({ fabricationRate: null, verifiedRate: null, casesWithVerifiedCommand: 0 })]);
    expect(r.passed).toBe(false);
    expect(r.failures.join()).toContain("有可验证命令的样本占比");
  });

  it("按模式用不同阈值", () => {
    // 同样的实测值：tools 模式不及格，plain 模式的线本来就低
    const s = summary({ mode: "plain", verifiedRate: 0.3, fabricationRate: 0.3, casesWithVerifiedCommand: 0.3 });
    const asPlain = applyGate([s]);
    const asTools = applyGate([{ ...s, mode: "tools" }]);
    expect(asPlain.passed).toBe(true);
    expect(asTools.passed).toBe(false);
  });

  it("任一模式不达标则整体不通过", () => {
    const r = applyGate([summary({ mode: "tools" }), summary({ mode: "plain", successRate: 0.1 })]);
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.startsWith("[plain]"))).toBe(true);
  });
});

describe("小样本容差", () => {
  it("20 样本下 30% 属于 35% 的抽样波动，不假红", () => {
    // 云端实测：20 个样本测出 35%，阈值也是 35%，压线通过零余量。
    // 下一轮抽到 30% 是正常波动，不该让门禁变红。
    const r = applyGate([summary({ cases: 20, casesWithVerifiedCommand: 0.3 })]);
    expect(r.passed).toBe(true);
  });

  it("样本足够大时，同样的 30% 会被判红（容差不是免死金牌）", () => {
    const r = applyGate([summary({ cases: 200, casesWithVerifiedCommand: 0.3 })]);
    expect(r.passed).toBe(false);
    expect(r.failures.join()).toContain("有可验证命令的样本占比");
  });

  it("配置阈值本身没被改低，容差只体现在判定里", () => {
    const r = applyGate([summary({ cases: 20, casesWithVerifiedCommand: 0.3 })]);
    const check = r.checks.find((c) => c.metric === "有可验证命令的样本占比");
    expect(check?.threshold).toBe(DEFAULT_THRESHOLDS.tools.minCasesWithVerifiedCommand);
    expect(check?.tolerance).toBeGreaterThan(0);
    expect(check?.tolerance).toBeLessThan(0.2);
  });

  it("一个可验证命令都给不出来时容差为 0，仍然判红", () => {
    const r = applyGate([summary({ cases: 20, casesWithVerifiedCommand: 0 })]);
    expect(r.passed).toBe(false);
    const check = r.checks.find((c) => c.metric === "有可验证命令的样本占比");
    expect(check?.tolerance).toBeUndefined();
  });
});

describe("readThresholds", () => {
  it("没配就用默认值", () => {
    expect(readThresholds(undefined)).toEqual(DEFAULT_THRESHOLDS);
  });

  it("可按模式局部覆盖，未提到的字段保留默认", () => {
    const t = readThresholds(JSON.stringify({ tools: { minVerifiedRate: 0.9 } }));
    expect(t.tools.minVerifiedRate).toBe(0.9);
    expect(t.tools.maxFabricationRate).toBe(DEFAULT_THRESHOLDS.tools.maxFabricationRate);
    expect(t.plain).toEqual(DEFAULT_THRESHOLDS.plain);
  });

  it("配置写错时回退默认而不是崩掉", () => {
    const t = readThresholds("{oops");
    expect(t).toEqual(DEFAULT_THRESHOLDS);
  });
});

describe("formatGate", () => {
  it("输出 markdown 表格，含跳过标记", () => {
    const md = formatGate(applyGate([summary({ fabricationRate: null, verifiedRate: null })]));
    expect(md).toContain("| 模式 | 指标 |");
    expect(md).toContain("跳过");
  });
});
