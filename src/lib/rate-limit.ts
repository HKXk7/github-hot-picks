/**
 * 按调用方计费的接口，必须限流。
 * ================================
 * `/api/chat` 和 `/api/tutorial` 都是公开的 POST 接口，每调一次就真金白银地
 * 消耗硅基流动的额度。没有这道闸门，任何人拿个循环刷几百次就能把额度烧光，
 * 而且页面上完全看不出异常——只是「AI 突然不回答了」。
 *
 * 实现是**单进程内存**的滑动窗口：够用、零依赖、不需要额外基础设施。
 * ⚠️ 局限要说清楚：多实例部署（或 serverless 多并发）下每个实例各算各的，
 * 真实上限会成倍放大。真要部署到那种环境，把 `checkRateLimit` 换成 Redis
 * 实现即可，调用方不用改。
 */

export interface RateLimitResult {
  ok: boolean;
  /** 本窗口内还剩几次 */
  remaining: number;
  /** 需要等多久才能再试（毫秒）；未超限时为 0 */
  retryAfterMs: number;
  /** 窗口重置的时间点（epoch ms） */
  resetAt: number;
}

interface RateLimitOptions {
  /** 窗口内允许的最大次数 */
  limit: number;
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 注入当前时间，只为单测能脱离真实时钟 */
  now?: number;
}

/** key → 该 key 最近若干次调用的时间戳（只保留窗口内的） */
const hits = new Map<string, number[]>();

/**
 * 防止 Map 无限膨胀：不同 IP 越多占得越多，且被扫段的攻击会写进大量只用过一次的 key。
 * 超过上限时丢掉最久没动静的那一批——这些 key 大概率不会再来了。
 */
const MAX_KEYS = 5000;

function evictIfNeeded(now: number, windowMs: number) {
  if (hits.size <= MAX_KEYS) return;
  // 先清一遍已经彻底过期的，多数情况这一步就够了
  for (const [key, times] of hits) {
    if (times.length === 0 || now - times[times.length - 1] > windowMs) hits.delete(key);
  }
  if (hits.size <= MAX_KEYS) return;
  const byRecency = [...hits.entries()].sort(
    (a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0),
  );
  for (const [key] of byRecency.slice(0, Math.ceil(MAX_KEYS / 4))) hits.delete(key);
}

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now();
  const cutoff = now - windowMs;

  // 先丢掉窗口外的记录，滑动窗口才不会变成「一旦触发就永远封着」
  const times = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (times.length >= limit) {
    const oldest = times[0];
    const retryAfterMs = Math.max(1, oldest + windowMs - now);
    hits.set(key, times);
    return {
      ok: false,
      remaining: 0,
      retryAfterMs,
      resetAt: oldest + windowMs,
    };
  }

  times.push(now);
  hits.set(key, times);
  evictIfNeeded(now, windowMs);

  return {
    ok: true,
    remaining: limit - times.length,
    retryAfterMs: 0,
    resetAt: times[0] + windowMs,
  };
}

/** 测试用：清空全部计数 */
export function resetRateLimit(): void {
  hits.clear();
}

/**
 * 取调用方 IP。
 *
 * 自托管时 Nginx / Caddy 后面一般只有 x-forwarded-for；Vercel 这类平台会额外
 * 给 x-real-ip。取不到时（比如本地直连）退回一个固定值——此时限流等价于全局限流，
 * 总比因为拿不到 IP 就完全不限要好。
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    // 形如 "client, proxy1, proxy2"，第一个才是真实来源
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** 429 的统一响应头，前端和 curl 都能直接看出要等多久 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-remaining": String(result.remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  };
  if (!result.ok) headers["retry-after"] = String(Math.ceil(result.retryAfterMs / 1000));
  return headers;
}
