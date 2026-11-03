/**
 * 线上部署用的「远端数据源」。
 *
 * 背景：站点数据由 GitHub Actions 每天改写到仓库里的 `public/data/`，
 * 但部署出去的那份代码是构建那一刻的快照，不会自己跟着仓库更新。
 * 如果什么都不做，上线第二天首页就停在旧的一期了。
 *
 * 所以部署版配一个 `SITE_SNAPSHOT_BASE`，运行时按短 TTL 去 GitHub 拉最新
 * 的 JSON。本地开发不配这个变量，完全走本地文件 / 数据库，零影响。
 *
 * 三条硬约束：
 * 1. 有超时。GitHub 抽风时不能让访客的首页卡住。
 * 2. 失败静默回退到打包进镜像的本地文件，绝不因为网络问题让站点白屏。
 * 3. 有 TTL。公开 GitHub API 未认证限额 60 次/小时，每个请求都打过去必被限流。
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const LOCAL_DIR = path.join(process.cwd(), "public", "data");
/** 10 分钟。数据一天一变，十分钟的新鲜度足够，又远低于 API 限额 */
const TTL_MS = 10 * 60 * 1000;
/** 单次请求最多等 5 秒 */
const TIMEOUT_MS = 5_000;

const remoteCache = new Map<string, { at: number; value: unknown }>();

function elapsed(): number {
  // 和 site-data 的缓存同理：预渲染期不能用 Date.now()
  return performance.now();
}

function base(): string | null {
  const v = process.env.SITE_SNAPSHOT_BASE?.trim().replace(/\/+$/, "");
  return v || null;
}

/** GitHub Contents API 要显式要 raw，否则返回的是 base64 包装的 JSON */
function isGitHubApi(url: string): boolean {
  return url.includes("api.github.com");
}

async function readLocal<T>(rel: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(LOCAL_DIR, rel), "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * 读一份数据文件：配了远端就优先远端（带 TTL），失败或没配就读本地。
 * `rel` 只能是固定几个文件名或 `issues/YYYY-MM-DD.json`，调用方负责校验，
 * 不接受外部输入拼路径 —— 避免被构造成任意文件读取。
 */
export async function readSiteData<T>(rel: string): Promise<T | null> {
  const root = base();
  if (!root) return readLocal<T>(rel);

  const hit = remoteCache.get(rel);
  if (hit && elapsed() - hit.at < TTL_MS) return hit.value as T | null;

  let value: T | null = null;
  try {
    const url = isGitHubApi(root)
      ? `${root}/${rel}?ref=${encodeURIComponent(process.env.SITE_SNAPSHOT_REF ?? "main")}`
      : `${root}/${rel}`;
    const res = await fetch(url, {
      headers: isGitHubApi(root)
        ? { Accept: "application/vnd.github.raw", "User-Agent": "github-hot-picks-site" }
        : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) value = (await res.json()) as T;
  } catch {
    // 超时 / 网络错误 / JSON 坏了，都交给下面的本地兜底
  }

  if (value === null) value = await readLocal<T>(rel);
  remoteCache.set(rel, { at: elapsed(), value });
  return value;
}

/** 测试用：清掉远端缓存 */
export function clearSnapshotCache(): void {
  remoteCache.clear();
}
