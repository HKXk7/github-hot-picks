import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /api 是花钱的接口，不该让爬虫来触发；
        // /usage 是内部成本看板，没有给搜索引擎看的价值
        disallow: ["/api/", "/usage"],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
