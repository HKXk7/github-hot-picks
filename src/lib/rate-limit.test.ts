import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, rateLimitHeaders, resetRateLimit } from "./rate-limit";

const WINDOW = 60_000;

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimit());

  it("窗口内用完配额后拒绝，并给出还要等多久", () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit("a", { limit: 3, windowMs: WINDOW, now: t + i }).ok).toBe(true);
    }

    const blocked = checkRateLimit("a", { limit: 3, windowMs: WINDOW, now: t + 10 });
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    // 最早那次发生在 t，窗口到 t+60000 才腾出位置
    expect(blocked.retryAfterMs).toBe(WINDOW - 10);
  });

  it("是滑动窗口：过期一条就恢复一条，不是整点清零", () => {
    const t = 1_700_000_000_000;
    checkRateLimit("a", { limit: 2, windowMs: WINDOW, now: t });
    checkRateLimit("a", { limit: 2, windowMs: WINDOW, now: t + 1000 });
    expect(checkRateLimit("a", { limit: 2, windowMs: WINDOW, now: t + 2000 }).ok).toBe(false);

    // t 那条已经滑出窗口，空出一个位置
    expect(checkRateLimit("a", { limit: 2, windowMs: WINDOW, now: t + WINDOW + 1 }).ok).toBe(true);
  });

  it("不同 key 各算各的", () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 5; i++) {
      checkRateLimit("user-a", { limit: 5, windowMs: WINDOW, now: t + i });
    }
    expect(checkRateLimit("user-a", { limit: 5, windowMs: WINDOW, now: t }).ok).toBe(false);
    expect(checkRateLimit("user-b", { limit: 5, windowMs: WINDOW, now: t }).ok).toBe(true);
  });

  it("remaining 递减", () => {
    const t = 1_700_000_000_000;
    expect(checkRateLimit("a", { limit: 3, windowMs: WINDOW, now: t }).remaining).toBe(2);
    expect(checkRateLimit("a", { limit: 3, windowMs: WINDOW, now: t + 1 }).remaining).toBe(1);
  });

  it("超大量不同 key 时不会把内存撑爆", () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 12_000; i++) {
      checkRateLimit(`ip-${i}`, { limit: 5, windowMs: WINDOW, now: t });
    }
    // 内部有上限，且不会抛错
    expect(checkRateLimit("survivor", { limit: 5, windowMs: WINDOW, now: t }).ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("x-forwarded-for 取第一个（后面是代理链）", () => {
    const h = new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1, 10.0.0.2" });
    expect(clientIp(h)).toBe("1.2.3.4");
  });

  it("没有 x-forwarded-for 时退到 x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
  });

  it("都取不到时返回 unknown（退化为全局限流，而不是不限流）", () => {
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("rateLimitHeaders", () => {
  it("未超限时只给计数头", () => {
    const h = rateLimitHeaders({ ok: true, remaining: 7, retryAfterMs: 0, resetAt: 1_700_000_060_000 });
    expect(h["x-ratelimit-remaining"]).toBe("7");
    expect(h["retry-after"]).toBeUndefined();
  });

  it("超限时带上 retry-after", () => {
    const h = rateLimitHeaders({ ok: false, remaining: 0, retryAfterMs: 5000, resetAt: 1_700_000_060_000 });
    expect(h["retry-after"]).toBe("5");
  });
});
