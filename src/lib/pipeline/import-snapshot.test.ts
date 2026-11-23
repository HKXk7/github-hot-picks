import { describe, expect, it, vi } from "vitest";
import { importSnapshot, type SnapshotLike } from "./import-snapshot";
import type { PrismaClient } from "../../../generated/prisma/client";

interface RepoUpsertArgs {
  where: { fullName: string };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
}
interface ArticleUpsertArgs {
  where: { issue: number };
  update: { title: string; weekStart: Date };
  create?: { title: string };
}
interface RecommendationCreateArgs {
  data: { articleId: string; repositoryId: string; sortOrder: number };
}

/** 只实现 importSnapshot 用到的那几个方法，参数类型写死，避免测试里大量 any */
function mockDb(knownFullNames: string[]) {
  const repo = {
    upsert: vi.fn(async (args: RepoUpsertArgs) => ({ id: `id-${args.where.fullName}` })),
    findUnique: vi.fn(async (args: { where: { fullName: string } }) =>
      knownFullNames.includes(args.where.fullName) ? { id: `id-${args.where.fullName}` } : null,
    ),
  };
  const article = {
    upsert: vi.fn(async (args: ArticleUpsertArgs) => ({
      id: "art-1",
      issue: args.where.issue,
      title: args.update.title,
    })),
  };
  const recommendation = {
    deleteMany: vi.fn(async (args: { where: { articleId: string } }) => ({ count: args.where.articleId ? 1 : 0 })),
    create: vi.fn(async (args: RecommendationCreateArgs) => ({ id: `rec-${args.data.sortOrder}` })),
  };
  const db = { repository: repo, article, recommendation } as unknown as PrismaClient;
  return { db, repo, article, recommendation };
}

const snap: SnapshotLike = {
  issue: 14,
  title: "11月9日 · GitHub 热门项目推荐",
  content: "# 稿子",
  updatedAt: "2026-11-09T05:49:48.479Z",
  picks: [
    {
      rank: 1,
      fullName: "a/one",
      name: "one",
      description: "d",
      url: "https://github.com/a/one",
      language: "TypeScript",
      stars: 100,
      reason: "活跃",
      category: "AI",
      tutorial: '{"v":2}',
    },
    {
      rank: 2,
      fullName: "b/two",
      name: "two",
      description: null,
      url: "https://github.com/b/two",
      language: null,
      stars: 50,
      tutorial: null,
    },
  ],
};

describe("importSnapshot", () => {
  it("按 issue upsert 文章，并把 weekStart 对齐快照时间", async () => {
    const { db, article } = mockDb(["a/one", "b/two"]);
    await importSnapshot(db, snap);
    expect(article.upsert).toHaveBeenCalledTimes(1);
    const args = article.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ issue: 14 });
    expect(args.update.weekStart.toISOString()).toBe("2026-11-09T05:49:48.479Z");
  });

  it("推荐关系整期重建，sortOrder 跟着 rank 走", async () => {
    const { db, recommendation } = mockDb(["a/one", "b/two"]);
    await importSnapshot(db, snap);
    expect(recommendation.deleteMany).toHaveBeenCalledWith({ where: { articleId: "art-1" } });
    expect(recommendation.create.mock.calls.map((c) => c[0].data.sortOrder)).toEqual([1, 2]);
  });

  it("快照里没有教程时不覆盖库里已有的教程", async () => {
    const { db, repo } = mockDb(["a/one", "b/two"]);
    await importSnapshot(db, snap);
    expect(repo.upsert.mock.calls[0][0].update.tutorial).toBe('{"v":2}');
    expect("tutorial" in repo.upsert.mock.calls[1][0].update).toBe(false);
  });

  it("库里查不到的项记为 missing，不静默失败", async () => {
    const { db, recommendation } = mockDb(["a/one"]); // b/two 不在库里
    const result = await importSnapshot(db, snap);
    expect(result.missing).toEqual(["b/two"]);
    expect(recommendation.create).toHaveBeenCalledTimes(1);
  });

  it("没有 picks 的快照直接报错，而不是写出一篇空稿", async () => {
    const { db } = mockDb([]);
    await expect(importSnapshot(db, { ...snap, picks: [] })).rejects.toThrow(/没有 picks/);
  });
});