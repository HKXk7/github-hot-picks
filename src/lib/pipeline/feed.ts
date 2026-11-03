/**
 * 生成 RSS 订阅源。
 *
 * 为什么不做一个「每次请求现算」的接口：这个站点的数据一天只变一次，
 * 为了它每次请求都去查一次库，只是把成本转嫁给每一个抓订阅的请求。
 * 日更任务跑完顺手写好静态文件，订阅服务器拿到的永远是当天那一版。
 *
 * 抽成纯函数是为了能单测 —— RSS 的格式错了不会报错，
 * 只会在别人的阅读器里变成一片空白，而你自己永远看不见。
 */

export interface FeedPick {
  rank: number;
  fullName: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  category: string;
}

export interface FeedInput {
  /** 站点对外绝对地址（feed 里的链接必须是绝对的，否则阅读器解析不出来） */
  siteUrl: string;
  issue: number;
  dateKey: string;
  title: string;
  picks: FeedPick[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** CDATA 里唯一要处理的就是内容自带的结束标记，否则会提前截断 */
function cdata(s: string): string {
  return `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

/** RSS 要求 RFC 822 格式的日期，不是 ISO 也不是时间戳 */
function rfc822(d: Date): string {
  return d.toUTCString();
}

/** dateKey 是「中国时区的那一天」，取当天 08:00 作为发布时间 */
function dateKeyToDate(dateKey: string): Date {
  return new Date(`${dateKey}T08:00:00+08:00`);
}

export function buildRssFeed(input: FeedInput): string {
  const site = input.siteUrl.replace(/\/$/, "");
  const pub = rfc822(dateKeyToDate(input.dateKey));

  const items = input.picks
    .map((p) => {
      const bits = [
        p.description ?? "",
        `语言：${p.language ?? "—"} | Star：${p.stars} | 分类：${p.category}`,
        `第 ${input.issue} 期（${input.dateKey}）推荐 · 原文 ${site}/history/${input.dateKey}`,
      ].filter(Boolean);
      return [
        "    <item>",
        `      <title>${esc(`${p.rank}. ${p.fullName}`)}</title>`,
        `      <link>${esc(p.url)}</link>`,
        // guid 用「项目 + 期号」而不是链接：同一个项目可能被不同期推荐过，
        // 用链接做 guid 会让阅读器把它们当成同一条
        `      <guid isPermaLink="false">${esc(`${p.fullName}@${input.dateKey}`)}</guid>`,
        `      <pubDate>${pub}</pubDate>`,
        `      <category>${esc(p.category)}</category>`,
        `      <description>${cdata(bits.join("\n\n"))}</description>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    "    <title>GitHub 热门项目推荐</title>",
    `    <link>${esc(site)}</link>`,
    "    <description>每天从 GitHub 新项目中挑选值得关注的开源项目，并给每个项目配一篇小白教程。</description>",
    "    <language>zh-CN</language>",
    `    <lastBuildDate>${rfc822(new Date())}</lastBuildDate>`,
    `    <atom:link href="${esc(site)}/feed.xml" rel="self" type="application/rss+xml" />`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
