import { describe, expect, it } from "vitest";
import { buildIssueSummary, categorize } from "./picks";

describe("categorize", () => {
  it("topics 优先于名字：名字像工具但作者标了 llm，应归 AI", () => {
    expect(
      categorize({ name: "gpu-unlock", description: "Unlock tensor cores", topics: ["machine-learning", "nvidia"] }),
    ).toBe("AI");
  });

  it("topics 看不出来时回退到关键词", () => {
    expect(
      categorize({ name: "awesome-cli", description: "A command line tool for everything", topics: ["productivity"] }),
    ).toBe("工具");
    expect(
      categorize({ name: "cool-lib", description: "A react component library", topics: [] }),
    ).toBe("前端");
  });

  it("AI 判在工具之前，避免把大模型项目归成工具", () => {
    // 名字里有 tool、描述里有 sdk，但它是个 agent
    expect(
      categorize({ name: "agent-tool", description: "sdk for building llm agents", topics: [] }),
    ).toBe("AI");
  });

  it("完全没有线索时归到「其他」", () => {
    expect(categorize({ name: "my-project", description: "something nice", topics: [] })).toBe("其他");
  });

  it("topics 为 null / undefined 时不崩", () => {
    expect(categorize({ name: "x", description: null, topics: null })).toBe("其他");
    expect(categorize({ name: "x" })).toBe("其他");
  });
});

describe("buildIssueSummary", () => {
  it("没有项目时给一句兜底话", () => {
    expect(buildIssueSummary([])).toBe("本期还没有推荐项目。");
  });

  it("给出方向分布和榜首，而不是一句万能套话", () => {
    const summary = buildIssueSummary([
      { fullName: "a/one", stars: 10048, category: "AI", rank: 1 },
      { fullName: "b/two", stars: 2000, category: "AI", rank: 2 },
      { fullName: "c/three", stars: 900, category: "工具", rank: 3 },
      { fullName: "d/four", stars: 100, category: "前端", rank: 4 },
    ]);
    expect(summary).toContain("本期 4 个项目");
    // 数量相同时按固定分类顺序（AI → 前端 → 后端 → 工具 → 其他）
    expect(summary).toContain("AI 2 · 前端 1 · 工具 1");
    expect(summary).toContain("榜首 a/one");
    expect(summary).toContain("10k");
  });

  it("榜首按名次取，不受传入顺序影响", () => {
    const picks = [
      { fullName: "x/1", stars: 10, category: "工具", rank: 1 },
      { fullName: "x/2", stars: 9999, category: "AI", rank: 2 },
    ];
    expect(buildIssueSummary(picks)).toContain("榜首 x/1");
    expect(buildIssueSummary([...picks].reverse())).toContain("榜首 x/1");
  });

  it("没给名次时退化为取 star 最高的", () => {
    const summary = buildIssueSummary([
      { fullName: "small/one", stars: 10, category: "AI" },
      { fullName: "big/two", stars: 5000, category: "工具" },
    ]);
    expect(summary).toContain("榜首 big/two");
  });

  it("分类缺失时算进「其他」", () => {
    expect(buildIssueSummary([{ fullName: "x/1", stars: 5, category: null }])).toContain("其他 1");
  });
});
