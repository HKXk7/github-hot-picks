import { describe, expect, it } from "vitest";
import {
  isStructuredTutorial,
  parseStructuredTutorial,
  renderTutorialToMarkdown,
  toTutorialMarkdown,
  TutorialSchema,
} from "./schema";

/** 一份刚好踩在所有边界内的合法教程 */
const base = {
  v: 2,
  oneLiner: "一个用 Rust 写的终端文件管理器，比传统 cd/ls 快得多。",
  audience: "经常在终端里找文件的开发者",
  installCommands: ["cargo install nu-term"],
  features: ["模糊搜索文件名", "预览文件内容", "支持自定义快捷键"],
  pitfalls: ["需要先安装 Rust 工具链"],
  confidence: "high" as const,
  missingInfo: [],
};

describe("TutorialSchema 跨字段约束", () => {
  it("接受合法数据", () => {
    expect(TutorialSchema.safeParse(base).success).toBe(true);
  });

  it("拒绝缺少版本号的旧结构", () => {
    const noVersion: Record<string, unknown> = { ...base };
    delete noVersion.v;
    expect(TutorialSchema.safeParse(noVersion).success).toBe(false);
  });

  it("没有安装命令时不允许自评 high", () => {
    const result = TutorialSchema.safeParse({
      ...base,
      installCommands: [],
      confidence: "high",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("confidence");
    }
  });

  it("没有安装命令但自评 medium 是允许的", () => {
    // 只有在线演示、没法本地安装的项目是真实存在的，逼它给命令等于逼它编一条
    expect(
      TutorialSchema.safeParse({ ...base, installCommands: [], confidence: "medium" }).success,
    ).toBe(true);
  });

  it("承认有未确认信息时不允许自评 high", () => {
    const result = TutorialSchema.safeParse({
      ...base,
      confidence: "high",
      missingInfo: ["最新版本号"],
    });
    expect(result.success).toBe(false);
  });

  it("missingInfo 省略时默认为空数组", () => {
    const without: Record<string, unknown> = { ...base };
    delete without.missingInfo;
    const parsed = TutorialSchema.parse(without);
    expect(parsed.missingInfo).toEqual([]);
  });
});

describe("新旧格式共存", () => {
  const legacyMarkdown = "## 它是干什么的\n\n这是一个很棒的项目。";

  it("旧版 Markdown 解析为 null，且不抛异常", () => {
    expect(parseStructuredTutorial(legacyMarkdown)).toBeNull();
    expect(isStructuredTutorial(legacyMarkdown)).toBe(false);
  });

  it("旧版 Markdown 原样返回，保证老数据不出错", () => {
    expect(toTutorialMarkdown(legacyMarkdown)).toBe(legacyMarkdown);
  });

  it("新版 JSON 渲染成 Markdown", () => {
    const md = toTutorialMarkdown(JSON.stringify(base));
    expect(md).toContain("## 它是干什么的");
    expect(md).toContain("cargo install nu-term");
    // 自评 high 且无未确认项时不该出现注意事项段
    expect(md).not.toContain("## 注意事项");
  });

  it("结构不完整的 JSON 当作无效，不当成 Markdown 吐出去", () => {
    // 如果这里返回了原文，前端会把一坨 JSON 渲染给用户
    expect(toTutorialMarkdown('{"v":2,"oneLiner":"短"}')).toBe('{"v":2,"oneLiner":"短"}');
    expect(parseStructuredTutorial('{"v":2,"oneLiner":"短"}')).toBeNull();
  });
});

describe("renderTutorialToMarkdown", () => {
  it("把握度不高时明确提示读者", () => {
    const md = renderTutorialToMarkdown({ ...base, confidence: "low" } as never);
    expect(md).toContain("## 注意事项");
    expect(md).toContain("把握程度为「低」");
  });

  it("列出 AI 自述无法确认的细节", () => {
    const md = renderTutorialToMarkdown({
      ...base,
      confidence: "medium",
      missingInfo: ["最低 Node 版本"],
    } as never);
    expect(md).toContain("未经确认");
    expect(md).toContain("最低 Node 版本");
  });

  it("没有安装命令时给出兜底说明而不是空块", () => {
    const md = renderTutorialToMarkdown({
      ...base,
      installCommands: [],
      confidence: "medium",
    } as never);
    expect(md).toContain("没有给出可直接执行的安装命令");
  });
});
