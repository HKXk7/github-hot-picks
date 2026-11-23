import { describe, expect, it } from "vitest";
import { describeHttpError, isFatalLlmStatus } from "./http-error";

describe("isFatalLlmStatus", () => {
  it("欠费、凭证无效、无权限属于不可重试", () => {
    for (const s of [401, 402, 403]) expect(isFatalLlmStatus(s)).toBe(true);
  });

  it("限流与上游 5xx 仍然可重试", () => {
    for (const s of [400, 404, 408, 429, 500, 502, 503]) expect(isFatalLlmStatus(s)).toBe(false);
  });

  it("没有状态码（网络异常等）不当作致命", () => {
    expect(isFatalLlmStatus(undefined)).toBe(false);
  });
});

describe("describeHttpError", () => {
  it("402 直接说清是余额不足，并保留上游原文便于回溯", () => {
    const msg = describeHttpError(
      402,
      '{"code":30001,"message":"Sorry, your account balance is insufficient"}',
    );
    expect(msg.startsWith("HTTP 402")).toBe(true);
    expect(msg).toContain("余额不足");
    expect(msg).toContain("30001");
  });

  it("401 / 403 给出对应的排查方向", () => {
    expect(describeHttpError(401, "")).toContain("API Key");
    expect(describeHttpError(403, "")).toContain("权限");
  });

  it("其他状态码保留原始码与报文", () => {
    expect(describeHttpError(500, "upstream error")).toBe("HTTP 500 upstream error");
  });

  it("报文过长时截断，避免把日志刷屏", () => {
    const msg = describeHttpError(500, "x".repeat(500));
    expect(msg.length).toBeLessThan(260);
  });
});
