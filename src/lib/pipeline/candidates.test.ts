import { describe, expect, it } from "vitest";
import { indexHistory, isAlreadyRecommended, selectFresh } from "./candidates";

const known = indexHistory([
  { fullName: "alice/old-name", githubId: 1001 },
  { fullName: "bob/tool", githubId: 1002 },
]);

describe("isAlreadyRecommended", () => {
  it("名字命中就不推荐", () => {
    expect(isAlreadyRecommended(known, { full_name: "bob/tool", id: 1002 })).toBe(true);
  });

  it("仓库改名后仍靠 githubId 认出来（这是整轮日更被拖挂的那个洞）", () => {
    // alice 把 old-name 改名成 new-name，fullName 对不上但 id 没变
    expect(isAlreadyRecommended(known, { full_name: "alice/new-name", id: 1001 })).toBe(true);
  });

  it("名字对上、id 是快照导入的哈希假值时也认得出来", () => {
    expect(isAlreadyRecommended(known, { full_name: "bob/tool", id: 999999 })).toBe(true);
  });

  it("全新的项目放行", () => {
    expect(isAlreadyRecommended(known, { full_name: "carol/fresh", id: 2001 })).toBe(false);
  });
});

describe("selectFresh", () => {
  const items = [
    { full_name: "alice/new-name", id: 1001 },
    { full_name: "carol/fresh", id: 2001 },
    { full_name: "bob/tool", id: 1002 },
    { full_name: "dave/another", id: 2002 },
  ];

  it("同时按名字和 id 去重", () => {
    expect(selectFresh(items, known).map((i) => i.full_name)).toEqual([
      "carol/fresh",
      "dave/another",
    ]);
  });

  it("保持原顺序，不改动传入数组", () => {
    const copy = [...items];
    selectFresh(items, known);
    expect(items).toEqual(copy);
  });

  it("空历史全部放行", () => {
    expect(selectFresh(items, indexHistory([]))).toHaveLength(4);
  });
});