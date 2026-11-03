/**
 * 带上限的并发 map，且**输出顺序与输入一致**。
 *
 * 评测原先是串行 for 循环：每个样本要真调模型生成教程（约 50s），
 * 20 个样本跑 18 分钟，扩到 50 个就是 40+ 分钟 —— CI 上既慢又容易超时。
 *
 * 用固定大小的 worker 池，任何时刻最多 limit 个请求在飞；结果按原下标写回，
 * 所以调用方拿到的数组顺序和传进去的 cases 完全一致（报告里的样本顺序、日志顺序
 * 都得稳定，否则两次运行没法对照）。
 *
 * 为什么不用 Promise.all 直接铺开：那会一次性打出 50 个请求，上游限流
 * 立刻 429，退避重试反而更慢，还会把额度烧在重试上。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.min(Math.floor(limit) || 1, items.length || 1));
  const out = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: size }, () => worker()));
  return out;
}
