import { describe, expect, it } from "vitest";
import { formatDateLabel, upsertHistory, type HistoryEntry } from "./static-data";

const entry = (dateKey: string, issue: number): HistoryEntry => ({
  issue,
  dateKey,
  dateLabel: formatDateLabel(dateKey),
  title: `第 ${issue} 期`,
  pickCount: 10,
  totalStars: 1000,
  updatedAt: `${dateKey}T09:00:00.000Z`,
});

describe("upsertHistory", () => {
  it("同一天重跑覆盖而不是追加", () => {
    const old = [entry("2026-11-02", 7), entry("2026-11-01", 6)];
    const next = upsertHistory(old, entry("2026-11-02", 8));
    expect(next).toHaveLength(2);
    expect(next.find((h) => h.dateKey === "2026-11-02")?.issue).toBe(8);
  });

  it("按日期倒序，和插入顺序无关", () => {
    const next = upsertHistory([entry("2026-10-30", 5), entry("2026-11-02", 7)], entry("2026-11-01", 6));
    expect(next.map((h) => h.dateKey)).toEqual(["2026-11-02", "2026-11-01", "2026-10-30"]);
  });

  it("空索引也能用", () => {
    expect(upsertHistory([], entry("2026-11-03", 8))).toHaveLength(1);
  });

  it("不修改传入的数组", () => {
    const old = [entry("2026-11-02", 7)];
    upsertHistory(old, entry("2026-11-03", 8));
    expect(old).toHaveLength(1);
  });
});

describe("formatDateLabel", () => {
  it("从 dateKey 拼中文日期，不受服务器时区影响", () => {
    expect(formatDateLabel("2026-11-03")).toBe("2026年11月3日");
  });

  it("非法输入原样返回，不崩", () => {
    expect(formatDateLabel("oops")).toBe("oops");
  });
});
