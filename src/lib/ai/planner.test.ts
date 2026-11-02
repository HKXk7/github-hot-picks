import { describe, expect, it } from "vitest";
import { parsePlan, parseReflection } from "./planner";

/**
 * 规划和反思的结果都要在离线状态下能被验证——
 * 跑一次 planner 要花几十秒和真金白银，但「抠出来的 JSON 对不对」是纯逻辑，
 * 不该靠跑一遍才知道。
 */
describe("parsePlan", () => {
  it("解析标准输出", () => {
    expect(parsePlan('{"steps":[{"goal":"读 README"},{"goal":"查 npm 包名"}]}')?.steps).toEqual([
      { goal: "读 README" },
      { goal: "查 npm 包名" },
    ]);
  });

  it("从模型爱加的 markdown 代码围栏里也能抠出来", () => {
    const raw = '好的，计划如下：\n```json\n{"steps":[{"goal":"先看文档"}]}\n```';
    expect(parsePlan(raw)?.steps).toEqual([{ goal: "先看文档" }]);
  });

  it("步骤为空视为无效，交给调用方退化成单步", () => {
    expect(parsePlan('{"steps":[]}')).toBeNull();
  });

  it("非 JSON 或结构不对都返回 null，不能抛异常", () => {
    expect(parsePlan("我来想想")).toBeNull();
    expect(parsePlan('{"steps":[{"nope":1}]}')).toBeNull();
    expect(parsePlan("")).toBeNull();
  });
});

describe("parseReflection", () => {
  it("认为已足够时不再补做", () => {
    expect(parseReflection('{"done":true}')).toEqual({ done: true, missing: [] });
  });

  it("缺什么时给出补充步骤", () => {
    expect(parseReflection('{"done":false,"missing":[{"goal":"查最低 Node 版本"}]}')?.missing).toEqual([
      { goal: "查最低 Node 版本" },
    ]);
  });

  it("done 缺失时视为无效，宁可少补一步也不要乱补", () => {
    expect(parseReflection('{"missing":[{"goal":"随便查点什么"}]}')).toBeNull();
  });
});
