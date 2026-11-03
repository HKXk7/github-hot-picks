import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import type { GenerateResult } from "../tutorial/generate";
import type { RetryCandidate } from "./retry";

// SILICONFLOW_API_KEY 是在模块加载时读进常量的（llm.ts 的 SF_KEY），
// 静态 import 之后再 stubEnv 就来不及了 —— 必须 stub 完再动态 import。
// 没 key 时补做会直接返回空数组，那样下面这些测试全都等于没测。
vi.stubEnv("SILICONFLOW_API_KEY", "test-key-not-used");
const { retryMissingTutorials, MAX_TUTORIAL_ATTEMPTS } = await import("./retry");

function candidate(patch: Partial<RetryCandidate> = {}): RetryCandidate {
  return {
    id: "repo-1",
    fullName: "someone/repo",
    description: "一个项目",
    language: "TypeScript",
    stars: 100,
    tutorialAttempts: 1,
    ...patch,
  };
}

/** 假的 prisma：只实现补做用到的两个方法，并记录调用参数 */
function fakeDb(candidates: RetryCandidate[]) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const queries: Record<string, unknown>[] = [];
  const db = {
    repository: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        queries.push(args.where);
        return candidates;
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: args.where.id, data: args.data });
        return {};
      },
    },
  };
  return { db: db as unknown as PrismaClient, updates, queries };
}

const okTutorial = {
  v: 2,
  oneLiner: "一句话说明这个项目解决什么问题",
  audience: "适合新手",
  installCommands: ["npm i demo"],
  features: ["功能一", "功能二"],
  pitfalls: ["坑一"],
  confidence: "medium",
  missingInfo: [],
} as never;

const okGenerate = vi.fn(async (): Promise<GenerateResult> => ({
  tutorial: okTutorial,
  attempts: 1,
  warnings: [],
}));

const badGenerate = vi.fn(async (): Promise<GenerateResult> => ({
  tutorial: null,
  attempts: 3,
  warnings: [],
  error: "schema 校验未通过",
}));

// 这两个测试跑在 CI 上，env 里没有 key 时 retry 会直接返回空 —— 补上假 key 让它走到主逻辑
vi.stubEnv("SILICONFLOW_API_KEY", "test-key-not-used");

describe("retryMissingTutorials", () => {
  it("没有欠账时一个模型调用都不发", async () => {
    const { db, queries } = fakeDb([]);
    const out = await retryMissingTutorials("tools", { db, generate: okGenerate });
    expect(out).toEqual([]);
    expect(okGenerate).not.toHaveBeenCalled();
    // 查询条件里必须带上「只补失败过的」和「没到上限」两个约束
    expect(queries[0]).toMatchObject({ tutorial: null, tutorialAttempts: { lt: MAX_TUTORIAL_ATTEMPTS } });
  });

  it("补做成功：写回教程并清空失败记录", async () => {
    const { db, updates } = fakeDb([candidate()]);
    const out = await retryMissingTutorials("tools", { db, generate: okGenerate });

    expect(out).toEqual([{ fullName: "someone/repo", ok: true, attempts: 2 }]);
    expect(updates[0].data).toMatchObject({ tutorial: expect.any(String), tutorialError: null, tutorialAttempts: 2 });
  });

  it("补做失败但未到上限：记下次数，下次继续补", async () => {
    const { db, updates } = fakeDb([candidate({ tutorialAttempts: 1 })]);
    const out = await retryMissingTutorials("tools", { db, generate: badGenerate });

    expect(out[0]).toMatchObject({ ok: false, attempts: 2, error: "schema 校验未通过" });
    expect(out[0].gaveUp).toBeUndefined();
    expect(updates[0].data).toMatchObject({ tutorialAttempts: 2, tutorialError: "schema 校验未通过" });
  });

  it("到了上限就标记放弃，不再每期都烧一次额度", async () => {
    // 一个连续几期都写不出来的项目，大概率是它本身有问题（README 空、仓库是固件之类）
    const { db } = fakeDb([candidate({ tutorialAttempts: MAX_TUTORIAL_ATTEMPTS - 1 })]);
    const out = await retryMissingTutorials("tools", { db, generate: badGenerate });

    expect(out[0]).toMatchObject({ ok: false, attempts: MAX_TUTORIAL_ATTEMPTS, gaveUp: true });
  });

  it("本期刚失败的项目不在这一轮补，留到下期", async () => {
    const { db, queries } = fakeDb([]);
    await retryMissingTutorials("tools", { db, generate: okGenerate }, ["today/failed"]);
    expect(queries[0]).toMatchObject({ fullName: { notIn: ["today/failed"] } });
  });

  it("不传排除名单时不加 notIn 条件", async () => {
    const { db, queries } = fakeDb([]);
    await retryMissingTutorials("tools", { db, generate: okGenerate });
    expect(queries[0]).not.toHaveProperty("fullName");
  });
});
