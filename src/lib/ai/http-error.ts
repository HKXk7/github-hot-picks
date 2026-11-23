/**
 * 上游 HTTP 错误的分类与可读化。
 *
 * 为什么单独抽出来：402 / 401 / 403 不是「这次运气不好」，而是配置或额度问题，
 * 重试多少次都不会成功。之前它们被当成普通失败——日更对 7 个项目各重试 3 轮，
 * 最后统一报「连续 3 轮未通过校验」，把真正的原因（余额不足）埋掉了。
 *
 * 纯函数，方便单测，也不牵扯 fetch / 环境变量。
 */

/** 重试也不会有结果的状态码：凭证无效 / 无权限 / 欠费 */
export function isFatalLlmStatus(status?: number): boolean {
  return status === 401 || status === 402 || status === 403;
}

/**
 * 把上游错误变成「能直接照做」的提示。
 * 结论放最前面，原始报文保留在尾部，方便日志里回溯。
 */
export function describeHttpError(status: number, body: string): string {
  const raw = body.trim().slice(0, 200);
  const tail = raw ? ` — 上游原文：${raw}` : "";
  if (status === 402) return `HTTP 402 账户余额不足，上游拒绝服务（充值后重试）${tail}`;
  if (status === 401) return `HTTP 401 API Key 无效或已过期（检查 SILICONFLOW_API_KEY）${tail}`;
  if (status === 403) return `HTTP 403 无访问权限（密钥权限不足或模型未开通）${tail}`;
  return `HTTP ${status} ${raw}`.trim();
}
