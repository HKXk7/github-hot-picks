import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ChatAssistant from "@/components/ChatAssistant";
import { absoluteUrl, SITE_URL } from "@/lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description = "每天自动从 GitHub 新项目中挑选值得关注的开源项目，生成中文推荐稿，并给每个项目配一篇小白教程。";

export const metadata: Metadata = {
  // 没有 metadataBase 的话，OG / 站点地图里的相对路径会被解析成别的域名
  metadataBase: new URL(SITE_URL),
  title: {
    default: "GitHub 热门项目推荐",
    template: "%s · GitHub 热门项目推荐",
  },
  description,
  applicationName: "GitHub 热门项目推荐",
  keywords: ["GitHub", "开源项目", "每日推荐", "热门仓库", "AI 教程"],
  alternates: {
    canonical: "/",
    // 订阅源：让阅读器和浏览器能自动发现它
    types: { "application/rss+xml": absoluteUrl("/feed.xml") },
  },
  openGraph: {
    type: "website",
    siteName: "GitHub 热门项目推荐",
    title: "GitHub 热门项目推荐",
    description,
    url: absoluteUrl("/"),
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "GitHub 热门项目推荐",
    description,
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ colorScheme: "light" }}
    >
      <body className="min-h-full flex flex-col bg-[#faf8f5]">
        {children}
        <ChatAssistant />
      </body>
    </html>
  );
}
