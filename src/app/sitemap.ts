import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getIssueList } from "@/lib/site-data";
import { absoluteUrl } from "@/lib/site-url";

/**
 * 站点地图。
 *
 * 必须按请求生成，不能在构建时烘死：往期页面是每天新增的，
 * 而构建那一刻数据库通常是空的（CI 里就是），烘出来的地图会永远缺往期页面。
 *
 * 这里不能用 `export const revalidate`：开了 cacheComponents 之后它被禁用了
 * （build 会直接报错）。改用 connection() 显式声明「我需要真实请求上下文」，
 * 这是 cacheComponents 下让一个路由按请求渲染的官方方式。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  // getIssueList 内部对数据库不可用做了兜底（返回空数组），这里不用再包一层 try
  const issues = await getIssueList();

  return [
    {
      url: absoluteUrl("/"),
      lastModified: issues[0]?.updatedAt ? new Date(issues[0].updatedAt) : new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteUrl("/history"),
      lastModified: issues[0]?.updatedAt ? new Date(issues[0].updatedAt) : new Date(),
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...issues.map((i) => ({
      url: absoluteUrl(`/history/${i.dateKey}`),
      lastModified: new Date(i.updatedAt),
      // 往期内容不会再变，爬虫不必反复来
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
