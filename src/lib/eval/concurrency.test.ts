import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";
import { formatInterval, wilsonInterval } from "./stats";

describe("mapWithConcurrency", () => {
  it("结果顺序与输入一致，哪怕完成时间乱序", async () => {
    const delays = [30, 5, 20, 1];
    const out = await mapWithConcurrency(delays, 3, async (d) => {
      await new Promise((r) => setTimeout(r, d));
      return d * 10;
    });
    expect(out).toEqual([300, 50, 200, 10]);
  });

  it("任意时刻并发数不超过上限", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return inFlight;
    });
    expect(peak).toBe(4);
  });

  it("limit 比样本多时也不创建多余的 worker", async () => {
    let calls = 0;
    const out = await mapWithConcurrency([1, 2], 100, async (n) => {
      calls++;
      return n;
    });
    expect(out).toEqual([1, 2]);
    expect(calls).toBe(2);
  });

  it("空输入返回空数组", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("单个失败会传播，不会静默吞掉", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

describe("wilsonInterval", () => {
  it("样本越多区间越窄", () => {
    const small = wilsonInterval(7, 20);
    const large = wilsonInterval(35, 100);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
    expect(small.low).toBeGreaterThan(0);
    expect(large.low).toBeGreaterThan(0);
  });

  it("p=0 和 p=1 时区间不会越界", () => {
    expect(wilsonInterval(0, 10).low).toBe(0);
    expect(wilsonInterval(10, 10).high).toBe(1);
  });

  it("空样本返回 [0,0]，不除零", () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 0 });
  });

  it("格式化成百分比区间", () => {
    expect(formatInterval({ low: 0.21, high: 0.52 })).toBe("[21%, 52%]");
  });
});
