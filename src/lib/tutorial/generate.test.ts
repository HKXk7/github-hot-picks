import { describe, expect, it } from "vitest";
import { TutorialSchema } from "./schema";
import { autoTrimArrays } from "./generate";

/** 一份完全合法的对象，测试里只改要测的那一处 */
function validTutorial() {
  return {
    v: 2,
    oneLiner: "用纯 Rust 重做一个文字处理器，适合想研究编辑器原理的新手。",
    audience: "会一点 Rust 的编程新手",
    installCommands: ["git clone https://github.com/a/b.git", "cd b", "cargo run"],
    features: ["先跑起来熟悉编辑操作", "改一个排版参数再编译看变化"],
    pitfalls: ["Rust 编译较慢，第一次要耐心等"],
    confidence: "medium",
    missingInfo: ["具体版本号未知"],
  };
}

function parseWithIssues(value: unknown) {
  const result = TutorialSchema.safeParse(value);
  return result.success ? null : result.error;
}

describe("autoTrimArrays", () => {
  it("数组多写了几条时裁剪到上限，并说明裁了什么", () => {
    const draft = { ...validTutorial(), pitfalls: ["坑一", "坑二", "坑三", "坑四"] };
    const error = parseWithIssues(draft);
    expect(error).not.toBeNull();

    const repair = autoTrimArrays(draft, error!);
    expect(repair).not.toBeNull();
    expect(repair!.trimmed).toEqual(["pitfalls 保留前 3 条"]);
    expect(TutorialSchema.safeParse(repair!.value).success).toBe(true);
  });

  it("保留前面的条目，不改动其余字段", () => {
    const draft = { ...validTutorial(), features: ["一", "二", "三", "四", "五"] };
    const repair = autoTrimArrays(draft, parseWithIssues(draft)!);
    const value = repair!.value as Record<string, unknown>;
    expect(value.features).toEqual(["一", "二", "三", "四"]);
    expect(value.oneLiner).toBe(draft.oneLiner);
  });

  it("超长的是数组里某条字符串时不裁剪（截一半的话没人看得懂）", () => {
    const draft = { ...validTutorial(), pitfalls: ["x".repeat(300)] };
    expect(autoTrimArrays(draft, parseWithIssues(draft)!)).toBeNull();
  });

  it("混有无法靠截断解决的错误时整体放弃，交回模型自修复", () => {
    const draft = { ...validTutorial(), pitfalls: ["坑一", "坑二", "坑三", "坑四"] };
    delete (draft as Record<string, unknown>).oneLiner; // 缺字段：截断修不了
    expect(autoTrimArrays(draft, parseWithIssues(draft)!)).toBeNull();
  });

  it("本来就在上限内时不做任何改动", () => {
    const draft = validTutorial();
    const error = parseWithIssues({ ...draft, confidence: "unknown" });
    expect(error).not.toBeNull();
    expect(autoTrimArrays(draft, error!)).toBeNull();
  });
});
