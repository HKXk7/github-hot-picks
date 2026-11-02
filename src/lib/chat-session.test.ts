import { describe, expect, it } from "vitest";
import { MAX_HISTORY_CHARS, SUMMARIZE_THRESHOLD, trimHistory } from "./chat-session";

const msg = (role: string, content: string) => ({ role, content });

describe("历史裁剪", () => {
  it("短历史原样保留，顺序不变", () => {
    const input = [msg("user", "一"), msg("assistant", "二"), msg("user", "三")];
    expect(trimHistory(input)).toEqual(input);
  });

  it("超长时丢最早的，保住最近的", () => {
    const input = [
      msg("user", "很早的问题"),
      msg("assistant", "很早的回答"),
      msg("user", "最近的问题"),
      msg("assistant", "最近的回答"),
    ];
    const out = trimHistory(input);
    // 没有超限时不该动它——这条是给下面那条做对照
    expect(out).toHaveLength(4);

    const long = [msg("user", "x".repeat(MAX_HISTORY_CHARS)), ...input];
    const trimmed = trimHistory(long);
    expect(trimmed[0].content).toBe("很早的问题");
    expect(trimmed.at(-1)?.content).toBe("最近的回答");
    expect(trimmed.length).toBeLessThan(long.length);
  });

  it("丢掉的是最早的那一头，不是最近的一头", () => {
    const long = [
      msg("user", "A".repeat(6000)),
      msg("assistant", "B".repeat(6000)),
      msg("user", "C".repeat(6000)),
      msg("user", "最新"),
    ];
    const trimmed = trimHistory(long);
    expect(trimmed.at(-1)?.content).toBe("最新");
    expect(trimmed.some((m) => m.content.startsWith("A"))).toBe(false);
  });

  it("过滤掉非对话角色，脏数据进不了上下文", () => {
    const out = trimHistory([msg("system", "不该出现"), msg("user", "你好")]);
    expect(out).toEqual([msg("user", "你好")]);
  });
});

describe("折叠阈值", () => {
  it("阈值要明显大于保留条数，否则会边聊边反复折叠", () => {
    // trimHistory 不做折叠，这里只是守住两个常数的关系，
    // 免得以后有人把阈值调到比保留窗口还小，导致每轮都触发一次摘要调用
    expect(SUMMARIZE_THRESHOLD).toBeGreaterThan(12);
  });
});
