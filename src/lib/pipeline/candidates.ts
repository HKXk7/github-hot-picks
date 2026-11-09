/**
 * 「这个项目以前推荐过吗」的判断。
 *
 * 只按 fullName 去重是不够的 —— 仓库会被作者改名，而改名之后是两连击：
 *   1. 旧的 fullName 对不上，它从去重名单里消失，于是又被当成新项目推荐一次；
 *   2. `Repository.githubId` 是唯一约束，upsert 这时判断成「新记录」走 create 分支，
 *      撞上 P2002。日更脚本里那一步原本没有兜底，异常一路冒到最外层 →
 *      整轮 exit 1，当天一期稿子、快照、RSS 全都不落盘。
 *
 * 所以历史索引必须把 githubId 一起记下来：名字对得上、或者 id 对得上，都算推荐过。
 * 抽成纯函数是为了能单测 —— 「去重漏了一个」不会报错，只会安静地让日更在某天挂掉。
 */

/** 从数据库里读出来的历史记录：只需要这两个身份字段 */
export interface KnownRepo {
  fullName: string;
  githubId: number;
}

export interface HistoryIndex {
  /** 推荐过的仓库全名（会随时间变化，改名的仓库查不到） */
  names: Set<string>;
  /** 推荐过的 GitHub 数字 id（仓库改名后不变，这是真正的身份） */
  ids: Set<number>;
}

/** 候选项目的形状：GitHub Search API 的字段名 */
export interface CandidateLike {
  full_name: string;
  id: number;
}

export function indexHistory(rows: KnownRepo[]): HistoryIndex {
  return {
    names: new Set(rows.map((r) => r.fullName)),
    ids: new Set(rows.map((r) => r.githubId)),
  };
}

/**
 * 是否已经推荐过。
 *
 * 名字命中或 id 命中都算 —— 只看名字会让改名的项目重复上榜，
 * 只看 id 则会让「从快照导入、githubId 是哈希假值」的老记录失效。
 */
export function isAlreadyRecommended(index: HistoryIndex, repo: CandidateLike): boolean {
  return index.names.has(repo.full_name) || index.ids.has(repo.id);
}

/** 过滤出没推荐过的候选，保持原有顺序 */
export function selectFresh<T extends CandidateLike>(items: T[], index: HistoryIndex): T[] {
  return items.filter((item) => !isAlreadyRecommended(index, item));
}