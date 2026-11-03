/**
 * 给「之前推荐过、但教程没生成出来」的项目补做一次教程。
 *
 * 为什么要补：项目一旦被推荐出去就进了历史去重名单，以后不会再被选中，
 * 于是「生成失败」会变成永久状态 —— 读者点开这个项目永远没有教程。
 * 不补的话，失败只是被记下来，问题并没有被解决。
 *
 * 为什么单独抽成模块：这段逻辑错了不会报错，只会安静地一直补不上
 * （或者反过来，每期把额度烧在补做上）。注入 db 和 generate 之后可以单测，
 * 用假的 prisma 和假模型就能断言「什么时候该补、什么时候该放弃」。
 */
import type { PrismaClient } from "../../../generated/prisma/client";
import { attachEvidence } from "../tutorial/evidence";
import {
  generateStructuredTutorial,
  hasApiKey,
  type GenerateResult,
  type GenerationMode,
  type TutorialMeta,
} from "../tutorial/generate";
import type { RetryOutcome } from "./report";

/** 同一个项目最多跨期补做几次，超过就标记放弃，不再自动重试 */
export const MAX_TUTORIAL_ATTEMPTS = 3;
/** 每期最多补做几个，避免某天积压太多把这一期的额度吃光 */
export const RETRIES_PER_RUN = 3;

/** 待补做项目需要的字段（查询里刻意只取这些，不把整行拉出来） */
export interface RetryCandidate {
  id: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  tutorialAttempts: number;
}

export interface RetryDeps {
  db: PrismaClient;
  /** 注入点：测试里用假模型替掉，不去真调 API */
  generate?: (meta: TutorialMeta, opts: { mode: GenerationMode; log?: (msg: string) => void }) => Promise<GenerateResult>;
  log?: (msg: string) => void;
}

export async function retryMissingTutorials(
  mode: GenerationMode,
  { db, generate = generateStructuredTutorial, log = () => {} }: RetryDeps,
  /** 本期刚失败的项目：这次先不补，留到下期 */
  exclude: string[] = [],
): Promise<RetryOutcome[]> {
  if (!hasApiKey()) return [];

  // 先查「有没有欠账」，没有就直接返回，别白打日志吓人
  const queue = await db.repository.findMany({
    where: {
      tutorial: null,
      // 只认失败过的。早期从快照导入的项目也可能没教程，那是历史遗留不是失败，
      // 不该在这儿悄悄花钱批量补。
      tutorialError: { not: null },
      tutorialAttempts: { lt: MAX_TUTORIAL_ATTEMPTS },
      // 本期刚失败的先不补：一次生成内部已经自我修复过 3 次（generate.ts 的 MAX_ATTEMPTS），
      // 紧接着再试一次大概率还是同样的结果，留到下一期更有意义，也省额度。
      ...(exclude.length ? { fullName: { notIn: exclude } } : {}),
      // 只补真正推荐过的：没上过榜的项目读者根本看不到，不值得花钱
      recommendations: { some: {} },
    },
    select: {
      id: true,
      fullName: true,
      description: true,
      language: true,
      stars: true,
      tutorialAttempts: true,
    },
    orderBy: { tutorialFailedAt: "asc" },
    take: RETRIES_PER_RUN,
  });
  if (queue.length === 0) return [];

  log(`\n♻️ 补做历史欠账：${queue.length} 个项目此前教程生成失败`);
  const out: RetryOutcome[] = [];

  for (const repo of queue) {
    const attempts = repo.tutorialAttempts + 1;
    log(`   ✍️ ${repo.fullName}（第 ${attempts} 次）`);

    const result = await generate(
      {
        fullName: repo.fullName,
        description: repo.description,
        language: repo.language,
        stars: repo.stars,
        topics: [],
        homepage: null,
      },
      { mode, log: (msg) => log(`      ${msg}`) },
    );

    if (result.tutorial) {
      await db.repository.update({
        where: { id: repo.id },
        data: {
          tutorial: JSON.stringify(attachEvidence(result.tutorial, result.toolCalls)),
          tutorialError: null,
          tutorialFailedAt: null,
          tutorialAttempts: attempts,
        },
      });
      out.push({ fullName: repo.fullName, ok: true, attempts });
      log(`   ✅ ${repo.fullName} 补上了`);
      continue;
    }

    const gaveUp = attempts >= MAX_TUTORIAL_ATTEMPTS;
    const error = result.error ?? "未知原因";
    await db.repository.update({
      where: { id: repo.id },
      data: { tutorialError: error, tutorialAttempts: attempts, tutorialFailedAt: new Date() },
    });
    out.push({
      fullName: repo.fullName,
      ok: false,
      attempts,
      error,
      ...(gaveUp ? { gaveUp: true } : {}),
    });
    log(`   ${gaveUp ? "⛔" : "⚠️"} ${repo.fullName} 仍未成功${gaveUp ? "，已到上限，不再自动补做" : ""}`);
  }

  return out;
}
