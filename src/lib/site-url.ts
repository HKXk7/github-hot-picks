/**
 * 站点对外绝对地址。
 *
 * sitemap / robots / RSS / OG 里全都要绝对 URL —— 相对路径搜索引擎和阅读器都不认。
 * 没有部署地址的场合退回 localhost：宁可链接错得一眼能看出来，
 * 也不要因为缺个环境变量让构建挂掉。
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
