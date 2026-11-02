import { describe, expect, it } from "vitest";
import {
  costOf,
  extractUsage,
  formatCost,
  pricingFromEnv,
  type TokenUsage,
} from "./usage";
import { currentTrace, emitCall, runTraced, setUsageSink, withTrace } from "./usage-sink";

const usage = (p: number, c: number): TokenUsage => ({
  promptTokens: p,
  completionTokens: c,
  totalTokens: p + c,
});

describe("单价表", () => {
  it("没配单价就算不出钱，而不是编一个数字出来", () => {
    expect(costOf(usage(1000, 1000), "some/model", {})).toBeNull();
    expect(formatCost(null)).toContain("未配置");
  });

  it("按入/出分别计价，单位是一百万 token", () => {
    const pricing = { "m/a": { in: 2, out: 8 } };
    // 100 万入 + 100 万出 = 2 + 8 = 10 元
    expect(costOf(usage(1_000_000, 1_000_000), "m/a", pricing)).toBe(10);
    // 出入同价时不能只算一半
    expect(costOf(usage(1_000_000, 0), "m/a", pricing)).toBe(2);
  });

  it("没匹配到具体模型时走 * 兜底", () => {
    const pricing = { "m/a": { in: 2, out: 8 }, "*": { in: 1, out: 1 } };
    expect(costOf(usage(1_000_000, 1_000_000), "m/unknown", pricing)).toBe(2);
  });

  it("配坏了就当作没配，不能拿半截表算钱", () => {
    expect(pricingFromEnv("not json")).toEqual({});
    expect(pricingFromEnv('{"a":{"in":1}}')).toEqual({});
    expect(pricingFromEnv('{"a":{"in":1,"out":2}}')).toEqual({ a: { in: 1, out: 2 } });
  });
});

describe("用量解析", () => {
  it("各家字段名不一样也能取到", () => {
    expect(extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })).toEqual(
      usage(10, 5),
    );
    expect(extractUsage({ usage: { input_tokens: 7, output_tokens: 3 } })).toEqual(usage(7, 3));
  });

  it("流式响应经常不给 usage，这时是 0 而不是报错", () => {
    expect(extractUsage({ choices: [] })).toEqual(usage(0, 0));
    expect(extractUsage(null)).toEqual(usage(0, 0));
  });

  it("没给 total 时自己加起来", () => {
    expect(extractUsage({ usage: { prompt_tokens: 4, completion_tokens: 6 } }).totalTokens).toBe(10);
  });
});

describe("调用链上下文", () => {
  it("traceId 能自动传到嵌套的异步调用里", async () => {
    const seen: string[] = [];
    setUsageSink((r) => seen.push(`${r.kind}/${r.label ?? "-"}/${r.traceId}`));
    await runTraced("tutorial", "owner/repo", async () => {
      // 模拟 agent 内部层层嵌套后上报：调用方不该被要求手工透传 traceId
      await Promise.all([
        (async () => {
          emitCall({
            traceId: currentTrace()!.id,
            kind: currentTrace()!.kind,
            label: "取证",
            model: "m",
            usage: usage(1, 1),
            latencyMs: 1,
            ok: true,
          });
        })(),
        new Promise((r) => setTimeout(r, 1)).then(() => {
          emitCall({
            traceId: currentTrace()!.id,
            kind: currentTrace()!.kind,
            label: "修复",
            model: "m",
            usage: usage(1, 1),
            latencyMs: 1,
            ok: true,
          });
        }),
      ]);
    });
    setUsageSink(null);

    expect(seen).toHaveLength(2);
    const [a, b] = seen.map((s) => s.split("/"));
    expect(a[0]).toBe("tutorial");
    expect(b[0]).toBe("tutorial");
    // 两次嵌套调用拿到的是同一个 traceId
    expect(seen[0].split("/")[2]).toBe(seen[1].split("/")[2]);
  });

  it("没有上下文时不炸，标成 unknown", async () => {
    const seen: string[] = [];
    setUsageSink((r) => seen.push(r.traceId));
    await withTrace({ id: "t1", kind: "chat" }, async () => {
      emitCall({ traceId: "unknown", kind: "chat", model: "m", usage: usage(0, 0), latencyMs: 0, ok: true });
    });
    setUsageSink(null);
    expect(seen).toEqual(["unknown"]);
  });

  it("sink 自己抛错不能影响业务", () => {
    setUsageSink(() => {
      throw new Error("数据库挂了");
    });
    expect(() =>
      emitCall({ traceId: "t", kind: "chat", model: "m", usage: usage(0, 0), latencyMs: 0, ok: true }),
    ).not.toThrow();
    setUsageSink(null);
  });
});
