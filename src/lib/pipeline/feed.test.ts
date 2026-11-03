import { describe, expect, it } from "vitest";
import { buildRssFeed, type FeedPick } from "./feed";

const input = {
  siteUrl: "https://example.com/",
  issue: 7,
  dateKey: "2026-11-03",
  title: "11月3日 · GitHub 热门项目推荐",
  picks: [
    {
      rank: 1,
      fullName: "someone/cool-thing",
      description: "一个很酷的项目",
      url: "https://github.com/someone/cool-thing",
      language: "TypeScript",
      stars: 1234,
      category: "AI",
    },
    {
      rank: 2,
      fullName: "other/tool",
      description: null,
      url: "https://github.com/other/tool",
      language: null,
      stars: 56,
      category: "工具",
    },
  ] satisfies FeedPick[],
};

describe("buildRssFeed", () => {
  it("是合法的 RSS 外壳", () => {
    const xml = buildRssFeed(input);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<language>zh-CN</language>");
    // 站点地址末尾的斜杠要去掉，否则会出现 https://example.com//history/...
    expect(xml).toContain("<link>https://example.com</link>");
    expect(xml).not.toContain("example.com//");
  });

  it("每个项目一条 item", () => {
    const xml = buildRssFeed(input);
    expect(xml.match(/<item>/g)).toHaveLength(2);
    expect(xml).toContain("<title>1. someone/cool-thing</title>");
    expect(xml).toContain("<title>2. other/tool</title>");
  });

  it("guid 带期号，同一项目不同期不会被当成同一条", () => {
    const xml = buildRssFeed(input);
    expect(xml).toContain("<guid isPermaLink=\"false\">someone/cool-thing@2026-11-03</guid>");
    expect(buildRssFeed({ ...input, dateKey: "2026-11-04" })).toContain("@2026-11-04");
  });

  it("标题里的特殊字符被转义，不会破坏 XML", () => {
    // 项目名理论上不含尖括号，但仓库描述、分类是从外部数据来的，不能信
    const xml = buildRssFeed({
      ...input,
      picks: [{ ...input.picks[0], fullName: "a<b>&c" }],
    });
    expect(xml).toContain("&lt;b&gt;&amp;c");
    expect(xml).not.toContain("<b>");
  });

  it("描述里的 ]]> 不会提前截断 CDATA", () => {
    const xml = buildRssFeed({
      ...input,
      picks: [{ ...input.picks[0], description: "陷阱 ]]> 后面还有内容" }],
    });
    expect(xml).toContain("]]]]><![CDATA[>");
    // 截断的话后面的字就没了
    expect(xml).toContain("后面还有内容");
  });

  it("日期用 RFC 822，不是 ISO", () => {
    const xml = buildRssFeed(input);
    expect(xml).toMatch(/<pubDate>\w{3}, \d{2} \w{3} \d{4}/);
    expect(xml).not.toMatch(/<pubDate>2026-11-03T/);
  });
});
