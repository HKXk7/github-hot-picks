import { describe, expect, it } from "vitest";
import { buildRunReport, formatRunReport, formatRunReportMarkdown } from "./report";
import type { StepOutcome } from "./report";

const step = (fullName: string, kind: StepOutcome["kind"], error?: string): StepOutcome => ({
  fullName,
  kind,
  ...(error ? { error } : {}),
});

describe("buildRunReport", () => {
  it("全部就位时是 success", () => {
    const r = buildRunReport([step("a/b", "generated"), step("c/d", "reused")]);
    expect(r.status).toBe("success");
    expect(r.generated).toBe(1);
    expect(r.reused).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it("有一个失败就是 partial，不能因为大多数成功就当没事", () => {
    // 这正是之前那类问题的根源：9 个成功盖住了 1 个失败，跑完照样报成功
    const r = buildRunReport([
      step("a/b", "generated"),
      ...Array.from({ length: 9 }, (_, i) => step(`ok/${i}`, "reused")),
      step("bad/repo", "failed", "schema 校验 3 次未通过"),
    ]);
    expect(r.status).toBe("partial");
    expect(r.failures).toEqual([{ fullName: "bad/repo", error: "schema 校验 3 次未通过" }]);
  });

  it("没尝试生成（例如没配 key）不算失败", () => {
    // 那是环境配置问题，不是模型质量问题，混在一起会让报告没法读
    const r = buildRunReport([step("a/b", "skipped")]);
    expect(r.status).toBe("success");
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);
  });

  it("统计补做历史欠账的结果", () => {
    const r = buildRunReport([step("a/b", "reused")], [
      { fullName: "x/y", ok: true, attempts: 2 },
      { fullName: "z/w", ok: false, attempts: 3, gaveUp: true, error: "仍然失败" },
    ]);
    expect(r.retryAttempted).toBe(2);
    expect(r.retryFixed).toBe(1);
    expect(r.retryGaveUp).toBe(1);
    // 补做失败不影响本期结论：本期自己的教程是齐的
    expect(r.status).toBe("success");
  });
});

describe("formatRunReport", () => {
  it("把失败项目明明白白列出来", () => {
    const text = formatRunReport(buildRunReport([step("bad/repo", "failed", "超时")]));
    expect(text).toContain("bad/repo");
    expect(text).toContain("超时");
    expect(text).toContain("❌");
  });

  it("全部成功时不出现 ❌", () => {
    const text = formatRunReport(buildRunReport([step("a/b", "generated")]));
    expect(text).not.toContain("❌");
    expect(text).toContain("✅");
  });

  it("有补做时才提补做", () => {
    expect(formatRunReport(buildRunReport([step("a/b", "generated")]))).not.toContain("补做");
    const withRetry = formatRunReport(
      buildRunReport([step("a/b", "generated")], [{ fullName: "x/y", ok: true, attempts: 2 }]),
    );
    expect(withRetry).toContain("补做历史欠账");
  });
});

describe("formatRunReportMarkdown", () => {
  it("输出表格并标出状态", () => {
    const md = formatRunReportMarkdown(buildRunReport([step("bad/repo", "failed", "超时")]));
    expect(md).toContain("| 项 | 数量 |");
    expect(md).toContain("部分成功");
    expect(md).toContain("`bad/repo`");
  });
});
