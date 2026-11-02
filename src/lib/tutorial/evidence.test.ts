import { describe, expect, it } from "vitest";
import { attachEvidence, hasEvidence, summarizeToolCalls, toolLabel, totalEvidenceCalls } from "./evidence";
import { parseStructuredTutorial } from "./schema";
import type { Tutorial } from "./schema";

const base: Tutorial = {
  v: 2,
  oneLiner: "一个用 Rust 写的终端文件管理器，比传统 cd/ls 快得多。",
  audience: "经常在终端里找文件的开发者",
  installCommands: ["cargo install nu-term"],
  features: ["模糊搜索文件名", "预览文件内容"],
  pitfalls: ["需要先安装 Rust 工具链"],
  confidence: "high",
  missingInfo: [],
  evidence: [],
};

describe("summarizeToolCalls", () => {
  it("按工具聚合成次数", () => {
    expect(
      summarizeToolCalls([
        { name: "fetch_readme", ok: true },
        { name: "fetch_readme", ok: true },
        { name: "fetch_package_info", ok: true },
      ]),
    ).toEqual([
      { tool: "fetch_readme", calls: 2 },
      { tool: "fetch_package_info", calls: 1 },
    ]);
  });

  it("失败的调用不计入，否则等于虚报已核实", () => {
    expect(summarizeToolCalls([{ name: "fetch_readme", ok: false }])).toEqual([]);
  });

  it("没有调用时返回空数组", () => {
    expect(summarizeToolCalls([])).toEqual([]);
    expect(summarizeToolCalls(undefined as never)).toEqual([]);
  });
});

describe("取证痕迹随教程存取", () => {
  it("附上痕迹后仍能通过 schema 校验", () => {
    const withEvidence = attachEvidence(base, [
      { name: "fetch_readme", ok: true },
      { name: "fetch_package_info", ok: true },
    ]);
    // 往返一次，确认存进数据库再读出来不会丢
    const parsed = parseStructuredTutorial(JSON.stringify(withEvidence));
    expect(parsed?.evidence).toEqual([
      { tool: "fetch_readme", calls: 1 },
      { tool: "fetch_package_info", calls: 1 },
    ]);
    expect(hasEvidence(parsed?.evidence)).toBe(true);
    expect(totalEvidenceCalls(parsed?.evidence)).toBe(2);
  });

  it("没有痕迹时明确为空，UI 据此提示未经取证", () => {
    const parsed = parseStructuredTutorial(JSON.stringify(attachEvidence(base, undefined)));
    expect(parsed?.evidence).toEqual([]);
    expect(hasEvidence(parsed?.evidence)).toBe(false);
  });

  it("老数据没有 evidence 字段也能解析出来", () => {
    const legacy = JSON.stringify({ ...base, evidence: undefined });
    const parsed = parseStructuredTutorial(legacy);
    expect(parsed?.evidence).toEqual([]);
  });
});

describe("toolLabel", () => {
  it("工具名翻译成人话", () => {
    expect(toolLabel("fetch_readme")).toBe("项目 README");
    expect(toolLabel("fetch_package_info")).toBe("npm / PyPI / crates 注册表");
  });

  it("未知工具名原样返回，不显示成空白", () => {
    expect(toolLabel("some_new_tool")).toBe("some_new_tool");
  });
});
